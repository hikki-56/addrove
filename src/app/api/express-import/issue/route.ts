import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { readSheet, appendRows, SHEETS, getWarehouseSheetName } from "@/lib/google-sheets/client";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { parseTransferMetadata } from "@/lib/transfer-notification-utils";
import { successResponse, unauthorizedResponse, serverErrorResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanCode(str?: string): string {
  if (!str) return "";
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/^prod-/, "")
    .replace(/[\s\-_#]/g, "");
}

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

    // 1. Preload master product catalog from PRODUCTS sheet and Warehouse tabs
    const productCatalogMap = new Map<string, { sku: string; barcode: string; name: string; location: string }>();

    try {
      const [prodRows, wh1Rows, wh2Rows, wh3Rows] = await Promise.all([
        readSheet(SHEETS.PRODUCTS).catch(() => []),
        readSheet(getWarehouseSheetName("wh-01"), "A2:I").catch(() => []),
        readSheet(getWarehouseSheetName("wh-02"), "A2:I").catch(() => []),
        readSheet(getWarehouseSheetName("wh-03"), "A2:I").catch(() => []),
      ]);

      const addProductEntry = (rawSku: string, rawBcode: string, rawName: string, rawLoc: string = "") => {
        const sku = (rawSku || "").trim();
        const bcode = (rawBcode || "").trim();
        const name = (rawName || "").trim();
        const loc = (rawLoc || "").trim();
        if (!sku && !bcode && !name) return;

        const entry = {
          sku: sku || bcode,
          barcode: bcode && bcode !== "-" && bcode !== "null" ? bcode : "",
          name: name && name !== sku ? name : "",
          location: loc && loc !== "-" ? loc : "",
        };

        const keys = [cleanCode(sku), cleanCode(bcode), sku.toLowerCase(), bcode.toLowerCase()].filter(Boolean);
        keys.forEach((k) => {
          const existing = productCatalogMap.get(k);
          if (!existing || (!existing.name && entry.name) || (!existing.barcode && entry.barcode)) {
            productCatalogMap.set(k, { ...(existing || {}), ...entry });
          }
        });
      };

      // Ingest warehouse sheets (Col 0=SKU, Col 1=Barcode, Col 2=Name, Col 6=Loc)
      [wh1Rows, wh2Rows, wh3Rows].forEach((rows) => {
        rows.forEach((r) => {
          if (r && r[0]) addProductEntry(r[0], r[1], r[2], r[6]);
        });
      });

      // Ingest PRODUCTS sheet
      prodRows.forEach((r) => {
        if (!r || r.length < 3) return;
        if (r.length >= 7 && !isNaN(Number(r[0]))) {
          addProductEntry(r[2], r[6], r[4]);
        } else {
          addProductEntry(r[0], r[1], r[2]);
        }
      });
    } catch (e) {
      console.warn("[GET /api/express-import/issue] Preload products warning:", e);
    }

    const enrichProduct = (rawSku: string, rawBarcode: string, rawName: string, rawLocation?: string) => {
      const cleanSku = (rawSku || "").replace(/^prod-/, "").trim();
      const keys = [cleanCode(cleanSku), cleanCode(rawBarcode), cleanSku.toLowerCase()].filter(Boolean);
      
      let matched: { sku: string; barcode: string; name: string; location: string } | undefined;
      for (const k of keys) {
        if (productCatalogMap.has(k)) {
          matched = productCatalogMap.get(k);
          break;
        }
      }

      const finalSku = cleanSku || matched?.sku || rawBarcode;
      let finalName = (rawName || "").trim();
      if (!finalName || finalName === cleanSku || finalName === `สินค้า ${cleanSku}` || finalName === "สินค้า") {
        finalName = matched?.name || finalName || cleanSku;
      }

      let finalBarcode = (rawBarcode || "").trim();
      if (!finalBarcode || finalBarcode === "-" || finalBarcode === "null" || finalBarcode === cleanSku || /[ก-๙]/.test(finalBarcode)) {
        if (matched?.barcode && !/[ก-๙]/.test(matched.barcode) && matched.barcode !== "-") {
          finalBarcode = matched.barcode;
        } else {
          finalBarcode = to8DigitBarcode(finalBarcode, finalSku) || finalSku;
        }
      }

      const finalLocation = (rawLocation && rawLocation !== "-" && rawLocation !== "A1") ? rawLocation : (matched?.location || rawLocation || "-");

      return {
        sku: finalSku,
        name: finalName,
        barcode: finalBarcode,
        location: finalLocation,
      };
    };

    // 2. Preload documents map (for metadata & clean doc numbers)
    const allDocsMap = new Map<string, any>();
    let allDocsList: any[] = [];
    try {
      const allDocs = await repo.documents.findAll({ page: 1, limit: 9999 });
      allDocsList = allDocs.data || [];
      allDocsList.forEach((doc) => {
        const docIdKey = (doc.document_id || "").trim().toLowerCase();
        const docNoKey = (doc.document_no || "").trim().toLowerCase();
        if (docIdKey) allDocsMap.set(docIdKey, doc);
        if (docNoKey) allDocsMap.set(docNoKey, doc);
      });
    } catch (e) {
      console.warn("[GET /api/express-import/issue] Preload all docs error:", e);
    }

    const cleanDocNumber = (rawDocNo: string, rawDocId: string, createdAt: string, prefix: string = "ISS"): string => {
      let docNo = String(rawDocNo || "").trim();
      const docId = String(rawDocId || "").trim();

      const docRec = docId ? allDocsMap.get(docId.toLowerCase()) : (docNo ? allDocsMap.get(docNo.toLowerCase()) : undefined);
      if (docRec?.reference_no && !docRec.reference_no.startsWith("doc-") && docRec.reference_no.length <= 25) {
        return docRec.reference_no;
      }
      if (docRec?.document_no && !docRec.document_no.startsWith("doc-") && docRec.document_no.length <= 25) {
        return docRec.document_no;
      }

      if (docNo && !docNo.startsWith("doc-") && docNo.length <= 25) {
        return docNo;
      }

      const datePart = (createdAt || new Date().toISOString()).slice(0, 10).replace(/-/g, "");
      const shortId = (docId || docNo || "0000").replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
      return `${prefix}-${datePart}-${shortId}`;
    };

    // 3. Read directly from Google Sheets Tab: "เบิกสินค้าเข้าExpress"
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

        // Skip production orders
        if (docNo.toUpperCase().startsWith("PRD-") || docNo.toLowerCase().includes("prd")) {
          continue;
        }

        const enriched = enrichProduct(sku, barcode, productName, location);
        const resolvedDocNo = cleanDocNumber(docNo, docNo, date, "TRF");
        const docNoKey = resolvedDocNo.toLowerCase();
        const uniqueKey = `sheet_iss_${resolvedDocNo}_${enriched.sku}_${idx}`;

        seenUniqueKeys.add(uniqueKey);
        if (docNoKey) seenDocNos.add(docNoKey);

        items.push({
          id: uniqueKey,
          movement_id: `mov-${resolvedDocNo}-${idx}`,
          document_id: resolvedDocNo,
          document_no: resolvedDocNo,
          warehouse_name: whName,
          warehouse_id: whName,
          from_warehouse_name: whName,
          from_warehouse_id: whName,
          to_warehouse_name: "",
          to_warehouse_id: "",
          created_at: date,
          created_by_name: "ผู้ดูแลระบบ",
          sku: enriched.sku,
          product_name: enriched.name,
          quantity: qty,
          location: enriched.location,
          barcode: enriched.barcode,
          movement_type: "TRANSFER_OUT",
          tag: "เบิกสินค้าเข้า Express",
          status: status.includes("แล้ว") || status === "IMPORTED" ? "IMPORTED" : "PENDING",
        });
      }
    } catch (e) {
      console.warn("[GET /api/express-import/issue] Sheet read error:", e);
    }

    // 4. Read approved TRANSFER (เบิกสินค้า/โอนย้าย) documents from repository
    const completedTransferDocs = allDocsList.filter((d) => {
      if (d.document_type !== "TRANSFER") return false;
      const isCompleted = d.status === "COMPLETED" || (d.status as string) === "POSTED" || (d.status as string) === "APPROVED";
      if (!isCompleted) return false;

      // Exclude production orders
      const isProd =
        d.document_no?.toUpperCase().startsWith("PRD-") ||
        d.reference_no?.toUpperCase().startsWith("PRD-") ||
        d.document_id?.toLowerCase().includes("prd") ||
        d.note?.includes('"type":"PRODUCTION_ORDER"');
      return !isProd;
    });

    for (const doc of completedTransferDocs) {
      const meta = parseTransferMetadata(doc.note);
      const rawDocNo = doc.document_no || meta.doc_no || "";
      const resolvedDocNo = cleanDocNumber(rawDocNo, doc.document_id, doc.created_at, "TRF");
      const docNoKey = resolvedDocNo.toLowerCase();

      if (docNoKey && seenDocNos.has(docNoKey)) continue;

      const rawSku = meta.sku || meta.product_id?.replace(/^prod-/, "") || "";
      const rawBarcode = meta.barcode || "";
      const rawProductName = meta.product_name || rawSku || "สินค้า";
      const toLoc = meta.to_location_id || meta.to_location || meta.completed_location_id || "";
      const fromLoc = meta.from_location_id || meta.from_location || "-";

      const enriched = enrichProduct(rawSku, rawBarcode, rawProductName, toLoc || fromLoc);
      const uniqueKey = `iss_trf-mov-${doc.document_id}_${enriched.sku}`;

      if (seenUniqueKeys.has(uniqueKey)) continue;
      seenUniqueKeys.add(uniqueKey);
      if (docNoKey) seenDocNos.add(docNoKey);

      const fromWarehouseName = meta.from_warehouse_name || meta.from_warehouse_id || "โกดัง 1";
      const fromWarehouseId = meta.from_warehouse_id || "wh-1";
      const toWarehouseName = meta.to_warehouse_name || meta.to_warehouse_id || "";
      const toWarehouseId = meta.to_warehouse_id || "";

      items.push({
        id: uniqueKey,
        movement_id: `trf-mov-${doc.document_id}`,
        document_id: doc.document_id,
        document_no: resolvedDocNo,
        warehouse_name: fromWarehouseName,
        warehouse_id: fromWarehouseId,
        from_warehouse_name: fromWarehouseName,
        from_warehouse_id: fromWarehouseId,
        to_warehouse_name: toWarehouseName,
        to_warehouse_id: toWarehouseId,
        created_at: (meta.completed_at || doc.created_at || new Date().toISOString()).slice(0, 10),
        created_by_name: meta.moved_by || meta.assigned_to_name || "ผู้ใช้งาน",
        sku: enriched.sku,
        product_name: enriched.name,
        quantity: Math.abs(Number(meta.qty) || 1),
        location: enriched.location,
        to_location_id: toLoc,
        from_location_id: fromLoc,
        barcode: enriched.barcode,
        movement_type: "TRANSFER_OUT",
        tag: meta.express_tag || "เบิกสินค้าเข้า Express",
        status: meta.express_status === "IMPORTED" ? "IMPORTED" : "PENDING",
      });
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
