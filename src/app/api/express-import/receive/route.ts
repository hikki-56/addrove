import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { readSheet, appendRows, SHEETS, getWarehouseSheetName } from "@/lib/google-sheets/client";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { getWarehouseName, normalizeWarehouseId } from "@/lib/warehouse-utils";
import { successResponse, unauthorizedResponse, serverErrorResponse } from "@/lib/api-response";
import { expressStatusMap } from "@/app/api/express-import/status/route";

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
      created_at: string;
      created_by_name: string;
      sku: string;
      product_name: string;
      quantity: number;
      location: string;
      barcode: string;
      movement_type: string;
      tag: string;
      status: "PENDING" | "IMPORTED";
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

      [wh1Rows, wh2Rows, wh3Rows].forEach((rows) => {
        rows.forEach((r) => {
          if (r && r[0]) addProductEntry(r[0], r[1], r[2], r[6]);
        });
      });

      prodRows.forEach((r) => {
        if (!r || r.length < 3) return;
        if (r.length >= 7 && !isNaN(Number(r[0]))) {
          addProductEntry(r[2], r[6], r[4]);
        } else {
          addProductEntry(r[0], r[1], r[2]);
        }
      });
    } catch (e) {
      console.warn("[GET /api/express-import/receive] Preload products warning:", e);
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

    // 2. Preload documents map
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
      console.warn("[GET /api/express-import/receive] Preload all docs error:", e);
    }

    // 3. Read Google Sheets tab "รับสินค้าเข้าExpress" / "นำเข้าสินค้าเข้าExpress"
    try {
      const sheetRows = await readSheet(SHEETS.EXPRESS_RECEIVE, undefined, { forceFresh: true }).catch(() => []);

      for (let i = 0; i < sheetRows.length; i++) {
        const row = sheetRows[i];
        if (!row || row.length === 0) continue;

        const col0 = String(row[0] ?? "").trim();
        const col0Lower = col0.toLowerCase();

        // Skip any header rows (Thai or English column titles, or generated 'คอลัมน์ X')
        const isHeader =
          col0 === "รหัสสินค้า" ||
          col0Lower === "sku" ||
          col0 === "วันที่" ||
          col0Lower === "date" ||
          col0 === "ลำดับ" ||
          col0.startsWith("คอลัมน์") ||
          col0Lower.startsWith("column") ||
          row.some((cell) => {
            const c = String(cell ?? "").trim().toLowerCase();
            return (
              c === "เลขที่เอกสาร" ||
              c === "วันที่เอกสาร" ||
              c === "ชื่อแท็ก" ||
              c === "ชื่อสินค้า" ||
              c === "สถานะการนำเข้า" ||
              c.startsWith("คอลัมน์")
            );
          });

        if (isHeader) {
          continue;
        }

        // Layout A: [SKU, Location, DocNo, Warehouse, Date, ProductName, Status, Qty, Barcode]
        let rawSku = String(row[0] ?? "").trim();
        let rawLoc = String(row[1] ?? "-").trim();
        let docNo = String(row[2] ?? "").trim();
        let whName = String(row[3] ?? "โกดัง 1").trim();
        let docDate = String(row[4] ?? "").trim();
        let rawName = String(row[5] ?? "").trim();
        let rawStatus = String(row[6] ?? "").trim();
        let qtyVal = parseFloat(String(row[7] ?? "1").replace(/,/g, "")) || 1;
        let rawBcode = String(row[8] ?? "").trim();

        // Fallback Layout B if Col 0 is Date: [Date, DocNo, Barcode, SKU, Name, Warehouse, Location, Qty, Status]
        if (rawSku.includes("-") && (rawSku.length === 10 || rawSku.includes("T"))) {
          docDate = rawSku;
          docNo = String(row[1] ?? "").trim();
          rawBcode = String(row[2] ?? "").trim();
          rawSku = String(row[3] ?? "").trim();
          rawName = String(row[4] ?? "").trim();
          whName = String(row[5] ?? "โกดัง 1").trim();
          rawLoc = String(row[6] ?? "-").trim();
          qtyVal = parseFloat(String(row[7] ?? "1").replace(/,/g, "")) || 1;
          rawStatus = String(row[8] ?? "").trim();
        }

        if (!rawSku && !rawBcode && !rawName) continue;

        // Skip if parsed fields are literal header words
        if (
          docNo === "เลขที่เอกสาร" ||
          docDate === "วันที่เอกสาร" ||
          rawSku.startsWith("คอลัมน์") ||
          rawSku === "รหัสสินค้า" ||
          rawName === "ชื่อแท็ก" ||
          rawLoc === "ตำแหน่ง"
        ) {
          continue;
        }

        if (!docNo) docNo = `RCV-SH-${i + 1}`;

        const docNoKey = docNo.toLowerCase();
        const memStatus = expressStatusMap.get(docNoKey)?.status;
        const isImported =
          memStatus === "IMPORTED" ||
          rawStatus.includes("แล้ว") ||
          rawStatus.toUpperCase() === "IMPORTED" ||
          rawStatus.includes("สำเร็จ");

        const enriched = enrichProduct(rawSku, rawBcode, rawName, rawLoc);
        const uniqueKey = `sheet_rec_${docNoKey}_${enriched.sku}_${i}`;

        if (!seenUniqueKeys.has(uniqueKey)) {
          seenUniqueKeys.add(uniqueKey);
          seenDocNos.add(docNoKey);

          items.push({
            id: uniqueKey,
            movement_id: `mov-${docNo}-${i}`,
            document_id: docNo,
            document_no: docNo,
            warehouse_name: getWarehouseName(whName) || whName || "โกดัง 1",
            warehouse_id: normalizeWarehouseId(whName),
            created_at: docDate || new Date().toISOString().slice(0, 10),
            created_by_name: "ระบบรับสินค้า",
            sku: enriched.sku,
            product_name: enriched.name,
            quantity: qtyVal,
            location: enriched.location,
            barcode: enriched.barcode,
            movement_type: "RECEIVE",
            tag: "นำเข้าสินค้าเข้าExpress",
            status: isImported ? "IMPORTED" : "PENDING",
          });
        }
      }
    } catch (sheetErr) {
      console.warn("[GET /api/express-import/receive] Read EXPRESS_RECEIVE sheet warning:", sheetErr);
    }

    // 4. Ingest approved receive documents with express tag from repo.documents (if not already in sheet)
    const expressReceiveDocs = allDocsList.filter((d) => {
      const isReceive = (d.document_type || "").toUpperCase().includes("RECEIVE") || (d.note && d.note.includes("target_sheet"));
      if (!isReceive) return false;
      const isCompleted = d.status === "COMPLETED" || d.status === "POSTED" || d.status === "APPROVED";
      if (!isCompleted) return false;
      const note = d.note || "";
      return note.includes("express_tag") || note.includes("express_status") || note.includes("Express") || note.includes("express");
    });

    for (const doc of expressReceiveDocs) {
      let parsedPayload: any = {};
      try {
        if (doc.note && doc.note.startsWith("{")) {
          parsedPayload = JSON.parse(doc.note);
        }
      } catch {}

      const docNo = doc.document_no || doc.document_id || "";
      const docNoKey = docNo.toLowerCase();
      if (docNoKey && seenDocNos.has(docNoKey)) continue;

      const memStatus = expressStatusMap.get(docNoKey)?.status;
      const effectiveStatus: "PENDING" | "IMPORTED" = memStatus || parsedPayload.express_status || "PENDING";
      const rows: any[][] = Array.isArray(parsedPayload.rows) ? parsedPayload.rows : [];
      const targetWh = parsedPayload.target_sheet || doc.warehouse_id || "โกดัง 1";
      const docDate = doc.document_date || (doc.created_at || new Date().toISOString()).slice(0, 10);

      rows.forEach((row, rowIdx) => {
        const rawSku = String(row[0] ?? "").trim();
        const rawLoc = String(row[1] ?? "-").trim();
        const rawBcode = String(row[2] ?? "").trim();
        const rawName = String(row[3] ?? "").trim();
        const qtyVal = parseFloat(String(row[4] ?? "1").replace(/,/g, "")) || 1;

        if (!rawSku && !rawBcode && !rawName) return;

        const enriched = enrichProduct(rawSku, rawBcode, rawName, rawLoc);
        const uniqueKey = `doc_rec_${docNoKey}_${enriched.sku}_${rowIdx}`;

        if (!seenUniqueKeys.has(uniqueKey)) {
          seenUniqueKeys.add(uniqueKey);
          if (docNoKey) seenDocNos.add(docNoKey);

          items.push({
            id: uniqueKey,
            movement_id: `mov-${docNo}-${rowIdx}`,
            document_id: doc.document_id || docNo,
            document_no: docNo,
            warehouse_name: getWarehouseName(targetWh) || targetWh,
            warehouse_id: normalizeWarehouseId(targetWh),
            created_at: docDate,
            created_by_name: doc.created_by_name || doc.created_by || "ระบบรับสินค้า",
            sku: enriched.sku,
            product_name: enriched.name,
            quantity: qtyVal,
            location: enriched.location,
            barcode: enriched.barcode,
            movement_type: "RECEIVE",
            tag: parsedPayload.express_tag || "นำเข้าสินค้าเข้าExpress",
            status: effectiveStatus,
          });
        }
      });
    }

    // Sort newest first
    items.sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return b.document_no.localeCompare(a.document_no);
    });

    return successResponse(items, "ดึงข้อมูลรายการรับสินค้าเข้า Express สำเร็จ");
  } catch (error) {
    console.error("[GET /api/express-import/receive] Error:", error);
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
      document_no = "RCV",
      warehouse_name = "โกดัง 1",
      document_date = new Date().toISOString().slice(0, 10),
      product_name = "",
      status = "รอนำเข้า Express",
      quantity = 1,
      barcode = "",
    } = body;

    // Row format matching User's Express sheet columns:
    // [รหัสสินค้า, ตำแหน่ง, เลขที่เอกสาร, โกดัง, วันที่เอกสาร, ชื่อสินค้า, สถานะการนำเข้า, จำนวน, บาร์โค้ด]
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
      await appendRows(SHEETS.EXPRESS_RECEIVE, [row]);
    } catch (sheetErr) {
      console.error("[POST /api/express-import/receive] appendRows error:", sheetErr);
      return serverErrorResponse(sheetErr);
    }

    return successResponse(row, "บันทึกข้อมูลลงแท็บชีต นำเข้าสินค้าเข้าExpress เรียบร้อยแล้ว", 201);
  } catch (error) {
    return serverErrorResponse(error);
  }
}
