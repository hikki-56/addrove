import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import {
  readSheet,
  appendRows,
  updateRow,
  batchUpdateRows,
  SHEETS,
  getWarehouseSheetName,
  clearSheetCache,
  ensureSheetTabExists,
} from "@/lib/google-sheets/client";
import { bomRepository } from "@/lib/repositories/sheets/bom.repository";
import { logAudit } from "@/lib/audit";
import {
  cleanCode,
  loadProductionOrdersFromSheets,
  findAllWarehouseRowIndexes,
} from "@/lib/production-sheets";
import { isProductionReviewer } from "@/lib/production-reviewers";
import { normalizeWarehouseId, getWarehouseName } from "@/lib/warehouse-utils";
import { getAccessibleWarehouseIds } from "@/lib/api-response";
import type { StockMovement } from "@/types/models";
import type {
  ProductionOrderRecord,
  InspectItemPayload,
  InspectionItemResult,
  InspectionRound,
} from "@/types/production";
import { PRODUCTION_INSPECTION_SHEET_HEADERS, WASTE_SHEET_HEADERS } from "@/types/production";

const RM_SOURCE_WAREHOUSE = "wh-02";

interface TouchedWarehouse {
  sheetName: string;
  rows: string[][];
  updates: { rowNumber: number; values: (string | number | boolean)[] }[];
  appends: (string | number | boolean)[][];
}

function getTouched(touched: Map<string, TouchedWarehouse>, sheetName: string): TouchedWarehouse {
  let t = touched.get(sheetName);
  if (!t) {
    t = { sheetName, rows: [], updates: [], appends: [] };
    touched.set(sheetName, t);
  }
  return t;
}

/** อ่านชีตโกดังแบบ forceFresh แล้วเก็บไว้ใน touched เพื่อรวม batch การเขียนทีเดียวตอนจบ */
async function loadWarehouseRows(touched: Map<string, TouchedWarehouse>, sheetName: string): Promise<string[][]> {
  const t = getTouched(touched, sheetName);
  if (t.rows.length === 0) {
    clearSheetCache(sheetName);
    t.rows = await readSheet(sheetName, "A2:Z", { forceFresh: true }).catch(() => [] as string[][]);
  }
  return t.rows;
}

/** เพิ่มสต็อกสินค้าเข้าโกดังปลายทาง (อัปเดตแถวเดิม หรือ append แถวใหม่ถ้าไม่มี/ตำแหน่งต่างกัน) */
function addStockToWarehouse(
  touched: Map<string, TouchedWarehouse>,
  sheetName: string,
  item: { sku: string; barcode?: string; name: string; category?: string; unit: string; supplier?: string },
  qty: number,
  location: string,
  nowIso: string
): void {
  const t = getTouched(touched, sheetName);
  const rows = t.rows;
  const matches = findAllWarehouseRowIndexes(rows, item.sku, item.barcode, item.name);
  const rowIndex = matches.length > 0 ? matches[0] : -1;

  if (rowIndex !== -1) {
    const existingLocation = String(rows[rowIndex][6] || "").trim();
    // มีแถวอยู่แล้วแต่ระบุตำแหน่งใหม่ที่ต่างออกไป — แยกเป็นแถวใหม่ (สินค้าชนิดเดียวกันได้หลายตำแหน่ง)
    if (location && existingLocation && cleanCode(existingLocation) !== cleanCode(location)) {
      t.appends.push([
        item.sku,
        item.barcode || "",
        item.name,
        item.category || "สินค้าสำเร็จรูป",
        item.unit || "ชิ้น",
        qty,
        location,
        item.supplier || "ฝ่ายผลิต (ใบผลิต)",
        nowIso,
      ]);
      return;
    }
    const rowValues = [...rows[rowIndex]];
    while (rowValues.length < 9) rowValues.push("");
    const curQty = parseFloat(String(rowValues[5] || rowValues[4] || "0").replace(/,/g, "")) || 0;
    rowValues[5] = String(curQty + qty);
    if (location && !existingLocation) rowValues[6] = location;
    rowValues[8] = nowIso;
    t.updates.push({ rowNumber: rowIndex + 2, values: rowValues });
    rows[rowIndex] = rowValues as string[];
    return;
  }

  t.appends.push([
    item.sku,
    item.barcode || "",
    item.name,
    item.category || "สินค้าสำเร็จรูป",
    item.unit || "ชิ้น",
    qty,
    location || "",
    item.supplier || "ฝ่ายผลิต (ใบผลิต)",
    nowIso,
  ]);
}

