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
import { cleanCode, loadProductionOrdersFromSheets } from "@/lib/production-sheets";
import type { ProductionOrderRecord, ProductionOrderItem } from "@/types/production";
import {
  PRODUCTION_ORDER_SHEET_HEADERS,
  PRODUCTION_MATERIAL_SHEET_HEADERS,
} from "@/types/production";

// Global In-Memory Store for quick access & caching
const globalForProduction = globalThis as unknown as {
  inMemoryProductionOrders?: ProductionOrderRecord[];
};
if (!globalForProduction.inMemoryProductionOrders) {
  globalForProduction.inMemoryProductionOrders = [];
}
const inMemoryProductionOrders = globalForProduction.inMemoryProductionOrders;

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");

    // 1. ใบผลิตจากระบบใหม่ (แท็บเฉพาะ) — แหล่งข้อมูลหลัก
    const orderMap = await loadProductionOrdersFromSheets();

    // 2. Fallback: เอกสารเก่าที่เก็บ JSON ในแท็บ Documents (สร้างสมัยตัดสต็อกทันที)
    const repo = getRepository();
    const docsResult = await repo.documents.findAll({ page: 1, limit: 1000 }).catch(() => ({ data: [] }));
    const allDocs = docsResult.data || [];

    for (const doc of allDocs) {
      if (!doc || !doc.note) continue;

      const isPrdDoc =
        doc.reference_no?.startsWith("PRD-") ||
        doc.document_no?.startsWith("PRD-") ||
        doc.note.includes('"type":"PRODUCTION_ORDER"') ||
        doc.note.includes('"order_no"');

      if (!isPrdDoc) continue;

      try {
        let meta: any = {};
        if (doc.note.startsWith("{")) {
          meta = JSON.parse(doc.note);
        }

        const orderNo = meta.order_no || doc.reference_no || doc.document_no || doc.document_id;
        const key = String(orderNo).toLowerCase();

        // ใบที่มีในแท็บ "ใบผลิต" แล้ว — ใช้ข้อมูลแท็บเป็นหลัก แต่เติมรายละเอียด BOM ต่อรายการจาก meta
        const existing = orderMap.get(key);
        if (existing) {
          const metaItems: ProductionOrderItem[] = Array.isArray(meta.items) ? meta.items : [];
          for (const mi of metaItems) {
            if (!mi?.fg_sku) continue;
            const target = existing.items.find((i) => cleanCode(i.fg_sku) === cleanCode(mi.fg_sku));
            if (target) {
              if (!target.materials?.length && Array.isArray(mi.materials)) target.materials = mi.materials;
              if (!target.fg_barcode && mi.fg_barcode) target.fg_barcode = mi.fg_barcode;
            }
          }
          continue;
        }

        const items: ProductionOrderItem[] = Array.isArray(meta.items) ? meta.items : [];
        const totalFgQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
        const totalMaterialsCount = items.reduce((sum, item) => sum + (item.materials?.length || 0), 0);

        const order: ProductionOrderRecord = {
          id: doc.document_id,
          order_no: orderNo,
          document_id: doc.document_id,
          reference_no: doc.reference_no || orderNo,
          status: (meta.status || doc.status || "COMPLETED") as any,
          items: items,
          total_fg_qty: totalFgQty > 0 ? totalFgQty : Number(meta.total_qty) || 1,
          total_materials_count: totalMaterialsCount,
          created_by: doc.created_by || meta.created_by || "admin",
          created_by_name: meta.created_by_name || "ผู้ดูแลระบบ (Admin)",
          created_at: doc.created_at || meta.created_at || new Date().toISOString(),
          document_date: doc.document_date || meta.document_date || String(doc.created_at || "").slice(0, 10),
          note: meta.user_note || meta.note || undefined,
        };

        orderMap.set(key, order);
      } catch (err) {
        console.warn("[ProductionOrders GET] Parse error for doc:", doc.document_id, err);
      }
    }

    // 3. Merge in-memory orders (for newly created or optimistic records)
    for (const memOrder of inMemoryProductionOrders) {
      if (!memOrder || !memOrder.order_no) continue;
      const key = memOrder.order_no.toLowerCase();
      if (!orderMap.has(key)) {
        orderMap.set(key, memOrder);
      } else {
        // Update in-memory status if changed
        const existing = orderMap.get(key)!;
        if (memOrder.status && memOrder.status !== existing.status) {
          existing.status = memOrder.status;
        }
      }
    }

    let orders = Array.from(orderMap.values());

    // Filter by status if provided
    if (statusFilter && statusFilter !== "ALL") {
      orders = orders.filter((o) => o.status === statusFilter);
    }

    // Sort newest first
    orders.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    return NextResponse.json({
      success: true,
      data: orders,
      total: orders.length,
    });
  } catch (error) {
    console.error("[GET /api/production/orders] Error:", error);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลใบผลิต" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { items, note, customOrderNo } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, message: "กรุณาระบุรายการสินค้าที่ต้องการสั่งผลิตอย่างน้อย 1 รายการ" },
        { status: 400 }
      );
    }

    // 1. Fetch latest real inventory in Warehouse 2 (โกดัง 2)
    const wh2SheetName = getWarehouseSheetName("wh-02");
    clearSheetCache(wh2SheetName);
    const [wh2Rows, allFormulas] = await Promise.all([
      readSheet(wh2SheetName, "A2:I", { forceFresh: true }).catch(() => []),
      bomRepository.getAllFormulas().catch(() => []),
    ]);

    const wh2StockBySku = new Map<string, number>();
    const wh2StockByCleanSku = new Map<string, number>();
    const wh2StockByBarcode = new Map<string, number>();
    const wh2StockByName = new Map<string, number>();

    for (const r of wh2Rows) {
      if (!r || !r[0]) continue;
      const rowSku = (r[0] || "").trim();
      const rowBarcode = (r[1] || "").trim();
      const rowName = (r[2] || "").trim();
      const rawQty = parseFloat(String(r[5] || r[4] || "0").replace(/,/g, "").trim());
      const qty = isNaN(rawQty) ? 0 : Math.max(0, rawQty);

      if (rowSku) {
        wh2StockBySku.set(rowSku, (wh2StockBySku.get(rowSku) || 0) + qty);
        wh2StockByCleanSku.set(cleanCode(rowSku), (wh2StockByCleanSku.get(cleanCode(rowSku)) || 0) + qty);
      }
      if (rowBarcode && rowBarcode !== "-") {
        wh2StockByBarcode.set(rowBarcode, (wh2StockByBarcode.get(rowBarcode) || 0) + qty);
        wh2StockByCleanSku.set(cleanCode(rowBarcode), (wh2StockByCleanSku.get(cleanCode(rowBarcode)) || 0) + qty);
      }
      if (rowName) {
        wh2StockByName.set(cleanCode(rowName), (wh2StockByName.get(cleanCode(rowName)) || 0) + qty);
      }
    }

    const getWh2Stock = (itemSku?: string, itemBarcode?: string, itemName?: string): number => {
      if (itemSku && wh2StockBySku.has(itemSku)) return wh2StockBySku.get(itemSku)!;
      if (itemSku && wh2StockByCleanSku.has(cleanCode(itemSku))) return wh2StockByCleanSku.get(cleanCode(itemSku))!;
      if (itemBarcode && wh2StockByBarcode.has(itemBarcode)) return wh2StockByBarcode.get(itemBarcode)!;
      if (itemBarcode && wh2StockByCleanSku.has(cleanCode(itemBarcode))) return wh2StockByCleanSku.get(cleanCode(itemBarcode))!;
      if (itemName && wh2StockByName.has(cleanCode(itemName))) return wh2StockByName.get(cleanCode(itemName))!;
      return 0;
    };

    // 2. Validate BOM components and aggregated requirements in Warehouse 2
    const totalRequiredMaterialsMap = new Map<
      string,
      {
        sku: string;
        barcode?: string;
        name: string;
        unit: string;
        requiredQty: number;
        availableQty: number;
        isPrimary: boolean;
      }
    >();
    const formattedItems: ProductionOrderItem[] = [];

    for (const item of items) {
      const fgSku = (item.bom?.fg_sku || item.fg_sku || "").trim();
      const qty = Math.max(1, Number(item.quantity) || 1);
      // โต๊ะผลิตที่รับผิดชอบรายการนี้ (1–5) — ค่านอกช่วงถือว่าไม่ระบุ
      const rawTableNo = Math.floor(Number(item.table_no ?? item.bom?.table_no) || 0);
      const tableNo = rawTableNo >= 1 && rawTableNo <= 5 ? rawTableNo : undefined;

      // Find official formula — ใช้เฉพาะสูตรที่มีในระบบเท่านั้น ไม่รับ BOM ที่ client ส่งมาเอง
      const formula = allFormulas.find((f) => f.fg_sku.toLowerCase() === fgSku.toLowerCase());

      if (!formula || !Array.isArray(formula.items) || formula.items.length === 0) {
        return NextResponse.json(
          { success: false, message: `ไม่พบสูตรการผลิต (BOM) สำหรับสินค้า ${fgSku}` },
          { status: 400 }
        );
      }

      // Check if formula has designated primary items
      const hasDesignatedPrimary = formula.items.some((m: any) => Number(m.is_primary) === 1);

      const materials: ProductionOrderItem["materials"] = [];

      for (const mat of formula.items) {
        const perUnit = Number(mat.rm_qty_required) || 1;
        // รวมเศษเสียตามสูตรและปัดขึ้น ให้ตรงกับยอดที่แสดงในหน้าตะกร้า
        const wasteFactor = 1 + (Number(mat.waste_percentage) || 0) / 100;
        const totalRmQty = Math.ceil(perUnit * wasteFactor * qty);
        const matKey = cleanCode(mat.rm_sku || mat.rm_barcode || mat.rm_name);
        // ทำเครื่องหมายตัวหลักไว้ใช้แสดงผล (การตรวจสอบสต็อกครอบคลุมทุกวัตถุดิบแล้ว)
        const isPrimaryForThis = hasDesignatedPrimary ? Number(mat.is_primary) === 1 : true;

        const currentAgg = totalRequiredMaterialsMap.get(matKey) || {
          sku: mat.rm_sku,
          barcode: mat.rm_barcode || "",
          name: mat.rm_name || mat.rm_sku,
          unit: mat.rm_unit || "ชิ้น",
          requiredQty: 0,
          availableQty: getWh2Stock(mat.rm_sku, mat.rm_barcode, mat.rm_name),
          isPrimary: false,
        };

        currentAgg.requiredQty += totalRmQty;
        if (isPrimaryForThis) {
          currentAgg.isPrimary = true;
        }
        totalRequiredMaterialsMap.set(matKey, currentAgg);

        materials.push({
          rm_sku: mat.rm_sku || "",
          rm_barcode: mat.rm_barcode || "",
          rm_name: mat.rm_name || "",
          rm_wh: "โกดัง2",
          rm_qty_required: totalRmQty,
          rm_unit: mat.rm_unit || "ชิ้น",
          waste_percentage: mat.waste_percentage || 0,
          note: mat.note || "",
        });
      }

      formattedItems.push({
        fg_sku: formula.fg_sku || fgSku,
        fg_barcode: formula.fg_barcode || item.fg_barcode || "",
        fg_name: formula.fg_name || item.fg_name || `สินค้า ${fgSku}`,
        fg_unit: formula.fg_unit || item.fg_unit || "ชิ้น",
        table_no: tableNo,
        quantity: qty,
        produced_qty: 0,
        defect_qty: 0,
        image: item.image || `/products/${fgSku}.jpg`,
        target_warehouse_id: "wh-02",
        target_warehouse_name: "โกดัง 2 (สินค้าสำเร็จรูป)",
        materials,
      });
    }

    // ตรวจวัตถุดิบทุกรายการ (หลัก + รอง) ให้เพียงพอ — วัตถุดิบรองที่ไม่พอก็ผลิตได้จริงไม่ครบจำนวน
    for (const [, reqMat] of totalRequiredMaterialsMap.entries()) {
      if (reqMat.availableQty < reqMat.requiredQty) {
        return NextResponse.json(
          {
            success: false,
            message: `วัตถุดิบ "${reqMat.name}" (${reqMat.sku}) ในโกดัง 2 มีไม่เพียงพอ (ต้องการ ${reqMat.requiredQty} ${reqMat.unit} แต่มีในโกดัง 2 เพียง ${reqMat.availableQty.toLocaleString()} ${reqMat.unit})`,
          },
          { status: 400 }
        );
      }
    }

    // 3. Generate Order No & Document ID
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderNo = customOrderNo || `PRD-${dateStr}-${randomSuffix}`;
    const docId = `doc-prd-${Date.now()}-${randomSuffix}`;
    const nowIso = new Date().toISOString();
    const todayDate = nowIso.slice(0, 10);

    const createdByName =
      body.created_by_name ||
      session?.user?.name ||
      (actor as any).name ||
      "ผู้ดูแลระบบ (Admin)";

    const totalFgQty = formattedItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalMaterialsCount = formattedItems.reduce((sum, item) => sum + item.materials.length, 0);

    const productionOrderRecord: ProductionOrderRecord = {
      id: docId,
      order_no: orderNo,
      document_id: docId,
      reference_no: orderNo,
      status: "PENDING",
      items: formattedItems,
      total_fg_qty: totalFgQty,
      total_materials_count: totalMaterialsCount,
      created_by: actor.id || "admin",
      created_by_name: createdByName,
      created_at: nowIso,
      document_date: todayDate,
      note: note || "",
      inspections: [],
      materials_summary: Array.from(totalRequiredMaterialsMap.entries()).map(([, m]) => ({
        rm_sku: m.sku,
        rm_name: m.name,
        rm_unit: m.unit,
        planned_qty: m.requiredQty,
        used_qty: 0,
        leftover_qty: m.requiredQty,
      })),
      leftover_destination: null,
    };

    // Save in in-memory cache
    inMemoryProductionOrders.unshift(productionOrderRecord);

    const repo = getRepository();

    // 4. บันทึกใบผลิตลงแท็บเฉพาะ — "ใบผลิต" (ต่อรายการสินค้า) และ "ใบผลิต_วัตถุดิบ" (ต่อวัตถุดิบ)
    //    ยังไม่ตัดสต็อกใด ๆ — รอรอบตรวจการผลิตเป็นผู้ตัดตามจำนวนที่ผลิตได้จริง
    try {
      await ensureSheetTabExists(SHEETS.PRODUCTION_ORDERS, [...PRODUCTION_ORDER_SHEET_HEADERS]);
      await ensureSheetTabExists(SHEETS.PRODUCTION_MATERIALS, [...PRODUCTION_MATERIAL_SHEET_HEADERS]);

      const orderSheetRows = formattedItems.map(
        (item) =>
          [
            orderNo,
            docId,
            todayDate,
            "PENDING",
            item.fg_sku,
            item.fg_name,
            item.fg_unit,
            item.quantity,
            0,
            0,
            createdByName,
            nowIso,
            note || "",
            "",
            "",
            item.table_no || "",
          ] as (string | number)[]
      );

      const materialSheetRows = Array.from(totalRequiredMaterialsMap.entries()).map(
        ([, m]) =>
          [orderNo, m.sku, m.name, m.unit, m.requiredQty, 0, m.requiredQty, nowIso] as (string | number)[]
      );

      await appendRows(SHEETS.PRODUCTION_ORDERS, orderSheetRows);
      if (materialSheetRows.length > 0) {
        await appendRows(SHEETS.PRODUCTION_MATERIALS, materialSheetRows);
      }
    } catch (sheetErr) {
      console.warn("[POST /api/production/orders] Production sheets save non-fatal error:", sheetErr);
    }

    // 5. Save into Documents Google Sheets / Repository (สถานะ PENDING — ยังไม่มี movement)
    try {
      const metaPayload = JSON.stringify({
        type: "PRODUCTION_ORDER",
        order_no: orderNo,
        items: formattedItems,
        total_qty: totalFgQty,
        created_by_name: createdByName,
        user_note: note || "",
        status: "PENDING",
        created_at: nowIso,
        document_date: todayDate,
      });

      const docRow = [
        docId,
        orderNo,
        "RECEIVE",
        orderNo,
        todayDate,
        "PENDING",
        metaPayload,
        actor.id || "admin",
        nowIso,
      ];

      await appendRows(SHEETS.DOCUMENTS, [docRow]).catch((err) => {
        console.warn("[POST /api/production/orders] Sheet append fallback:", err);
      });
    } catch (sheetErr) {
      console.warn("[POST /api/production/orders] Sheet save non-fatal error:", sheetErr);
    }

    // Clear caches for updated sheets
    clearSheetCache(SHEETS.PRODUCTION_ORDERS as string);
    clearSheetCache(SHEETS.PRODUCTION_MATERIALS as string);
    clearSheetCache(SHEETS.PRODUCTION_INSPECTIONS as string);
    clearSheetCache(SHEETS.DOCUMENTS);

    // 6. Audit Log
    try {
      await logAudit(repo.audit, {
        actorId: actor.id || "admin",
        actorRole: (actor as any).role || "ADMIN",
        action: "PRODUCTION_ORDER_CREATE",
        resourceType: "Document",
        resourceId: docId,
        warehouseId: "wh-02",
        outcome: "SUCCESS",
        metadata: {
          order_no: orderNo,
          total_fg_qty: totalFgQty,
          items: formattedItems.map((i) => ({ fg_sku: i.fg_sku, qty: i.quantity })),
        },
      });
    } catch (auditErr) {
      console.warn("[POST /api/production/orders] Audit log warning:", auditErr);
    }

    return NextResponse.json(
      {
        success: true,
        data: productionOrderRecord,
        message: `สร้างใบผลิต ${orderNo} สำเร็จ! รอพนักงานตรวจการผลิต — ระบบจะตัดวัตถุดิบและเพิ่มสต็อกตามจำนวนที่ผลิตได้จริง`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[POST /api/production/orders] Error:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "เกิดข้อผิดพลาดในการสร้างใบผลิต" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { order_no, status, note } = body;

    if (!order_no || !status) {
      return NextResponse.json(
        { success: false, message: "กรุณาระบุเลขที่ใบผลิตและสถานะที่ต้องการเปลี่ยน" },
        { status: 400 }
      );
    }

    const validStatuses = ["COMPLETED", "IN_PROGRESS", "PENDING", "CANCELLED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, message: `สถานะไม่ถูกต้อง (ต้องเป็น ${validStatuses.join(" / ")})` },
        { status: 400 }
      );
    }

    const key = String(order_no).toLowerCase();

    // ห้ามยกเลิกใบผลิตที่มีรอบตรวจผ่านการอนุมัติแล้ว — สต็อกถูกตัดไปแล้วบางส่วน
    if (status === "CANCELLED") {
      const inspectionRows = await readSheet(SHEETS.PRODUCTION_INSPECTIONS, "A2:K").catch(
        () => [] as string[][]
      );
      const hasApprovedRound = inspectionRows.some(
        (r) =>
          r &&
          String(r[0] || "").trim().toLowerCase() === key &&
          String(r[10] || "").trim().toUpperCase() === "APPROVED"
      );
      const orderRows = await readSheet(SHEETS.PRODUCTION_ORDERS, "A2:J").catch(() => [] as string[][]);
      const hasProduced = orderRows.some(
        (r) =>
          r &&
          String(r[0] || "").trim().toLowerCase() === key &&
          ((Number(r[8]) || 0) > 0 || (Number(r[9]) || 0) > 0)
      );
      if (hasApprovedRound || hasProduced) {
        return NextResponse.json(
          { success: false, message: "ใบผลิตนี้มีรอบตรวจที่อนุมัติแล้ว ตัดสต็อกไปบางส่วน — ยกเลิกไม่ได้" },
          { status: 400 }
        );
      }
    }

    // Update in-memory
    const match = inMemoryProductionOrders.find((o) => o.order_no.toLowerCase() === key || o.id === order_no);
    if (match) {
      match.status = status;
      if (note !== undefined) match.note = note;
    }

    // Update แท็บ "ใบผลิต" — เขียนสถานะให้ทุกแถวของใบนี้
    try {
      const rows = await readSheet(SHEETS.PRODUCTION_ORDERS, "A2:O").catch(() => [] as string[][]);
      const batchUpdates: { rowNumber: number; values: (string | number | boolean)[] }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[0] || String(r[0]).trim().toLowerCase() !== key) continue;
        const rowValues = [...r];
        while (rowValues.length < 15) rowValues.push("");
        rowValues[3] = status;
        if (note !== undefined && String(rowValues[12] || "") === "") rowValues[12] = note;
        batchUpdates.push({ rowNumber: i + 2, values: rowValues });
      }
      if (batchUpdates.length > 0) {
        await batchUpdateRows(SHEETS.PRODUCTION_ORDERS, batchUpdates);
        clearSheetCache(SHEETS.PRODUCTION_ORDERS as string);
      }
    } catch (e) {
      console.warn("[PATCH /api/production/orders] Production sheet update non-fatal error:", e);
    }

    // Update แถว Documents (สำหรับใบเก่าและ KPI หน้าแดชบอร์ด)
    try {
      const rows = await readSheet(SHEETS.DOCUMENTS, "A2:I").catch(() => []);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r[0] === order_no || r[1] === order_no || r[3] === order_no) {
          let currentMeta: any = {};
          try {
            if (r[6] && r[6].startsWith("{")) currentMeta = JSON.parse(r[6]);
          } catch {}
          currentMeta.status = status;
          if (note !== undefined) currentMeta.user_note = note;

          await updateRow(SHEETS.DOCUMENTS, i + 2, [
            r[0],
            r[1],
            r[2],
            r[3],
            r[4],
            status,
            JSON.stringify(currentMeta),
            r[7],
            r[8],
          ]).catch(() => {});
          break;
        }
      }
    } catch (e) {
      console.warn("[PATCH /api/production/orders] Sheet update non-fatal error:", e);
    }

    return NextResponse.json({
      success: true,
      message: `อัปเดตสถานะใบผลิต ${orderNoOrPlaceholder(order_no)} เป็น ${status} สำเร็จ`,
    });
  } catch (error) {
    console.error("[PATCH /api/production/orders] Error:", error);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ" },
      { status: 500 }
    );
  }
}

function orderNoOrPlaceholder(str: string): string {
  return str || "PRD";
}
