import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import {
  readSheet,
  appendRows,
  batchUpdateRows,
  SHEETS,
  getWarehouseSheetName,
  clearSheetCache,
} from "@/lib/google-sheets/client";
import { logAudit } from "@/lib/audit";
import type { StockMovement } from "@/types/models";

export const maxDuration = 60;

// ตัดสต็อกชั่วคราวทำงานกับ "โกดัง2" เท่านั้นตามขอบเขตของหน้างาน
const WAREHOUSE_ID = "wh-02";
const META_TYPE = "TEMP_STOCK_CUT";
const REF_PREFIX = "TSC";

export interface TempStockCutRecord {
  id: string;
  cut_no: string;
  document_id: string;
  warehouse_id: string;
  warehouse_name: string;
  sku: string;
  barcode: string;
  product_name: string;
  quantity: number;
  stock_before: number;
  stock_after: number;
  reason: string;
  note: string;
  direction: "CUT" | "ADD";
  created_by: string;
  created_by_name: string;
  created_at: string;
}

interface CutItemInput {
  sku: string;
  product_name?: string;
  quantity: number;
  reason: string;
  note?: string;
  /** CUT = ตัดออก (default), ADD = เพิ่มเข้า */
  direction?: "CUT" | "ADD";
}

function cleanCode(str?: string): string {
  if (!str) return "";
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/^prod-/, "")
    .replace(/[\s\-_]/g, "");
}

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const repo = getRepository();
    const docsResult = await repo.documents.findAll({ page: 1, limit: 1000 }).catch(() => ({ data: [] }));
    const allDocs = docsResult.data || [];

    const records: TempStockCutRecord[] = [];
    for (const doc of allDocs) {
      let meta: any = null;
      try {
        if (doc.note && doc.note.includes(META_TYPE) && doc.note.startsWith("{")) {
          meta = JSON.parse(doc.note);
        }
      } catch {
        continue;
      }
      if (!meta || meta.type !== META_TYPE) continue;

      const base = {
        cut_no: meta.cut_no || doc.reference_no || doc.document_no || doc.document_id,
        document_id: doc.document_id,
        warehouse_id: meta.warehouse_id || WAREHOUSE_ID,
        warehouse_name: meta.warehouse_name || "โกดัง2",
        created_by: doc.created_by || meta.created_by || "admin",
        created_by_name: meta.created_by_name || "ผู้ใช้งาน",
        created_at: doc.created_at || meta.created_at || "",
      };

      // เอกสารแบบหลายรายการ — แยกเป็น record รายสินค้า
      if (Array.isArray(meta.items) && meta.items.length > 0) {
        meta.items.forEach((line: any, i: number) => {
          records.push({
            ...base,
            id: `${doc.document_id}-${i}`,
            sku: line.sku || "",
            barcode: line.barcode || "",
            product_name: line.product_name || line.sku || "-",
            quantity: Number(line.quantity) || 0,
            stock_before: Number(line.stock_before) || 0,
            stock_after: Number(line.stock_after) || 0,
            reason: line.reason || "-",
            note: line.note || "",
            direction: line.direction === "ADD" ? "ADD" : "CUT",
          });
        });
      } else {
        // เอกสารเดิมแบบรายการเดียว
        records.push({
          ...base,
          id: doc.document_id,
          sku: meta.sku || "",
          barcode: meta.barcode || "",
          product_name: meta.product_name || meta.sku || "-",
          quantity: Number(meta.quantity) || 0,
          stock_before: Number(meta.stock_before) || 0,
          stock_after: Number(meta.stock_after) || 0,
          reason: meta.reason || "-",
          note: meta.note || "",
          direction: "CUT",
        });
      }
    }

    records.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    return NextResponse.json({ success: true, data: records, total: records.length });
  } catch (error) {
    console.error("[GET /api/temporary-stock-cuts] Error:", error);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดในการดึงประวัติการตัดสต็อกชั่วคราว" },
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
    const rawItems: CutItemInput[] = Array.isArray(body.items) ? body.items : [];

    if (rawItems.length === 0) {
      return NextResponse.json({ success: false, message: "กรุณาเพิ่มรายการที่ต้องการตัดสต็อกอย่างน้อย 1 รายการ" }, { status: 400 });
    }

    // 1. ตรวจรูปแบบรายการแต่ละบรรทัดก่อนแตะชีต
    const items = rawItems.map((it, i) => {
      const sku = String(it.sku || "").trim();
      const quantity = Number(it.quantity);
      const reason = String(it.reason || "").trim();
      const note = String(it.note || "").trim();
      const direction = it.direction === "ADD" ? "ADD" : "CUT";
      if (!sku) {
        throw { status: 400, message: `รายการที่ ${i + 1}: กรุณาระบุรหัสสินค้า` };
      }
      if (!reason) {
        throw { status: 400, message: `รายการที่ ${i + 1} (${sku}): กรุณาเลือกเหตุผล` };
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw { status: 400, message: `รายการที่ ${i + 1} (${sku}): จำนวนต้องมากกว่า 0` };
      }
      return { sku, product_name: String(it.product_name || "").trim(), quantity, reason, note, direction };
    });

    // 2. อ่านสต็อกล่าสุดของโกดัง2แบบสดครั้งเดียว (layout: [SKU, Barcode, ชื่อ, หมวด, หน่วย, จำนวน, ตำแหน่ง, ผู้จำหน่าย, อัปเดตล่าสุด])
    const wh2SheetName = getWarehouseSheetName(WAREHOUSE_ID);
    clearSheetCache(wh2SheetName);
    const rows: string[][] = await readSheet(wh2SheetName, "A2:Z", { forceFresh: true }).catch(() => []);

    const rowBySku = new Map<string, { rowIndex: number; qty: number }>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[0]) continue;
      const key = cleanCode(r[0]);
      const qty = parseFloat(String(r[5] || r[4] || "0").replace(/,/g, "").trim()) || 0;
      rowBySku.set(key, { rowIndex: i, qty });
      if (r[1]) {
        const bKey = cleanCode(r[1]);
        if (!rowBySku.has(bKey)) rowBySku.set(bKey, { rowIndex: i, qty });
      }
    }

    // 3. รวมยอดตาม SKU (+เพิ่ม / −ตัด) แล้วตรวจยอดสุดท้ายให้ครบทุกรายการก่อน (all-or-nothing)
    const requiredBySku = new Map<string, { sku: string; totalAdd: number; totalCut: number; names: Set<string> }>();
    for (const it of items) {
      const key = cleanCode(it.sku);
      const agg =
        requiredBySku.get(key) || { sku: it.sku, totalAdd: 0, totalCut: 0, names: new Set<string>() };
      if (it.direction === "ADD") agg.totalAdd += it.quantity;
      else agg.totalCut += it.quantity;
      if (it.product_name) agg.names.add(it.product_name);
      requiredBySku.set(key, agg);
    }

    const stockErrors: string[] = [];
    for (const [key, agg] of requiredBySku) {
      const row = rowBySku.get(key);
      const displayName = agg.names.values().next().value || agg.sku;
      if (!row) {
        stockErrors.push(`ไม่พบสินค้า ${agg.sku} ในโกดัง2`);
      } else {
        const finalQty = row.qty + agg.totalAdd - agg.totalCut;
        if (finalQty < 0) {
          stockErrors.push(
            `"${displayName}" (${agg.sku}) สต็อกไม่พอ — มี ${row.qty} ต้องการตัด ${agg.totalCut} (เพิ่ม ${agg.totalAdd})`
          );
        }
      }
    }
    if (stockErrors.length > 0) {
      return NextResponse.json(
        { success: false, message: stockErrors.slice(0, 3).join(" • ") },
        { status: 400 }
      );
    }

    // 4. ตัดยอดทุกรายการในชีตแบบ batch (A2:Z → index 0 = แถวที่ 2 ของชีต)
    const nowIso = new Date().toISOString();
    const todayDate = nowIso.slice(0, 10);
    const dateStr = todayDate.replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const cutNo = `${REF_PREFIX}-${dateStr}-${randomSuffix}`;
    const docId = `doc-tsc-${Date.now()}-${randomSuffix}`;

    const createdByName =
      body.created_by_name || session?.user?.name || (actor as any).name || "ผู้ใช้งาน";

    const batchUpdates: { rowNumber: number; values: (string | number | boolean)[] }[] = [];
    const finalQtyBySkuKey = new Map<string, number>();

    for (const [key, agg] of requiredBySku) {
      const row = rowBySku.get(key)!;
      const existingRow = [...rows[row.rowIndex]];
      while (existingRow.length < 9) existingRow.push("");
      const stockAfter = Math.max(0, Number((row.qty + agg.totalAdd - agg.totalCut).toFixed(4)));
      existingRow[5] = String(stockAfter);
      existingRow[8] = nowIso;
      batchUpdates.push({ rowNumber: row.rowIndex + 2, values: existingRow });
      finalQtyBySkuKey.set(key, stockAfter);
    }

    if (batchUpdates.length > 0) {
      await batchUpdateRows(wh2SheetName, batchUpdates);
    }

    // 5. บันทึก StockMovement รายการ (ADD = เข้า, CUT = ออก)
    const repo = getRepository();
    const movements: Omit<StockMovement, "movement_id" | "created_at">[] = items.map((it, i) => {
      const row = rows[rowBySku.get(cleanCode(it.sku))!.rowIndex];
      return {
        document_id: docId,
        product_id: it.sku,
        warehouse_id: WAREHOUSE_ID,
        location_id: String(row?.[6] || "").trim(),
        qty_change: it.direction === "ADD" ? it.quantity : -it.quantity,
        movement_type: "ADJUST",
        idempotency_key: `tsc-${docId}-${i}`,
        created_by: actor.id || "admin",
      };
    });
    await repo.movements.batchCreate(movements).catch((err) => {
      console.warn("[POST /api/temporary-stock-cuts] batchCreate movements warning:", err);
      return [];
    });

    // 6. บันทึกเอกสารกลางฉบับเดียว พร้อมรายละเอียดรายการใน note (JSON)
    const lineRecords = items.map((it, i) => {
      const key = cleanCode(it.sku);
      const row = rows[rowBySku.get(key)!.rowIndex];
      return {
        sku: it.sku,
        barcode: String(row?.[1] || "").trim(),
        product_name: it.product_name || String(row?.[2] || it.sku).trim(),
        quantity: it.quantity,
        direction: it.direction,
        stock_before: rowBySku.get(key)!.qty,
        stock_after: finalQtyBySkuKey.get(key) ?? 0,
        reason: it.reason,
        note: it.note,
        line_no: i + 1,
      };
    });

    const cutCount = items.filter((it) => it.direction !== "ADD").length;
    const addCount = items.filter((it) => it.direction === "ADD").length;
    const cutQty = items.filter((it) => it.direction !== "ADD").reduce((s, it) => s + it.quantity, 0);
    const addQty = items.filter((it) => it.direction === "ADD").reduce((s, it) => s + it.quantity, 0);

    const metaPayload = JSON.stringify({
      type: META_TYPE,
      cut_no: cutNo,
      warehouse_id: WAREHOUSE_ID,
      warehouse_name: "โกดัง2",
      item_count: items.length,
      items: lineRecords,
      created_by_name: createdByName,
      created_at: nowIso,
      document_date: todayDate,
    });

    await appendRows(SHEETS.DOCUMENTS, [
      [docId, cutNo, "ADJUST", cutNo, todayDate, "POSTED", metaPayload, actor.id || "admin", nowIso],
    ]).catch((err) => {
      console.warn("[POST /api/temporary-stock-cuts] Sheet append fallback:", err);
    });

    // 7. เคลียร์ cache ให้หน้าอื่นเห็นยอดใหม่
    clearSheetCache(wh2SheetName);
    clearSheetCache(WAREHOUSE_ID);
    clearSheetCache(SHEETS.STOCK_MOVEMENTS);
    clearSheetCache(SHEETS.STOCK_SUMMARY);
    clearSheetCache(SHEETS.DOCUMENTS);

    // 8. Audit log
    try {
      await logAudit(repo.audit, {
        actorId: actor.id || "admin",
        actorRole: (actor as any).role || "ADMIN",
        action: "STOCK_TEMP_CUT",
        resourceType: "Document",
        resourceId: docId,
        warehouseId: WAREHOUSE_ID,
        outcome: "SUCCESS",
        metadata: {
          cut_no: cutNo,
          item_count: items.length,
          cut_count: cutCount,
          add_count: addCount,
          cut_qty: cutQty,
          add_qty: addQty,
          items: lineRecords.map((l) => ({ sku: l.sku, quantity: l.quantity, direction: l.direction, reason: l.reason })),
        },
      });
    } catch (auditErr) {
      console.warn("[POST /api/temporary-stock-cuts] Audit log warning:", auditErr);
    }

    const parts: string[] = [];
    if (cutCount > 0) parts.push(`ตัดสต็อก ${cutCount} รายการ (${cutQty} ชิ้น)`);
    if (addCount > 0) parts.push(`เพิ่มสต็อก ${addCount} รายการ (${addQty} ชิ้น)`);
    return NextResponse.json(
      {
        success: true,
        data: { cut_no: cutNo, document_id: docId, items: lineRecords, cut_qty: cutQty, add_qty: addQty },
        message: `${parts.join(" และ ")} เรียบร้อยแล้ว`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error && typeof error.status === "number") {
      return NextResponse.json({ success: false, message: error.message }, { status: error.status });
    }
    console.error("[POST /api/temporary-stock-cuts] Error:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "เกิดข้อผิดพลาดในการตัดสต็อกชั่วคราว" },
      { status: 500 }
    );
  }
}
