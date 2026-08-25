import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { readSheet, appendRows, SHEETS } from "@/lib/google-sheets/client";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { parseTransferMetadata } from "@/lib/transfer-notification-utils";
import { successResponse, unauthorizedResponse, serverErrorResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();

    const repo = getRepository();
    const items: Array<{
      id: string;
      movement_id: string;
      document_id: string;
      document_no: string;
      warehouse_name: string;
      warehouse_id: string;
      from_warehouse_name?: string;
      from_warehouse_id?: string;
      to_warehouse_name?: string;
      to_warehouse_id?: string;
      created_at: string;
      created_by_name: string;
      sku: string;
      product_name: string;
      quantity: number;
      location: string;
      to_location_id?: string;
      from_location_id?: string;
      barcode: string;
      movement_type: string;
      tag: string;
      status: string;
    }> = [];

    const seenDocNos = new Set<string>();
    const seenUniqueKeys = new Set<string>();

    // 1. Preload transfer docs map to enrich items with from/to warehouse info
    const trfDocMap = new Map<
      string,
      {
        doc: any;
        from_warehouse_name: string;
        from_warehouse_id: string;
        to_warehouse_name: string;
        to_warehouse_id: string;
        to_location_id?: string;
        from_location_id?: string;
        meta: Record<string, any>;
      }
    >();

    let allDocsList: any[] = [];
    try {
      const allDocs = await repo.documents.findAll({ page: 1, limit: 9999, document_type: "TRANSFER" as any });
      allDocsList = allDocs.data || [];
      allDocsList.forEach((doc) => {
        const meta = parseTransferMetadata(doc.note);
        const fromWh = meta.from_warehouse_name || meta.from_warehouse_id || "โกดัง 1";
        const fromWhId = meta.from_warehouse_id || "wh-1";
        const toWh = meta.to_warehouse_name || meta.to_warehouse_id || "";
        const toWhId = meta.to_warehouse_id || "";
        const toLoc = meta.to_location_id || meta.from_location_id || "";
        const fromLoc = meta.from_location_id || "";
        const docNo = (doc.document_no || meta.doc_no || "").trim().toLowerCase();
        const docId = doc.document_id.trim().toLowerCase();
        const info = {
          doc,
          from_warehouse_name: fromWh,
          from_warehouse_id: fromWhId,
          to_warehouse_name: toWh,
          to_warehouse_id: toWhId,
          to_location_id: toLoc,
          from_location_id: fromLoc,
          meta,
        };
        if (docNo) trfDocMap.set(docNo, info);
        if (docId) trfDocMap.set(docId, info);
      });
    } catch (e) {
      console.warn("[GET /api/express-import/issue] Preload transfer docs map error:", e);
    }

    // 2. Read directly from Google Sheets Tab: "เบิกสินค้าเข้าExpress" (Primary Source containing user's 59 sheet items)
    try {
      const sheetRows = await readSheet(SHEETS.EXPRESS_ISSUE).catch(() => []);
      for (let idx = 0; idx < sheetRows.length; idx++) {
        const row = sheetRows[idx];
        if (!row || row.length === 0) continue;
        const col0 = String(row[0] ?? "").trim();
        if (
          col0 === "รหัสสินค้า" ||
          col0 === "SKU" ||
          col0 === "วันที่" ||
          col0 === "Date" ||
          col0 === "เลขที่เอกสาร"
        ) {
          continue;
        }

        let sku = "";
        let location = "-";
        let docNo = "";
        let whName = "โกดัง 1";
        let date = new Date().toISOString().slice(0, 10);
        let productName = "";
        let status = "รอนำเข้า Express";
        let qty = 1;
        let barcode = "";

        if (col0.includes("/") || (col0.includes("-") && col0.length === 10 && !isNaN(Date.parse(col0)))) {
          // Layout: [Date, DocNo, Barcode, SKU, ProductName, Warehouse, Location, Qty, MovedBy, ApprovedBy, Status]
          date = col0;
          docNo = String(row[1] ?? "").trim();
          barcode = String(row[2] ?? "").trim();
          sku = String(row[3] ?? "").trim();
          productName = String(row[4] ?? "").trim() || sku;
          whName = String(row[5] ?? "").trim() || "โกดัง 1";
          location = String(row[6] ?? "").trim() || "-";
          qty = Math.abs(parseFloat(String(row[7] ?? "1").replace(/,/g, "")) || 1);
          status = String(row[10] ?? row[9] ?? "รอนำเข้า Express").trim();
        } else {
          // Standard Sheet Layout: [รหัสสินค้า (SKU), ตำแหน่ง, เลขที่เอกสาร, ผู้จำหน่าย/โกดัง, วันที่เอกสาร, ชื่อสินค้า, สถานะการนำเข้า, วันที่พิมพ์/จำนวน, บาร์โค้ด]
          sku = col0;
          location = String(row[1] ?? "-").trim() || "-";
          docNo = String(row[2] ?? "").trim() || `TRF-EXPRESS-${idx + 1}`;
          whName = String(row[3] ?? "โกดัง 1").trim() || "โกดัง 1";
          date = String(row[4] ?? "").trim() || date;
          productName = String(row[5] ?? "").trim() || sku;
          status = String(row[6] ?? "รอนำเข้า Express").trim();
          const rawQty = parseFloat(String(row[7] ?? "1").replace(/,/g, ""));
          qty = !isNaN(rawQty) && rawQty > 0 ? rawQty : 1;
          const rawBarcode = String(row[8] ?? "").trim();
          barcode = rawBarcode && rawBarcode !== "-" && rawBarcode !== "null" ? rawBarcode : sku;
        }

        if (!barcode || barcode === "-" || barcode === "null") {
          barcode = to8DigitBarcode(barcode, sku) || sku;
        }

        const docNoKey = docNo.toLowerCase();
        const uniqueKey = `sheet_iss_${docNo}_${sku}_${idx}`;

        seenUniqueKeys.add(uniqueKey);
        if (docNoKey) seenDocNos.add(docNoKey);

        const trfInfo = docNo ? trfDocMap.get(docNoKey) : undefined;
        const fromWarehouseName = whName || trfInfo?.from_warehouse_name || "โกดัง 1";
        const fromWarehouseId = trfInfo?.from_warehouse_id || fromWarehouseName;
        const toWarehouseName = trfInfo?.to_warehouse_name || "";
        const toWarehouseId = trfInfo?.to_warehouse_id || "";

        items.push({
          id: uniqueKey,
          movement_id: `mov-${docNo}-${idx}`,
          document_id: docNo,
          document_no: docNo,
          warehouse_name: fromWarehouseName,
          warehouse_id: fromWarehouseId,
          from_warehouse_name: fromWarehouseName,
          from_warehouse_id: fromWarehouseId,
          to_warehouse_name: toWarehouseName,
          to_warehouse_id: toWarehouseId,
          created_at: date,
          created_by_name: "ผู้ดูแลระบบ",
          sku,
          product_name: productName,
          quantity: qty,
          location,
          barcode,
          movement_type: "TRANSFER_OUT",
          tag: "เบิกสินค้าเข้า Express",
          status: status.includes("แล้ว") || status === "IMPORTED" ? "IMPORTED" : "PENDING",
        });
      }
    } catch (e) {
      console.warn("[GET /api/express-import/issue] Sheet read error:", e);
    }

    // 3. Read approved TRANSFER documents from repository (if not already in sheet)
    const completedDocs = allDocsList.filter(
      (d) => d.status === "COMPLETED" || (d.status as string) === "POSTED" || (d.status as string) === "APPROVED"
    );

    for (const doc of completedDocs) {
      const meta = parseTransferMetadata(doc.note);

      const docNo = doc.document_no || meta.doc_no || "TRF";
      const docNoKey = docNo.toLowerCase();

      // Only add if not already loaded from the Google Sheet
      if (docNoKey && seenDocNos.has(docNoKey)) continue;

      const sku = meta.sku || meta.product_id?.replace(/^prod-/, "") || "";
      const rawBarcode = meta.barcode || "";
      const barcode =
        rawBarcode && rawBarcode !== "-" && rawBarcode !== "null"
          ? rawBarcode
          : to8DigitBarcode(rawBarcode, sku) || sku;

      const productName = meta.product_name || sku || "สินค้า";
      const uniqueKey = `iss_trf-mov-${doc.document_id}_${sku}`;

      if (seenUniqueKeys.has(uniqueKey)) continue;
      seenUniqueKeys.add(uniqueKey);
      if (docNoKey) seenDocNos.add(docNoKey);

      const trfInfo = docNo ? trfDocMap.get(docNoKey) : undefined;
      const fromWarehouseName = meta.from_warehouse_name || meta.from_warehouse_id || trfInfo?.from_warehouse_name || "โกดัง 1";
      const fromWarehouseId = meta.from_warehouse_id || trfInfo?.from_warehouse_id || "wh-1";
      const toWarehouseName = meta.to_warehouse_name || meta.to_warehouse_id || trfInfo?.to_warehouse_name || "";
      const toWarehouseId = meta.to_warehouse_id || trfInfo?.to_warehouse_id || "";

      const toLoc = meta.to_location_id || meta.to_location || meta.completed_location_id || trfInfo?.to_location_id || "";
      const fromLoc = meta.from_location_id || meta.from_location || trfInfo?.from_location_id || "-";

      items.push({
        id: uniqueKey,
        movement_id: `trf-mov-${doc.document_id}`,
        document_id: doc.document_id,
        document_no: docNo,
        warehouse_name: fromWarehouseName,
        warehouse_id: fromWarehouseId,
        from_warehouse_name: fromWarehouseName,
        from_warehouse_id: fromWarehouseId,
        to_warehouse_name: toWarehouseName,
        to_warehouse_id: toWarehouseId,
        created_at: (meta.completed_at || doc.created_at || new Date().toISOString()).slice(0, 10),
        created_by_name: meta.moved_by || meta.assigned_to_name || "ผู้ใช้งาน",
        sku,
        product_name: productName,
        quantity: Math.abs(Number(meta.qty) || 1),
        location: toLoc || fromLoc,
        to_location_id: toLoc,
        from_location_id: fromLoc,
        barcode,
        movement_type: "TRANSFER_OUT",
        tag: meta.express_tag || "เบิกสินค้าเข้า Express",
        status: meta.express_status === "IMPORTED" ? "IMPORTED" : "PENDING",
      });
    }

    // 4. Read standalone issue / outbound movements from repository (if not already in list)
    try {
      const movResult = await repo.movements.findAll({ page: 1, limit: 2000 });
      const outboundMovements = (movResult.data || []).filter(
        (m: any) =>
          m.movement_type === "ISSUE" ||
          m.movement_type === "ISSUE_OUT" ||
          (m.movement_type === "TRANSFER_OUT" && !m.document_id?.startsWith("doc-trf-")) ||
          (Number(m.qty_change) < 0 && !m.document_no?.startsWith("TRF"))
      );

      for (const m of outboundMovements) {
        const docNo = m.document_no || m.document_id || "";
        const docNoKey = docNo.toLowerCase();

        if (docNoKey && seenDocNos.has(docNoKey)) continue;

        const sku = m.sku || m.product_id?.replace(/^prod-/, "") || "";
        const uniqueKey = `iss_${m.movement_id || m.document_id}_${sku}`;

        if (seenUniqueKeys.has(uniqueKey)) continue;
        seenUniqueKeys.add(uniqueKey);
        if (docNoKey) seenDocNos.add(docNoKey);

        const rawBarcode = (m as any).barcode || "";
        const barcode =
          rawBarcode && rawBarcode !== "-" && rawBarcode !== "null"
            ? rawBarcode
            : to8DigitBarcode(rawBarcode, sku) || sku;

        const trfInfo = docNo ? trfDocMap.get(docNoKey) : undefined;
        const fromWarehouseName = (m as any).from_warehouse_name || trfInfo?.from_warehouse_name || m.warehouse_name || "โกดัง 1";
        const toWarehouseName = (m as any).to_warehouse_name || trfInfo?.to_warehouse_name || "";
        const toLoc = (m as any).to_location_id || trfInfo?.to_location_id || m.location_id || "-";

        items.push({
          id: uniqueKey,
          movement_id: m.movement_id,
          document_id: m.document_id || docNo,
          document_no: docNo || "ISS",
          warehouse_name: fromWarehouseName,
          warehouse_id: m.warehouse_id || "wh-1",
          from_warehouse_name: fromWarehouseName,
          from_warehouse_id: m.warehouse_id || "wh-1",
          to_warehouse_name: toWarehouseName,
          to_warehouse_id: (m as any).to_warehouse_id || "",
          created_at: (m.created_at || new Date().toISOString()).slice(0, 10),
          created_by_name: m.created_by_name || "ผู้ใช้งาน",
          sku,
          product_name: m.product_name || sku || "สินค้า",
          quantity: Math.abs(Number(m.qty_change) || 1),
          location: toLoc,
          to_location_id: toLoc,
          from_location_id: m.location_id || "-",
          barcode,
          movement_type: m.movement_type || "ISSUE_OUT",
          tag: "เบิกสินค้าเข้า Express",
          status: "PENDING",
        });
      }
    } catch (movErr) {
      console.warn("[GET /api/express-import/issue] Repo movements scan error:", movErr);
    }

    return successResponse(items, "โหลดรายการเบิกสินค้าเข้า Express สำเร็จ");
  } catch (error) {
    return serverErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();

    const body = await req.json().catch(() => ({}));
    const {
      sku = "",
      location = "-",
      document_no = "TRF",
      warehouse_name = "โกดัง 1",
      document_date = new Date().toISOString().slice(0, 10),
      product_name = "",
      status = "รอนำเข้า Express",
      quantity = 1,
      barcode = "",
    } = body;

    // Row format matching User's Google Sheet columns:
    // [รหัสสินค้า, ตำแหน่ง, เลขที่เอกสาร, ผู้จำหน่าย/โกดัง, วันที่เอกสาร, ชื่อสินค้า, สถานะการนำเข้า, วันที่พิมพ์/จำนวน, บาร์โค้ด]
    const row = [
      String(sku).trim(),
      String(location).trim(),
      String(document_no).trim(),
      String(warehouse_name).trim(),
      String(document_date).trim(),
      String(product_name || sku).trim(),
      String(status).trim(),
      Number(quantity) || 1,
      String(barcode || sku).trim(),
    ];

    try {
      await appendRows(SHEETS.EXPRESS_ISSUE, [row]);
    } catch (sheetErr) {
      console.error("[POST /api/express-import/issue] appendRows error:", sheetErr);
      return serverErrorResponse(sheetErr);
    }

    return successResponse(row, "บันทึกข้อมูลลงแท็บชีต เบิกสินค้าเข้าExpress เรียบร้อยแล้ว", 201);
  } catch (error) {
    return serverErrorResponse(error);
  }
}
