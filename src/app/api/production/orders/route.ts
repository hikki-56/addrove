import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { readSheet, appendRows, updateRow, SHEETS, getWarehouseSheetName, clearSheetCache } from "@/lib/google-sheets/client";
import { bomRepository } from "@/lib/repositories/sheets/bom.repository";
import { logAudit } from "@/lib/audit";
import type { StockMovement } from "@/types/models";

function cleanCode(str?: string): string {
  if (!str) return "";
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/^prod-/, "")
    .replace(/[\s\-_]/g, "");
}

export interface ProductionMaterialItem {
  rm_sku: string;
  rm_barcode?: string;
  rm_name: string;
  rm_wh: string;
  rm_qty_required: number;
  rm_unit: string;
  waste_percentage?: number;
  note?: string;
}

export interface ProductionOrderItem {
  fg_sku: string;
  fg_barcode: string;
  fg_name: string;
  fg_unit: string;
  quantity: number;
  image?: string;
  target_warehouse_id: string;
  target_warehouse_name: string;
  materials: ProductionMaterialItem[];
}

export interface ProductionOrderRecord {
  id: string;
  order_no: string;
  document_id: string;
  reference_no?: string;
  status: "COMPLETED" | "IN_PROGRESS" | "PENDING" | "CANCELLED";
  items: ProductionOrderItem[];
  total_fg_qty: number;
  total_materials_count: number;
  created_by: string;
  created_by_name: string;
  created_at: string;
  document_date: string;
  note?: string;
}

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

    // Fetch documents with reference starting with PRD or note containing PRODUCTION_ORDER
    const repo = getRepository();
    const docsResult = await repo.documents.findAll({ page: 1, limit: 1000 }).catch(() => ({ data: [] }));
    const allDocs = docsResult.data || [];

    const orderMap = new Map<string, ProductionOrderRecord>();

    // 1. Process documents from sheet/repo
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

        orderMap.set(orderNo.toLowerCase(), order);
      } catch (err) {
        console.warn("[ProductionOrders GET] Parse error for doc:", doc.document_id, err);
      }
    }

    // 2. Merge in-memory orders (for newly created or optimistic records)
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
      { success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลประวัติการสั่งผลิต" },
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
    const wh2ItemDetails = new Map<string, { sku: string; barcode: string; name: string; category: string; unit: string; location: string; supplier: string }>();

    for (const r of wh2Rows) {
      if (!r || !r[0]) continue;
      const rowSku = (r[0] || "").trim();
      const rowBarcode = (r[1] || "").trim();
      const rowName = (r[2] || "").trim();
      const rawQty = parseFloat(String(r[5] || r[4] || "0").replace(/,/g, "").trim());
      const qty = isNaN(rawQty) ? 0 : Math.max(0, rawQty);

      const info = {
        sku: rowSku,
        barcode: rowBarcode,
        name: rowName,
        category: (r[3] || "ทั่วไป").trim(),
        unit: (r[4] || "ชิ้น").trim(),
        location: (r[6] || "").trim(),
        supplier: (r[7] || "คลังสินค้า").trim(),
      };

      if (rowSku) {
        wh2StockBySku.set(rowSku, (wh2StockBySku.get(rowSku) || 0) + qty);
        wh2StockByCleanSku.set(cleanCode(rowSku), (wh2StockByCleanSku.get(cleanCode(rowSku)) || 0) + qty);
        if (!wh2ItemDetails.has(cleanCode(rowSku))) wh2ItemDetails.set(cleanCode(rowSku), info);
      }
      if (rowBarcode && rowBarcode !== "-") {
        wh2StockByBarcode.set(rowBarcode, (wh2StockByBarcode.get(rowBarcode) || 0) + qty);
        wh2StockByCleanSku.set(cleanCode(rowBarcode), (wh2StockByCleanSku.get(cleanCode(rowBarcode)) || 0) + qty);
        if (!wh2ItemDetails.has(cleanCode(rowBarcode))) wh2ItemDetails.set(cleanCode(rowBarcode), info);
      }
      if (rowName) {
        wh2StockByName.set(cleanCode(rowName), (wh2StockByName.get(cleanCode(rowName)) || 0) + qty);
        if (!wh2ItemDetails.has(cleanCode(rowName))) wh2ItemDetails.set(cleanCode(rowName), info);
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
    const totalRequiredMaterialsMap = new Map<string, { sku: string; name: string; unit: string; requiredQty: number; availableQty: number }>();
    const formattedItems: ProductionOrderItem[] = [];

    for (const item of items) {
      const fgSku = (item.bom?.fg_sku || item.fg_sku || "").trim();
      const qty = Math.max(1, Number(item.quantity) || 1);

      // Find official formula
      const formula =
        allFormulas.find((f) => f.fg_sku.toLowerCase() === fgSku.toLowerCase()) ||
        item.bom;

      if (!formula || !Array.isArray(formula.items) || formula.items.length === 0) {
        return NextResponse.json(
          { success: false, message: `ไม่พบสูตรการผลิต (BOM) สำหรับสินค้า ${fgSku}` },
          { status: 400 }
        );
      }

      const materials: ProductionMaterialItem[] = [];

      for (const mat of formula.items) {
        const perUnit = Number(mat.rm_qty_required) || 1;
        const totalRmQty = Number((perUnit * qty).toFixed(4));
        const matKey = cleanCode(mat.rm_sku || mat.rm_barcode || mat.rm_name);

        const currentAgg = totalRequiredMaterialsMap.get(matKey) || {
          sku: mat.rm_sku,
          name: mat.rm_name || mat.rm_sku,
          unit: mat.rm_unit || "ชิ้น",
          requiredQty: 0,
          availableQty: getWh2Stock(mat.rm_sku, mat.rm_barcode, mat.rm_name),
        };

        currentAgg.requiredQty += totalRmQty;
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
        quantity: qty,
        image: formula.image || item.image || `/products/${fgSku}.jpg`,
        target_warehouse_id: "wh-02",
        target_warehouse_name: "โกดัง 2 (สินค้าสำเร็จรูป)",
        materials,
      });
    }

    // Check if any material is insufficient in Warehouse 2
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
      status: "COMPLETED",
      items: formattedItems,
      total_fg_qty: totalFgQty,
      total_materials_count: totalMaterialsCount,
      created_by: actor.id || "admin",
      created_by_name: createdByName,
      created_at: nowIso,
      document_date: todayDate,
      note: note || "",
    };

    // Save in in-memory cache
    inMemoryProductionOrders.unshift(productionOrderRecord);

    const repo = getRepository();

    // 4. Create Stock Movements:
    // Finished Goods (+qty into wh-02)
    // Raw Materials (-required_qty from wh-02)
    const movementsToCreate: Omit<StockMovement, "movement_id" | "created_at">[] = [];

    // FG Movements (+qty)
    formattedItems.forEach((fgItem, fgIdx) => {
      movementsToCreate.push({
        document_id: docId,
        product_id: fgItem.fg_sku,
        warehouse_id: "wh-02",
        location_id: "",
        qty_change: fgItem.quantity,
        movement_type: "RECEIVE",
        idempotency_key: `prd-${docId}-fg-${fgIdx}`,
        created_by: actor.id || "admin",
      });

      // RM Movements (-qty)
      fgItem.materials.forEach((mat, matIdx) => {
        movementsToCreate.push({
          document_id: docId,
          product_id: mat.rm_sku,
          warehouse_id: "wh-02",
          location_id: "",
          qty_change: -mat.rm_qty_required,
          movement_type: "ISSUE_OUT",
          idempotency_key: `prd-${docId}-rm-${fgIdx}-${matIdx}`,
          created_by: actor.id || "admin",
        });
      });
    });

    // Save Movements in Batch
    const createdMovements = await repo.movements.batchCreate(movementsToCreate).catch((err) => {
      console.warn("[POST /api/production/orders] batchCreate movements warning:", err);
      return [];
    });

    // Apply changes to StockSummary
    try {
      await repo.stockSummary.applyChanges(
        movementsToCreate.map((m) => ({
          productId: m.product_id,
          warehouseId: m.warehouse_id,
          locationId: m.location_id,
          delta: m.qty_change,
        }))
      );
    } catch (sumErr) {
      console.warn("[POST /api/production/orders] stockSummary.applyChanges warning:", sumErr);
    }

    // 5. Update Inventory in Google Sheets (Tab: โกดัง2)
    try {
      const freshWh2Rows: string[][] = await readSheet(wh2SheetName, "A1:Z", { forceFresh: true }).catch(() => []);
      
      if (freshWh2Rows.length > 0) {
        // 5.1 Update / Add Finished Goods in โกดัง 2
        for (const fgItem of formattedItems) {
          const normFgSku = cleanCode(fgItem.fg_sku);
          let fgRowIndex = -1;
          for (let i = 1; i < freshWh2Rows.length; i++) {
            const r = freshWh2Rows[i];
            if (!r || !r[0]) continue;
            if (cleanCode(r[0]) === normFgSku || cleanCode(r[1]) === normFgSku) {
              fgRowIndex = i;
              break;
            }
          }

          if (fgRowIndex !== -1) {
            const existingRow = [...freshWh2Rows[fgRowIndex]];
            while (existingRow.length < 9) existingRow.push("");
            const curQty = parseFloat(String(existingRow[5] || existingRow[4] || "0").replace(/,/g, "")) || 0;
            const newQty = curQty + fgItem.quantity;
            existingRow[5] = String(newQty);
            existingRow[8] = nowIso;
            const sheetRowNum = fgRowIndex + 1;
            await updateRow(wh2SheetName, sheetRowNum, existingRow);
            freshWh2Rows[fgRowIndex] = existingRow;
          } else {
            // Append new FG row to โกดัง 2
            const newFgRow = [
              fgItem.fg_sku,
              fgItem.fg_barcode || "",
              fgItem.fg_name,
              "สินค้าสำเร็จรูป",
              fgItem.fg_unit || "ชิ้น",
              String(fgItem.quantity),
              "",
              "ฝ่ายผลิต (BOM)",
              nowIso,
            ];
            await appendRows(wh2SheetName, [newFgRow]);
            freshWh2Rows.push(newFgRow);
          }
        }

        // 5.2 Deduct Raw Materials from โกดัง 2
        for (const [, reqMat] of totalRequiredMaterialsMap.entries()) {
          const normMatSku = cleanCode(reqMat.sku);
          let rmRowIndex = -1;
          for (let i = 1; i < freshWh2Rows.length; i++) {
            const r = freshWh2Rows[i];
            if (!r || !r[0]) continue;
            if (
              cleanCode(r[0]) === normMatSku ||
              cleanCode(r[1]) === normMatSku ||
              cleanCode(r[2]).includes(normMatSku)
            ) {
              rmRowIndex = i;
              break;
            }
          }

          if (rmRowIndex !== -1) {
            const existingRow = [...freshWh2Rows[rmRowIndex]];
            while (existingRow.length < 9) existingRow.push("");
            const curQty = parseFloat(String(existingRow[5] || existingRow[4] || "0").replace(/,/g, "")) || 0;
            const newQty = Math.max(0, curQty - reqMat.requiredQty);
            existingRow[5] = String(newQty);
            existingRow[8] = nowIso;
            const sheetRowNum = rmRowIndex + 1;
            await updateRow(wh2SheetName, sheetRowNum, existingRow);
            freshWh2Rows[rmRowIndex] = existingRow;
          }
        }
      }
    } catch (syncErr) {
      console.error("[POST /api/production/orders] Sheet inventory update error:", syncErr);
    }

    // Clear caches for updated sheets
    clearSheetCache(wh2SheetName);
    clearSheetCache("wh-02");
    clearSheetCache(SHEETS.STOCK_MOVEMENTS);
    clearSheetCache(SHEETS.STOCK_SUMMARY);
    clearSheetCache(SHEETS.DOCUMENTS);

    // 6. Save into Documents Google Sheets / Repository
    try {
      const metaPayload = JSON.stringify({
        type: "PRODUCTION_ORDER",
        order_no: orderNo,
        items: formattedItems,
        total_qty: totalFgQty,
        created_by_name: createdByName,
        user_note: note || "",
        status: "COMPLETED",
        created_at: nowIso,
        document_date: todayDate,
      });

      const docRow = [
        docId,
        orderNo,
        "RECEIVE",
        orderNo,
        todayDate,
        "COMPLETED",
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

    // 7. Audit Log
    try {
      await logAudit(repo.audit, {
        actorId: actor.id || "admin",
        actorRole: (actor as any).role || "ADMIN",
        action: "STOCK_RECEIVE",
        resourceType: "Document",
        resourceId: docId,
        warehouseId: "wh-02",
        outcome: "SUCCESS",
        metadata: {
          order_no: orderNo,
          total_fg_qty: totalFgQty,
          movements_count: createdMovements.length,
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
        message: `สั่งผลิตสำเร็จ! เพิ่มสินค้า ${totalFgQty} ชิ้นเข้าโกดัง 2 และตัดสต็อกวัตถุดิบเรียบร้อยแล้ว`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[POST /api/production/orders] Error:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "เกิดข้อผิดพลาดในการสร้างคำสั่งผลิต" },
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
        { success: false, message: "กรุณาระบุเลขที่คำสั่งผลิตและสถานะที่ต้องการเปลี่ยน" },
        { status: 400 }
      );
    }

    // Update in-memory
    const match = inMemoryProductionOrders.find(
      (o) => o.order_no.toLowerCase() === order_no.toLowerCase() || o.id === order_no
    );
    if (match) {
      match.status = status;
      if (note !== undefined) match.note = note;
    }

    // Attempt updating in sheet if possible
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
      message: `อัปเดตสถานะคำสั่งผลิต ${orderNoOrPlaceholder(order_no)} เป็น ${status} สำเร็จ`,
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