/** ตัดสต็อกออกจากโกดัง — ไล่ตัดทุกแถวที่ตรง (หลายตำแหน่ง) จนครบจำนวน คืนยอดที่ตัดจริง */
function deductStockFromWarehouse(
  touched: Map<string, TouchedWarehouse>,
  sheetName: string,
  item: { sku: string; barcode?: string; name: string },
  qty: number,
  nowIso: string
): number {
  const t = getTouched(touched, sheetName);
  const rows = t.rows;
  const rowIndexes = findAllWarehouseRowIndexes(rows, item.sku, item.barcode, item.name);
  if (rowIndexes.length === 0) return 0;

  let remaining = qty;
  for (const rowIndex of rowIndexes) {
    if (remaining <= 0) break;
    const rowValues = [...rows[rowIndex]];
    while (rowValues.length < 9) rowValues.push("");
    const curQty = parseFloat(String(rowValues[5] || rowValues[4] || "0").replace(/,/g, "")) || 0;
    if (curQty <= 0) continue;
    const take = Math.min(curQty, remaining);
    remaining -= take;
    rowValues[5] = String(curQty - take);
    rowValues[8] = nowIso;
    t.updates.push({ rowNumber: rowIndex + 2, values: rowValues });
    rows[rowIndex] = rowValues as string[];
  }

  return qty - remaining;
}

