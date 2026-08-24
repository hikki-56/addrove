import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { readSheet, appendRows, SHEETS } from "@/lib/google-sheets/client";
import { to8DigitBarcode } from "@/lib/barcode-utils";
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

    // Preload transfer docs map to enrich all items (sheet or repo) with from/to warehouse info
    const trfDocMap = new Map<
      string,
      {
        from_warehouse_name: string;
        from_warehouse_id: string;
        to_warehouse_name: string;
        to_warehouse_id: string;
        to_location_id?: string;
        from_location_id?: string;
      }
    >();
    try {
      const allDocs = await repo.documents.findAll({ page: 1, limit: 9999, document_type: "TRANSFER" as any });
      (allDocs.data || []).forEach((doc) => {
        let meta: Record<string, any> = {};
        try {
          if (doc.note && typeof doc.note === "string" && doc.note.startsWith("{")) {
            meta = JSON.parse(doc.note);
          }
        } catch {}
        const fromWh = meta.from_warehouse_name || meta.from_warehouse_id || "โกดัง 1";
        const fromWhId = meta.from_warehouse_id || "wh-1";
        const toWh = meta.to_warehouse_name || meta.to_warehouse_id || "";
        const toWhId = meta.to_warehouse_id || "";
        const toLoc = meta.to_location_id || meta.to_location || meta.completed_location_id || "";
        const fromLoc = meta.from_location_id || meta.from_location || "";
        const docNo = (doc.document_no || meta.doc_no || "").trim().toLowerCase();
        const docId = doc.document_id.trim().toLowerCase();
        const info = {
          from_warehouse_name: fromWh,
          from_warehouse_id: fromWhId,
          to_warehouse_name: toWh,
          to_warehouse_id: toWhId,
          to_location_id: toLoc,
          from_location_id: fromLoc,
        };
        if (docNo) trfDocMap.set(docNo, info);
        if (docId) trfDocMap.set(docId, info);
      });
    } catch (e) {
      console.warn("[GET /api/express-import/issue] Preload transfer docs map error:", e);
    }

    // 1. Read directly from Google Sheets Tab: "เบิกสินค้าเข้าExpress"
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

        // Check if Col 0 is Date or SKU
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
          // Layout matching User's Sheet: [รหัสสินค้า, ตำแหน่ง, เลขที่เอกสาร, ผู้จำหน่าย/โกดัง, วันที่เอกสาร, ชื่อสินค้า, สถานะการนำเข้า, วันที่พิมพ์/จำนวน, บาร์โค้ด]
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

        const uniqueKey = `sheet_iss_${docNo}_${sku}_${idx}`;
        if (docNo) seenDocNos.add(docNo.toLowerCase());

        const trfInfo = docNo ? trfDocMap.get(docNo.toLowerCase()) : undefined;
        const fromWarehouseName = trfInfo?.from_warehouse_name || whName;
        const fromWarehouseId = trfInfo?.from_warehouse_id || whName;
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

    // 2. Read approved TRANSFER documents from repository
    try {
      const allDocs = await repo.documents.findAll({ page: 1, limit: 9999, document_type: "TRANSFER" as any });
      const completedDocs = (allDocs.data || []).filter(
        (d) => d.status === "COMPLETED" || (d.status as string) === "POSTED" || (d.status as string) === "APPROVED"
      );

      for (const doc of completedDocs) {
        let meta: Record<string, any> = {};
        try {
          if (doc.note && typeof doc.note === "string" && doc.note.startsWith("{")) {
            meta = JSON.parse(doc.note);
          }
        } catch {}

        const docNo = doc.document_no || meta.doc_no || "TRF";
        if (seenDocNos.has(docNo.toLowerCase())) continue;

        const sku = meta.sku || meta.product_id?.replace(/^prod-/, "") || "";
        const rawBarcode = meta.barcode || "";
        const barcode =
          rawBarcode && rawBarcode !== "-" && rawBarcode !== "null"
            ? rawBarcode
            : to8DigitBarcode(rawBarcode, sku) || sku;

        const productName = meta.product_name || sku || "สินค้า";
        const uniqueKey = `iss_trf-mov-${doc.document_id}_${sku}_0`;
        seenDocNos.add(docNo.toLowerCase());

        const trfInfo = docNo ? trfDocMap.get(docNo.toLowerCase()) : undefined;
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
          status: meta.express_status || "PENDING",
        });
      }
    } catch (e) {
      console.warn("[GET /api/express-import/issue] Repo docs error:", e);
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
