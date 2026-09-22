import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { readSheet, appendRows, SHEETS, getWarehouseSheetName } from "@/lib/google-sheets/client";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { getWarehouseName, normalizeWarehouseId } from "@/lib/warehouse-utils";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
  errorResponse,
} from "@/lib/api-response";
import { expressStatusMap } from "@/app/api/express-import/status/route";
import {
  cleanExpressCode,
  expressItemKey,
  looksLikeSheetDate,
  parseExpressStatusText,
  sanitizeSheetValue,
  todayBangkokIsoDate,
  EXPRESS_STATUS_TEXT,
  type ExpressSyncStatusValue,
} from "@/lib/express-status-utils";
import { claimIdempotencyKey, completeIdempotencyKey, failIdempotencyKey } from "@/lib/idempotency";

export const maxDuration = 60;

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
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.EXPRESS_IMPORT_VIEW);
    } catch {
      return forbiddenResponse("เฉพาะแอดมิน/ผู้จัดการที่ดูรายการรับสินค้าเข้า Express ได้");
    }

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

    // Semantic identity of one line item = (เลขที่เอกสาร, SKU) หลัง normalize
    // ใช้จับคู่แถวในชีตกับเอกสารในระบบที่เป็น "ข้อมูลชุดเดียวกัน" เพื่อกันการแสดงซ้ำ
    // (รายการที่โพสต์แล้วถูกเขียนลงชีตอัตโนมัติ แล้ว endpoint นี้ดึงทั้งชีตและเอกสารมา)
    const semanticKey = (docNo: string, sku: string) => `${cleanCode(docNo)}|${cleanCode(sku)}`;
    const emittedSemanticKeys = new Set<string>();

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
      // Polled every few seconds — serve a short-TTL cached read instead of
      // hitting Google on every request (writes clear the cache anyway).
      const sheetRows = await readSheet(SHEETS.EXPRESS_RECEIVE, undefined, { maxAgeMs: 10_000 }).catch(() => []);

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
        // ต้องเป็นวันที่จริงเท่านั้น — เดิมใช้ heuristic "มี - และยาว 10 หรือมี T"
        // ทำให้ SKU หน้าตาคล้ายวันที่/มี T ถูกอ่านเลื่อนทั้งแถว
        if (looksLikeSheetDate(rawSku)) {
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
        const enriched = enrichProduct(rawSku, rawBcode, rawName, rawLoc);

        // สถานะตัดสินที่ระดับ "รายการ" — คิว: สถานะที่เพิ่งกด (memory, คีย์ docno|sku) → ข้อความในเซลล์ → PENDING
        // เดิมอ่าน map ด้วยเลขเอกสารเฉย ๆ และตรวจ "มีคำว่า แล้ว" ก่อน "รอนำเข้า"
        // ทำให้รายการที่เพิ่งอนุมัติขึ้น "นำเข้าแล้ว" ทันทีจากสถานะเก่าของเลขเอกสารเดียวกัน
        // และกดนำเข้า 1 SKU แล้ว SKU อื่นในเอกสารเดียวกันโดนพาไปด้วย
        const memItemStatus = expressStatusMap.get(expressItemKey(docNo, enriched.sku))?.status;
        const cellStatus = parseExpressStatusText(rawStatus);
        const rowStatus: ExpressSyncStatusValue = memItemStatus || cellStatus || "PENDING";
        const uniqueKey = `sheet_rec_${docNoKey}_${enriched.sku}_${i}`;

        // แถวจากชีตมาก่อน ถือเป็นตัวแทนของรายการนี้ — จด key ไว้เพื่อให้ลูปเอกสารข้ามของซ้ำ
        emittedSemanticKeys.add(semanticKey(docNoKey, enriched.sku));

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
          status: rowStatus,
        });
      }
    } catch (sheetErr) {
      console.warn("[GET /api/express-import/receive] Read EXPRESS_RECEIVE sheet warning:", sheetErr);
    }

    // 4. Ingest approved receive documents with express tag from repo.documents (if not already in sheet)
    //    ต้องเป็นเอกสาร RECEIVE จริง และมี marker express แบบเจาะจง —
    //    เดิมยอมให้ "note มี target_sheet" รวมทั้ง substring "express" กว้าง ๆ
    //    ทำให้เอกสารประเภทอื่นที่ note มีคำเหล่านั้นหลุดมาแสดงในหน้ารับสินค้า
    const expressReceiveDocs = allDocsList.filter((d) => {
      const isReceive = (d.document_type || "").toUpperCase().includes("RECEIVE");
      if (!isReceive) return false;
      const isCompleted = d.status === "COMPLETED" || d.status === "POSTED" || d.status === "APPROVED";
      if (!isCompleted) return false;
      const note = d.note || "";
      return note.includes("express_tag") || note.includes("express_status") || note.includes("express_items");
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

      // สถานะจาก note อ่านแบบรายรายการก่อน — ระดับเอกสาร (เดิม) ใช้ได้เฉพาะเอกสาร 1 รายการ
      // มิฉะนั้นค่า IMPORTED ที่เขียนสมัยคุมระดับเอกสารจะรั่ยไปทุก SKU ของเอกสารนั้น
      const expressItemsMeta =
        parsedPayload.express_items && typeof parsedPayload.express_items === "object" ? parsedPayload.express_items : {};
      const rows: any[][] = Array.isArray(parsedPayload.rows) ? parsedPayload.rows : [];
      const legacyDocStatus = rows.length === 1 ? parsedPayload.express_status : undefined;
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

        // คิวสถานะรายรายการ: memory (เพิ่งกด) → note.express_items[sku] → มรดกระดับเอกสาร (เฉพาะ 1 รายการ) → PENDING
        const memItemStatus = expressStatusMap.get(expressItemKey(docNo, enriched.sku))?.status;
        const noteItemStatus = expressItemsMeta[cleanExpressCode(enriched.sku)];
        const effectiveStatus: ExpressSyncStatusValue =
          memItemStatus ||
          (noteItemStatus === "IMPORTED" || noteItemStatus === "PENDING" ? noteItemStatus : undefined) ||
          (legacyDocStatus === "IMPORTED" ? "IMPORTED" : undefined) ||
          "PENDING";

        // ข้ามถ้าชีตมีรายการ (เลขที่เอกสาร, SKU) นี้อยู่แล้ว หรือ record เอกสารซ้ำกันเอง
        // เดิมเทียบด้วย uniqueKey ที่ฝัง document_id/ลำดับแถว ทำให้ไม่มีวันตรงกัน
        // และข้อมูลเดิมปรากฏซ้ำทั้งจากชีตและจากเอกสาร
        const sKey = semanticKey(docNoKey, enriched.sku);
        if (emittedSemanticKeys.has(sKey)) return;
        emittedSemanticKeys.add(sKey);

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
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.EXPRESS_IMPORT_MANAGE);
    } catch {
      return forbiddenResponse("เฉพาะแอดมิน/ผู้จัดการที่บันทึกรายการเข้า Express ได้");
    }

    const body = await req.json().catch(() => ({}));
    const {
      sku = "",
      location = "-",
      document_no = "",
      warehouse_name = "โกดัง 1",
      document_date = todayBangkokIsoDate(),
      product_name = "",
      status = "รอนำเข้า Express",
      quantity = 1,
      barcode = "",
    } = body;

    // Validation — endpoint นี้เขียนลงชีตกลางโดยตรง เดิมไม่ตรวจอะไรเลย
    // (จำนวนติดลบ/0 ผ่าน, sku ว่างผ่าน, เลขเอกสาร default "RCV" ทำให้ทุกแถวใช้เลขเดียวกันจน dedupe ชนกันหมด)
    const cleanSku = String(sku).trim();
    if (!cleanSku) {
      return errorResponse("กรุณาระบุรหัสสินค้า (SKU)", 400);
    }
    const qtyNum = Number(quantity);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0 || qtyNum > 1_000_000) {
      return errorResponse("จำนวนต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1,000,000", 400);
    }
    let docNo = String(document_no).trim();
    if (!docNo) {
      // สร้างเลขตาม spec {PREFIX}-YYYYMMDD-6หลัก แทน default "RCV" ที่ไม่ unique
      const rand = Math.floor(100000 + Math.random() * 900000);
      docNo = `RCV-${todayBangkokIsoDate().replace(/-/g, "")}-${rand}`;
    }
    if (docNo.length > 64) {
      return errorResponse("เลขที่เอกสารยาวเกินไป (สูงสุด 64 ตัวอักษร)", 400);
    }
    const statusValue = parseExpressStatusText(String(status)) || "PENDING";
    const statusText = EXPRESS_STATUS_TEXT[statusValue];

    // Idempotency — ผู้เรียกส่ง header Idempotency-Key มาเพื่อกัน append ซ้ำ (เช่น retry หลัง timeout)
    const repo = getRepository();
    const idemKey = req.headers.get("Idempotency-Key") || (typeof body.idempotency_key === "string" ? body.idempotency_key : undefined);
    const claim = await claimIdempotencyKey(repo.idempotency, idemKey, "EXPRESS_RECEIVE_APPEND", actor.id, body);
    if (claim.isReplay) {
      return successResponse(claim.cachedResult ?? null, "บันทึกข้อมูลนี้ไปแล้ว (Idempotency-Key ซ้ำ)");
    }

    // Row format matching User's Express sheet columns:
    // [รหัสสินค้า, ตำแหน่ง, เลขที่เอกสาร, โกดัง, วันที่เอกสาร, ชื่อสินค้า, สถานะการนำเข้า, จำนวน, บาร์โค้ด]
    // sanitize ทุกช่อง — ชีตเขียนด้วย USER_ENTERED ค่าที่ขึ้นต้น "=" จะกลายเป็นสูตร
    const row = [
      sanitizeSheetValue(cleanSku),
      sanitizeSheetValue(String(location).trim() || "-"),
      sanitizeSheetValue(docNo),
      sanitizeSheetValue(String(warehouse_name).trim() || "โกดัง 1"),
      sanitizeSheetValue(String(document_date).trim() || todayBangkokIsoDate()),
      sanitizeSheetValue(String(product_name || cleanSku).trim()),
      statusText,
      qtyNum,
      sanitizeSheetValue(String(barcode || cleanSku).trim()),
    ];

    try {
      await appendRows(SHEETS.EXPRESS_RECEIVE, [row]);
    } catch (sheetErr) {
      console.error("[POST /api/express-import/receive] appendRows error:", sheetErr);
      await failIdempotencyKey(repo.idempotency, idemKey, String(sheetErr)).catch(() => {});
      return serverErrorResponse(sheetErr);
    }

    await completeIdempotencyKey(repo.idempotency, idemKey, row).catch(() => {});
    return successResponse(row, "บันทึกข้อมูลลงแท็บชีต นำเข้าสินค้าเข้าExpress เรียบร้อยแล้ว", 201);
  } catch (error) {
    return serverErrorResponse(error);
  }
}