/**
 * POST /api/production/orders/[order_no]/review
 * Flow การผลิต (ยุบเหลือหนึ่งขั้น):
 * 1. แอดมินสร้างใบผลิต
 * 2. คนตรวจ (แก้ / milk — เพิ่มชื่อได้ใน production-reviewers.ts) กรอกผลจริง:
 *    ผลิตได้จริง/ของเสียต่อสินค้า + วัตถุดิบใช้จริง/เสียจริง (ไม่กรอกวัตถุดิบ = คำนวณจากสูตร BOM)
 * 3. กดยืนยัน → ตัดวัตถุดิบจากโกดัง 2 / เพิ่มสต็อกของดี / บันทึกของเสีย / ปิดใบ+ย้ายเศษ ทันที
 *    พร้อมบันทึกรอบเป็น APPROVED ลงแท็บ "ตรวจการผลิต" เพื่อเก็บประวัติ
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ order_no: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    // แอดมิน และคนตรวจ (แก้ / milk / เพิ่มชื่อได้ใน production-reviewers.ts) ที่ยืนยันผลและตัดสต็อกได้
    const reviewerName =
      (session?.user?.email || session?.user?.name || (actor as any).username || "") as string;
    const isAdmin =
      session?.user?.role === "ADMIN" || (actor as any).role === "ADMIN";
    if (
      !isAdmin &&
      !isProductionReviewer({ email: session?.user?.email, name: session?.user?.name }) &&
      !isProductionReviewer({ name: (actor as any).username })
    ) {
      return NextResponse.json(
        { success: false, message: "เฉพาะแอดมินและคนตรวจ (ที่กำหนดไว้ในระบบ) เท่านั้นที่ยืนยันผลผลิตและตัดสต็อกได้" },
        { status: 403 }
      );
    }

    const { order_no: rawOrderNo } = await params;
    const orderNo = decodeURIComponent(rawOrderNo || "").trim();
    if (!orderNo) {
      return NextResponse.json({ success: false, message: "กรุณาระบุเลขที่ใบผลิต" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const items: InspectItemPayload[] = Array.isArray(body.items) ? body.items : [];
    const materialsInput: { rm_sku?: string; used_qty?: number; wasted_qty?: number }[] = Array.isArray(body.materials)
      ? body.materials
      : [];
    const closeOrder = body.close_order === true;
    const leftoverInput = body.leftover || {};
    const note = String(body.note || "");
    const confirmedByName = String(body.confirmed_by_name || reviewerName || "คนตรวจ");

    // ---- 1. โหลดใบผลิต ----
    const orderMap = await loadProductionOrdersFromSheets();
    let order: ProductionOrderRecord | undefined = orderMap.get(orderNo.toLowerCase());
    if (!order) {
      const globalForProduction = globalThis as unknown as { inMemoryProductionOrders?: ProductionOrderRecord[] };
      order = globalForProduction.inMemoryProductionOrders?.find(
        (o) => o.order_no.toLowerCase() === orderNo.toLowerCase()
      );
    }
    if (!order) {
      return NextResponse.json({ success: false, message: `ไม่พบใบผลิต ${orderNo}` }, { status: 404 });
    }
    if (order.status !== "PENDING" && order.status !== "IN_PROGRESS") {
      return NextResponse.json(
        { success: false, message: `ใบผลิตนี้สถานะเป็น ${order.status} — ยืนยันผลผลิตไม่ได้` },
        { status: 400 }
      );
    }
    if (items.length === 0) {
      return NextResponse.json(
        { success: false, message: "กรุณาระบุผลผลิตอย่างน้อย 1 รายการ" },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const todayDate = nowIso.slice(0, 10);

    // ---- 2. เลขรอบถัดไป ----
    const existingRounds = order.inspections || [];
    const roundNo = existingRounds.reduce((max, r) => Math.max(max, r.round_no), 0) + 1;

    // ---- 3. Validate ผลผลิต (ผลิตได้จริง/ของเสีย) ----
    const accessibleWarehouseIds = getAccessibleWarehouseIds((actor as any).warehouseAccess);
    const approvedItems: InspectionItemResult[] = [];

    for (const payload of items) {
      const fgSku = String(payload.fg_sku || "").trim();
      const orderItem = order.items.find((i) => cleanCode(i.fg_sku) === cleanCode(fgSku));
      if (!orderItem) {
        return NextResponse.json(
          { success: false, message: `สินค้า ${fgSku} ไม่อยู่ในใบผลิตนี้` },
          { status: 400 }
        );
      }

      const goodQty = Math.max(0, Math.floor(Number(payload.good_qty) || 0));
      const defectQty = Math.max(0, Math.floor(Number(payload.defect_qty) || 0));
      const remaining =
        orderItem.quantity - (Number(orderItem.produced_qty) || 0) - (Number(orderItem.defect_qty) || 0);

      if (goodQty + defectQty > remaining) {
        return NextResponse.json(
          {
            success: false,
            message: `สินค้า ${orderItem.fg_name} ยืนยันเกินจำนวนที่เหลือ (เหลือ ${remaining} แต่ยืนยัน ${goodQty + defectQty})`,
          },
          { status: 400 }
        );
      }

      const warehouseId = normalizeWarehouseId(String(payload.warehouse_id || RM_SOURCE_WAREHOUSE));
      if (accessibleWarehouseIds && !accessibleWarehouseIds.includes(warehouseId)) {
        return NextResponse.json(
          {
            success: false,
            message: `คุณไม่มีสิทธิ์เข้าโกดัง ${getWarehouseName(warehouseId)} — เลือกโกดังปลายทางที่คุณดูแล`,
          },
          { status: 403 }
        );
      }

      approvedItems.push({
        fg_sku: orderItem.fg_sku,
        fg_name: orderItem.fg_name,
        good_qty: goodQty,
        defect_qty: defectQty,
        warehouse_id: warehouseId,
        warehouse_name: getWarehouseName(warehouseId),
        location: String(payload.location || "").trim(),
      });
    }

    const totalGood = approvedItems.reduce((s, i) => s + i.good_qty, 0);
    const totalDefect = approvedItems.reduce((s, i) => s + i.defect_qty, 0);
    if (totalGood + totalDefect === 0) {
      return NextResponse.json(
        { success: false, message: "จำนวนที่ยืนยันเป็น 0 ทั้งหมด — กรอกผลิตได้จริงหรือของเสียก่อน" },
        { status: 400 }
      );
    }

    // ---- 4. แผนวัตถุดิบ (แท็บ "ใบผลิต_วัตถุดิบ") ----
    const materialSheetRows = await readSheet(SHEETS.PRODUCTION_MATERIALS, "A2:I").catch(() => [] as string[][]);
    const materialRowIndexes: { sheetRow: number; planned: number; used: number; wasted: number; row: string[] }[] = [];
    for (let i = 0; i < materialSheetRows.length; i++) {
      const r = materialSheetRows[i];
      if (!r || !r[0] || String(r[0]).trim().toLowerCase() !== orderNo.toLowerCase()) continue;
      if (!r[1]) continue;
      if (materialRowIndexes.some((m) => cleanCode(m.row[1]) === cleanCode(r[1]))) continue;
      materialRowIndexes.push({
        sheetRow: i + 2,
        planned: Number(r[4]) || 0,
        used: Number(r[5]) || 0,
        wasted: Number(r[8]) || 0,
        row: r,
      });
    }

    // ---- 5. คำนวณวัตถุดิบที่ต้องตัดรอบนี้ ----
    // กรอกยอดใช้จริง/เสียจริงมา → ใช้ยอดที่กรอก / ไม่กรอก → คำนวณจากสูตร BOM × ของดี (waste% ปัดขึ้น)
    interface RoundUsage {
      sku: string;
      name: string;
      unit: string;
      used: number;
      wasted: number;
      qty: number;
    }
    const usageMap = new Map<string, RoundUsage>();
    const roundMaterials: { rm_sku: string; rm_name: string; used_qty: number; wasted_qty: number }[] = [];

    if (materialsInput.length > 0) {
      for (const payload of materialsInput) {
        const rmSku = String(payload?.rm_sku || "").trim();
        const usedQty = Math.max(0, Math.floor(Number(payload?.used_qty) || 0));
        const wastedQty = Math.max(0, Math.floor(Number(payload?.wasted_qty) || 0));
        if (!rmSku || usedQty + wastedQty <= 0) continue;
        const key = cleanCode(rmSku);
        const planRow = materialRowIndexes.find((m) => cleanCode(m.row[1]) === key || cleanCode(m.row[2]) === key);
        if (planRow) {
          const allowed = Math.max(0, planRow.planned - planRow.used - planRow.wasted);
          if (usedQty + wastedQty > allowed) {
            return NextResponse.json(
              {
                success: false,
                message: `วัตถุดิบ "${planRow.row[2] || rmSku}" (${rmSku}) เกินยอดคงเหลือตามแผน (เหลือ ${allowed} แต่ยืนยัน ${usedQty + wastedQty})`,
              },
              { status: 400 }
            );
          }
        }
        const agg = usageMap.get(key) || {
          sku: String(planRow?.row[1] || rmSku),
          name: String(planRow?.row[2] || rmSku),
          unit: String(planRow?.row[3] || "ชิ้น"),
          used: 0,
          wasted: 0,
          qty: 0,
        };
        agg.used += usedQty;
        agg.wasted += wastedQty;
        agg.qty = agg.used + agg.wasted;
        usageMap.set(key, agg);
      }
      for (const [, agg] of usageMap.entries()) {
        roundMaterials.push({ rm_sku: agg.sku, rm_name: agg.name, used_qty: agg.used, wasted_qty: agg.wasted });
      }
    } else if (totalGood > 0) {
      const allFormulas = await bomRepository.getAllFormulas().catch(() => []);
      for (const item of approvedItems) {
        if (item.good_qty <= 0) continue;
        const formula = allFormulas.find((f) => f.fg_sku.toLowerCase() === item.fg_sku.toLowerCase());
        if (!formula || !Array.isArray(formula.items) || formula.items.length === 0) {
          return NextResponse.json(
            { success: false, message: `ไม่พบสูตรการผลิต (BOM) ของสินค้า ${item.fg_sku} — ตัดวัตถุดิบไม่ได้ (กรอกยอดวัตถุดิบใช้จริงแทนได้)` },
            { status: 400 }
          );
        }
        for (const mat of formula.items) {
          const perUnit = Number(mat.rm_qty_required) || 1;
          const wasteFactor = 1 + (Number(mat.waste_percentage) || 0) / 100;
          const used = Math.ceil(perUnit * wasteFactor * item.good_qty);
          const key = cleanCode(mat.rm_sku || mat.rm_barcode || mat.rm_name);
          const agg = usageMap.get(key) || {
            sku: mat.rm_sku || "",
            name: mat.rm_name || mat.rm_sku,
            unit: mat.rm_unit || "ชิ้น",
            used: 0,
            wasted: 0,
            qty: 0,
          };
          agg.used += used;
          agg.qty = agg.used + agg.wasted;
          usageMap.set(key, agg);
        }
      }
      // แบบ BOM — จำกัดการใช้ไม่เกินแผนที่เหลือ (ปัดลง)
      for (const [key, usage] of usageMap.entries()) {
        const planRow = materialRowIndexes.find((m) => cleanCode(m.row[1]) === key || cleanCode(m.row[2]) === key);
        if (planRow) {
          const allowed = Math.max(0, planRow.planned - planRow.used - planRow.wasted);
          if (usage.qty > allowed) {
            usage.qty = allowed;
            usage.used = allowed;
          }
        }
      }
    }
    const roundUsage = Array.from(usageMap.values()).filter((u) => u.qty > 0);

    // ---- 6. ตรวจวัตถุดิบพอในโกดัง 2 ----
    const wh2SheetName = getWarehouseSheetName(RM_SOURCE_WAREHOUSE);
    const touched = new Map<string, TouchedWarehouse>();
    const wh2Rows = await loadWarehouseRows(touched, wh2SheetName);

    const wh2Available = (sku: string, name: string): number => {
      let total = 0;
      for (const idx of findAllWarehouseRowIndexes(wh2Rows, sku, undefined, name)) {
        const raw = parseFloat(String(wh2Rows[idx][5] || wh2Rows[idx][4] || "0").replace(/,/g, "")) || 0;
        total += Math.max(0, raw);
      }
      return total;
    };
    for (const usage of roundUsage) {
      const available = wh2Available(usage.sku, usage.name);
      if (available < usage.qty) {
        return NextResponse.json(
          {
            success: false,
            message: `วัตถุดิบ "${usage.name}" (${usage.sku}) ในโกดัง 2 มีไม่พอ (ต้องการ ${usage.qty} ${usage.unit} แต่มี ${available.toLocaleString()} ${usage.unit})`,
          },
          { status: 400 }
        );
      }
    }

    // ---- 7. สถานะใบผลิตหลังยืนยัน ----
    const updatedItems = order.items.map((item) => {
      const approved = approvedItems.find((r) => cleanCode(r.fg_sku) === cleanCode(item.fg_sku));
      return {
        ...item,
        produced_qty: (Number(item.produced_qty) || 0) + (approved?.good_qty || 0),
        defect_qty: (Number(item.defect_qty) || 0) + (approved?.defect_qty || 0),
      };
    });
    const allComplete = updatedItems.every((i) => i.quantity - i.produced_qty - i.defect_qty <= 0);
    const newStatus = closeOrder || allComplete ? "COMPLETED" : "IN_PROGRESS";

    // ---- 8. เศษวัตถุดิบคงเหลือ (ตอนปิดใบ) ----
    const rawLeftoverWh = String(leftoverInput.warehouse_id || "").trim();
    const leftoverWarehouseId = rawLeftoverWh ? normalizeWarehouseId(rawLeftoverWh) : "";
    const leftoverLocation = String(leftoverInput.location || "").trim();

    type LeftoverMove = { sku: string; name: string; unit: string; qty: number };
    let leftoverMoves: LeftoverMove[] = [];
    if (newStatus === "COMPLETED" && leftoverWarehouseId) {
      if (accessibleWarehouseIds && !accessibleWarehouseIds.includes(leftoverWarehouseId)) {
        return NextResponse.json(
          {
            success: false,
            message: `คุณไม่มีสิทธิ์เข้าโกดัง ${getWarehouseName(leftoverWarehouseId)} — เลือกที่เก็บเศษวัตถุดิบในโกดังที่คุณดูแล`,
          },
          { status: 403 }
        );
      }
      for (const m of materialRowIndexes) {
        const leftoverQty = Math.max(
          0,
          m.planned - m.used - m.wasted - (usageMap.get(cleanCode(m.row[1]))?.qty || 0)
        );
        if (leftoverQty > 0) {
          leftoverMoves.push({
            sku: String(m.row[1]),
            name: String(m.row[2] || m.row[1]),
            unit: String(m.row[3] || "ชิ้น"),
            qty: leftoverQty,
          });
        }
      }
    }
    const leftoverMovesReal = leftoverMoves.filter(
      (m) => leftoverWarehouseId && leftoverWarehouseId !== RM_SOURCE_WAREHOUSE
    );

    const repo = getRepository();
    const docId = order.document_id || order.id;

    // ---- 9. Stock Movements ----
    const movementsToCreate: Omit<StockMovement, "movement_id" | "created_at">[] = [];
    for (const item of approvedItems) {
      if (item.good_qty > 0) {
        movementsToCreate.push({
          document_id: docId,
          product_id: item.fg_sku,
          warehouse_id: item.warehouse_id,
          location_id: item.location,
          qty_change: item.good_qty,
          movement_type: "RECEIVE",
          idempotency_key: `prd-cfm-${orderNo}-r${roundNo}-fg-${cleanCode(item.fg_sku)}`,
          created_by: actor.id || "reviewer",
        });
      }
    }
    for (const usage of roundUsage) {
      movementsToCreate.push({
        document_id: docId,
        product_id: usage.sku,
        warehouse_id: RM_SOURCE_WAREHOUSE,
        location_id: "",
        qty_change: -usage.qty,
        movement_type: "ISSUE_OUT",
        idempotency_key: `prd-cfm-${orderNo}-r${roundNo}-rm-${cleanCode(usage.sku)}`,
        created_by: actor.id || "reviewer",
      });
    }
    for (const move of leftoverMovesReal) {
      movementsToCreate.push({
        document_id: docId,
        product_id: move.sku,
        warehouse_id: RM_SOURCE_WAREHOUSE,
        location_id: "",
        qty_change: -move.qty,
        movement_type: "MOVE_OUT",
        idempotency_key: `prd-cfm-${orderNo}-r${roundNo}-lo-out-${cleanCode(move.sku)}`,
        created_by: actor.id || "reviewer",
      });
      movementsToCreate.push({
        document_id: docId,
        product_id: move.sku,
        warehouse_id: leftoverWarehouseId,
        location_id: leftoverLocation,
        qty_change: move.qty,
        movement_type: "MOVE_IN",
        idempotency_key: `prd-cfm-${orderNo}-r${roundNo}-lo-in-${cleanCode(move.sku)}`,
        created_by: actor.id || "reviewer",
      });
    }
    await repo.movements.batchCreate(movementsToCreate).catch((err) => {
      console.warn("[POST .../review] batchCreate movements warning:", err);
    });

    // ---- 10. อัปเดตสต็อกในชีตโกดัง ----
    for (const usage of roundUsage) {
      const deducted = deductStockFromWarehouse(
        touched,
        wh2SheetName,
        { sku: usage.sku, name: usage.name },
        usage.qty,
        nowIso
      );
      if (deducted < usage.qty) {
        console.warn(`[POST .../review] RM row not fully matched: ${usage.sku} deducted ${deducted}/${usage.qty}`);
      }
    }

    for (const item of approvedItems) {
      if (item.good_qty <= 0) continue;
      const destSheetName = getWarehouseSheetName(item.warehouse_id);
      await loadWarehouseRows(touched, destSheetName);
      const orderItem = order.items.find((i) => cleanCode(i.fg_sku) === cleanCode(item.fg_sku));
      addStockToWarehouse(
        touched,
        destSheetName,
        {
          sku: item.fg_sku,
          barcode: orderItem?.fg_barcode || "",
          name: item.fg_name,
          unit: orderItem?.fg_unit || "ชิ้น",
        },
        item.good_qty,
        item.location,
        nowIso
      );
    }

    for (const move of leftoverMovesReal) {
      deductStockFromWarehouse(touched, wh2SheetName, { sku: move.sku, name: move.name }, move.qty, nowIso);
      const destSheetName = getWarehouseSheetName(leftoverWarehouseId);
      await loadWarehouseRows(touched, destSheetName);
      addStockToWarehouse(
        touched,
        destSheetName,
        { sku: move.sku, name: move.name, unit: move.unit, category: "วัตถุดิบ" },
        move.qty,
        leftoverLocation,
        nowIso
      );
    }

    for (const t of touched.values()) {
      try {
        if (t.updates.length > 0) {
          await batchUpdateRows(t.sheetName, t.updates);
        }
        if (t.appends.length > 0) {
          await appendRows(t.sheetName, t.appends as (string | number | boolean)[][]);
        }
        clearSheetCache(t.sheetName);
      } catch (err) {
        console.warn(`[POST .../review] Warehouse sheet write error (${t.sheetName}):`, err);
      }
    }

    // ---- 11. ของเสีย → แท็บ "สินค้าเสีย" ----
    const defectItems = approvedItems.filter((i) => i.defect_qty > 0);
    if (defectItems.length > 0) {
      try {
        await ensureSheetTabExists(SHEETS.WASTE_ITEMS, [...WASTE_SHEET_HEADERS]);
        const wasteSheetRows = defectItems.map(
          (item, idx) =>
            [
              `wst-${Date.now()}-${roundNo}${idx}`,
              orderNo,
              roundNo,
              todayDate,
              item.fg_sku,
              item.fg_name,
              item.defect_qty,
              note || "",
              confirmedByName,
              nowIso,
            ] as (string | number)[]
        );
        await appendRows(SHEETS.WASTE_ITEMS, wasteSheetRows);
      } catch (sheetErr) {
        console.warn("[POST .../review] Waste sheet save non-fatal error:", sheetErr);
      }
    }

    // ---- 12. แท็บ "ใบผลิต" (ผลิตแล้ว/เสียแล้ว/สถานะ/เศษวัตถุดิบปลายทาง) ----
    try {
      const orderSheetRows = await readSheet(SHEETS.PRODUCTION_ORDERS, "A2:O").catch(() => [] as string[][]);
      const batchUpdates: { rowNumber: number; values: (string | number | boolean)[] }[] = [];
      for (let i = 0; i < orderSheetRows.length; i++) {
        const r = orderSheetRows[i];
        if (!r || !r[0] || String(r[0]).trim().toLowerCase() !== orderNo.toLowerCase()) continue;
        const rowValues = [...r];
        while (rowValues.length < 15) rowValues.push("");
        const approved = approvedItems.find((x) => cleanCode(x.fg_sku) === cleanCode(String(r[4])));
        if (approved) {
          rowValues[8] = String((Number(r[8]) || 0) + approved.good_qty);
          rowValues[9] = String((Number(r[9]) || 0) + approved.defect_qty);
        }
        rowValues[3] = newStatus;
        if (newStatus === "COMPLETED") {
          if (leftoverWarehouseId) rowValues[13] = leftoverWarehouseId;
          if (leftoverLocation) rowValues[14] = leftoverLocation;
        }
        batchUpdates.push({ rowNumber: i + 2, values: rowValues });
      }
      if (batchUpdates.length > 0) {
        await batchUpdateRows(SHEETS.PRODUCTION_ORDERS, batchUpdates);
      }
    } catch (sheetErr) {
      console.warn("[POST .../review] Production order sheet update non-fatal error:", sheetErr);
    }

    // ---- 13. แท็บ "ใบผลิต_วัตถุดิบ" (ใช้จริง/เสียจริง/คงเหลือ) ----
    try {
      const materialUpdates: { rowNumber: number; values: (string | number | boolean)[] }[] = [];
      for (const m of materialRowIndexes) {
        const usage = usageMap.get(cleanCode(m.row[1]));
        if (!usage || usage.qty <= 0) continue;
        const rowValues = [...m.row];
        while (rowValues.length < 9) rowValues.push("");
        const newUsed = m.used + usage.used;
        const newWasted = m.wasted + usage.wasted;
        rowValues[5] = String(newUsed);
        rowValues[8] = String(newWasted);
        rowValues[6] = String(Math.max(0, m.planned - newUsed - newWasted));
        rowValues[7] = nowIso;
        materialUpdates.push({ rowNumber: m.sheetRow, values: rowValues });
      }
      if (materialUpdates.length > 0) {
        await batchUpdateRows(SHEETS.PRODUCTION_MATERIALS, materialUpdates);
      }
    } catch (sheetErr) {
      console.warn("[POST .../review] Production materials sheet update non-fatal error:", sheetErr);
    }

    // ---- 14. บันทึกรอบเป็น APPROVED ลงแท็บ "ตรวจการผลิต" (เก็บประวัติ) ----
    const materialsJson = roundMaterials.length > 0 ? JSON.stringify(roundMaterials) : "";
    try {
      await ensureSheetTabExists(SHEETS.PRODUCTION_INSPECTIONS, [...PRODUCTION_INSPECTION_SHEET_HEADERS]);
      const buildRow = (item: InspectionItemResult, idx: number): (string | number)[] => [
        orderNo,
        roundNo,
        nowIso,
        item.fg_sku,
        item.good_qty,
        item.defect_qty,
        item.warehouse_id,
        item.location,
        confirmedByName,
        note,
        "APPROVED",
        confirmedByName,
        nowIso,
        "",
        closeOrder ? "TRUE" : "FALSE",
        closeOrder && leftoverWarehouseId ? leftoverWarehouseId : "",
        closeOrder && leftoverWarehouseId ? leftoverLocation : "",
        idx === 0 ? materialsJson : "",
      ];
      await appendRows(SHEETS.PRODUCTION_INSPECTIONS, approvedItems.map(buildRow));
    } catch (sheetErr) {
      console.warn("[POST .../review] Inspection round save non-fatal error:", sheetErr);
    }

    // ---- 15. อัปเดต in-memory ----
    const roundRecord: InspectionRound = {
      round_no: roundNo,
      inspected_at: nowIso,
      inspected_by: actor.id || "reviewer",
      inspected_by_name: confirmedByName,
      note: note || undefined,
      items: approvedItems,
      materials: roundMaterials.length > 0 ? roundMaterials : undefined,
      status: "APPROVED",
      reviewed_by_name: confirmedByName,
      reviewed_at: nowIso,
      close_order: closeOrder,
      leftover_destination:
        newStatus === "COMPLETED" && leftoverWarehouseId
          ? {
              warehouse_id: leftoverWarehouseId,
              warehouse_name: getWarehouseName(leftoverWarehouseId),
              location: leftoverLocation,
            }
          : order.leftover_destination || null,
    };
    const mem = (globalThis as any).inMemoryProductionOrders as ProductionOrderRecord[] | undefined;
    const memOrder = mem?.find((o) => o.order_no.toLowerCase() === orderNo.toLowerCase());
    const target = memOrder ?? order;
    if (!target.inspections) target.inspections = [];
    target.inspections.push(roundRecord);
    order.status = newStatus;
    order.items = updatedItems;
    if (memOrder) {
      memOrder.status = newStatus;
      memOrder.items = updatedItems;
      memOrder.leftover_destination = roundRecord.leftover_destination ?? memOrder.leftover_destination ?? null;
    }

    // ---- 16. อัปเดตสถานะในแถว Documents (best-effort) ----
    try {
      const docRows = await readSheet(SHEETS.DOCUMENTS, "A2:I").catch(() => [] as string[][]);
      for (let i = 0; i < docRows.length; i++) {
        const r = docRows[i];
        if (r[0] === orderNo || r[1] === orderNo || r[3] === orderNo) {
          let currentMeta: any = {};
          try {
            if (r[6] && r[6].startsWith("{")) currentMeta = JSON.parse(r[6]);
          } catch {}
          currentMeta.status = newStatus;
          await updateRow(SHEETS.DOCUMENTS, i + 2, [
            r[0],
            r[1],
            r[2],
            r[3],
            r[4],
            newStatus,
            JSON.stringify(currentMeta),
            r[7],
            r[8],
          ]).catch(() => {});
          break;
        }
      }
    } catch (e) {
      console.warn("[POST .../review] Documents sheet update non-fatal error:", e);
    }

    // ---- 17. เคลียร์ cache + audit ----
    clearSheetCache(SHEETS.PRODUCTION_ORDERS as string);
    clearSheetCache(SHEETS.PRODUCTION_MATERIALS as string);
    clearSheetCache(SHEETS.PRODUCTION_INSPECTIONS as string);
    clearSheetCache(SHEETS.WASTE_ITEMS as string);
    clearSheetCache(SHEETS.STOCK_MOVEMENTS);
    clearSheetCache(SHEETS.STOCK_SUMMARY);
    clearSheetCache(SHEETS.DOCUMENTS);

    try {
      await logAudit(repo.audit, {
        actorId: actor.id || "reviewer",
        actorRole: (actor as any).role || "ADMIN",
        action: "PRODUCTION_CONFIRM",
        resourceType: "Document",
        resourceId: docId,
        warehouseId: RM_SOURCE_WAREHOUSE,
        outcome: "SUCCESS",
        metadata: {
          order_no: orderNo,
          round_no: roundNo,
          total_good: totalGood,
          total_defect: totalDefect,
          new_status: newStatus,
          usage_source: materialsInput.length > 0 ? "REPORTED" : "BOM",
          materials_used: roundUsage.map((u) => ({ sku: u.sku, used: u.used, wasted: u.wasted })),
          leftover_moves: leftoverMovesReal.map((m) => ({ sku: m.sku, qty: m.qty, to: leftoverWarehouseId })),
        },
      });
    } catch (auditErr) {
      console.warn("[POST .../review] Audit log warning:", auditErr);
    }

    return NextResponse.json({
      success: true,
      data: {
        order_no: orderNo,
        round_no: roundNo,
        status: newStatus,
        total_good: totalGood,
        total_defect: totalDefect,
        materials_used: roundUsage,
        leftover_moved: leftoverMovesReal,
        leftover_warehouse: leftoverWarehouseId ? getWarehouseName(leftoverWarehouseId) : "",
        leftover_location: leftoverLocation,
      },
      message:
        newStatus === "COMPLETED"
          ? `ยืนยันผลผลิตรอบที่ ${roundNo} และปิดใบผลิตเรียบร้อย — ตัดวัตถุดิบ/เพิ่มสต็อกทันทีแล้ว`
          : `ยืนยันผลผลิตรอบที่ ${roundNo} สำเร็จ — ตัดวัตถุดิบ/เพิ่มสต็อกทันทีแล้ว`,
    });
  } catch (error: any) {
    console.error("[POST /api/production/orders/[order_no]/review] Error:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "เกิดข้อผิดพลาดในการยืนยันผลผลิต" },
      { status: 500 }
    );
  }
}
