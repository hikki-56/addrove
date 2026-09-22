import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { readSheet, updateRow, SHEETS } from "@/lib/google-sheets/client";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
  errorResponse,
} from "@/lib/api-response";
import {
  cleanExpressCode,
  expressItemKey,
  docNoVariants,
  aggregateDocStatus,
  type ExpressSyncStatusValue,
} from "@/lib/express-status-utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// แปลงเลขคอลัมน์ (1-based) เป็นตัวอักษร A, B, ..., Z, AA, ...
function columnLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

interface StatusUpdateItem {
  id?: string;
  document_no: string;
  // เลขเอกสารดิบจากชีต (อาจเป็นหลายเลขต่อกัน "ISS-…, ISS-…") — ใช้ match เพิ่มจาก document_no
  raw_document_no?: string;
  sku?: string;
  barcode?: string;
  status: "IMPORTED" | "PENDING";
  type?: "ISSUE" | "RECEIVE" | "TRANSFER";
}

interface ExpressStatusEntry {
  status: ExpressSyncStatusValue;
  type: string;
  updated_at: string;
  document_no: string;
  // มีเฉพาะ entry ระดับรายการ (คีย์ "docno|sku") — entry ระดับเอกสารคือ aggregate
  sku?: string;
}

// Global in-memory status cache to immediately sync across all clients
const globalForExpressStatus = globalThis as unknown as {
  expressStatusMap?: Map<string, ExpressStatusEntry>;
};

export const expressStatusMap =
  globalForExpressStatus.expressStatusMap ||
  (globalForExpressStatus.expressStatusMap = new Map<string, ExpressStatusEntry>());

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.EXPRESS_IMPORT_VIEW);
    } catch {
      return forbiddenResponse("เฉพาะแอดมิน/ผู้จัดการที่ดูสถานะนำเข้า Express ได้");
    }

    const { searchParams } = new URL(req.url);
    const typeFilter = searchParams.get("type")?.toUpperCase();

    const resultObj: Record<string, ExpressStatusEntry> = {};

    const putEntry = (key: string, entry: ExpressStatusEntry) => {
      if (!key) return;
      if (typeFilter && entry.type !== typeFilter) return;
      resultObj[key] = entry;
      expressStatusMap.set(key, entry);
    };

    // 1. Convert in-memory statuses to a plain object
    expressStatusMap.forEach((val, key) => {
      if (!typeFilter || val.type === typeFilter) {
        resultObj[key] = val;
      }
    });

    // 2. Also check recent documents from repository (source of truth หลังรีสตาร์ท)
    try {
      const repo = getRepository();
      const allDocs = await repo.documents.findAll({ page: 1, limit: 1000 }).catch(() => ({ data: [] }));
      (allDocs.data || []).forEach((doc) => {
        if (!doc.document_no && !doc.document_id) return;
        let meta: Record<string, any> = {};
        try {
          if (doc.note && typeof doc.note === "string" && doc.note.startsWith("{")) {
            meta = JSON.parse(doc.note);
          }
        } catch {}

        if (!meta.express_status && !meta.express_items) return;

        const type = (doc.document_type || "RECEIVE").toUpperCase();
        const updatedAt = meta.express_synced_at || doc.created_at || new Date().toISOString();
        const docNo = doc.document_no || doc.document_id;
        const docNoKey = (doc.document_no || "").trim().toLowerCase();
        const docIdKey = (doc.document_id || "").trim().toLowerCase();

        // ระดับรายการ (express_items) — คีย์ "docno|sku"
        const items = meta.express_items && typeof meta.express_items === "object" ? meta.express_items : {};
        Object.entries(items).forEach(([sku, st]) => {
          const entry: ExpressStatusEntry = {
            status: st === "IMPORTED" ? "IMPORTED" : "PENDING",
            type,
            updated_at: updatedAt,
            document_no: docNo,
            sku: String(sku),
          };
          putEntry(expressItemKey(docNoKey, sku), entry);
        });

        // ระดับเอกสาร (aggregate) — ใช้เป็น fallback ของเอกสารที่ยังไม่มีข้อมูลรายรายการ
        if (meta.express_status) {
          const entry: ExpressStatusEntry = {
            status: meta.express_status === "IMPORTED" ? "IMPORTED" : "PENDING",
            type,
            updated_at: updatedAt,
            document_no: docNo,
          };
          if (docNoKey && !resultObj[docNoKey]) putEntry(docNoKey, entry);
          if (docIdKey && !resultObj[docIdKey]) putEntry(docIdKey, entry);
        }
      });
    } catch (e) {
      console.warn("[GET /api/express-import/status] repo scan error:", e);
    }

    return successResponse(resultObj, "ดึงสถานะ Express สำเร็จ");
  } catch (error) {
    console.error("[GET /api/express-import/status] Error:", error);
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
      return forbiddenResponse("เฉพาะแอดมิน/ผู้จัดการที่เปลี่ยนสถานะนำเข้า Express ได้");
    }

    const body = await req.json().catch(() => ({}));
    const rawItems: StatusUpdateItem[] = Array.isArray(body.items)
      ? body.items
      : body.document_no
      ? [body]
      : [];

    if (rawItems.length === 0) {
      return errorResponse("กรุณาระบุข้อมูลรายการที่ต้องการอัปเดตสถานะ", 400);
    }
    if (rawItems.length > 200) {
      return errorResponse("อัปเดตได้ครั้งละไม่เกิน 200 รายการ", 400);
    }
    for (const item of rawItems) {
      if (!item?.document_no || !String(item.document_no).trim()) {
        return errorResponse("กรุณาระบุเลขที่เอกสารของทุกรายการ", 400);
      }
      if (item.status !== "IMPORTED" && item.status !== "PENDING") {
        return errorResponse("สถานะต้องเป็น IMPORTED หรือ PENDING เท่านั้น", 400);
      }
    }

    const now = new Date().toISOString();

    const typeOf = (item: StatusUpdateItem) => (item.type || "ISSUE").toUpperCase();

    // 1. เก็บใน global in-memory map — ระดับรายการ (docno|sku) เป็นหลัก
    //    ระดับเอกสารเก็นเป็น aggregate ไว้ให้ header/note อ่าน ไม่ใช่ตัวตัดสินแถว
    rawItems.forEach((item) => {
      const type = typeOf(item);
      const entry: ExpressStatusEntry = {
        status: item.status,
        type,
        updated_at: now,
        document_no: item.document_no,
      };
      if (item.sku) {
        entry.sku = item.sku;
        expressStatusMap.set(expressItemKey(item.document_no, item.sku), { ...entry, sku: item.sku });
      }
      if (item.id) {
        expressStatusMap.set(item.id.trim().toLowerCase(), { ...entry, sku: item.sku });
      }
    });

    const repo = getRepository();
    const results: Array<{
      document_no: string;
      sku?: string;
      updated: boolean;
      matched: boolean;
      sheet_synced: boolean;
    }> = [];

    // 2. Group items by sheet type
    const sheetTypes = new Set(rawItems.map(typeOf));

    for (const type of Array.from(sheetTypes)) {
      let targetSheet: string = SHEETS.EXPRESS_ISSUE;
      if (type === "RECEIVE") targetSheet = SHEETS.EXPRESS_RECEIVE;
      if (type === "TRANSFER") targetSheet = SHEETS.EXPRESS_TRANSFER;

      const itemsForType = rawItems.filter((i) => typeOf(i) === type);

      // index รายการตามเลขเอกสาร (ทุก variant รวมเลขที่ต่อกัน "ISS-…, ISS-…") เพื่อหาเร็ว
      const itemsByDocKey = new Map<string, StatusUpdateItem[]>();
      itemsForType.forEach((i) => {
        const variants = [
          ...docNoVariants(i.document_no),
          ...docNoVariants(i.raw_document_no),
        ];
        const seen = new Set<string>();
        variants.forEach((v) => {
          const key = cleanExpressCode(v);
          if (!key || seen.has(key)) return;
          seen.add(key);
          const list = itemsByDocKey.get(key) || [];
          list.push(i);
          itemsByDocKey.set(key, list);
        });
      });

      // แถวที่จะถูกจับคู่แล้ว (กันกรณีเอกสารเดียวมีหลาย variant ชนแถวเดียวซ้ำ)
      const matchedRowItems = new Map<number, StatusUpdateItem>();

      try {
        // อ่านแบบ keepHeader เพื่อให้ index ตรงกับแถวจริงในชีต (แถวจริง = index + 1)
        const sheetRows = await readSheet(targetSheet, undefined, { forceFresh: true, keepHeader: true }).catch(() => []);

        for (let rowIndex = 0; rowIndex < sheetRows.length; rowIndex++) {
          const row = sheetRows[rowIndex];
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

          // Layout A: [SKU, Location, DocNo, Warehouse, Date, ProductName, Status, Qty, Barcode]
          // Layout B: [Date, DocNo, Barcode, SKU, ProductName, Warehouse, Location, Qty, ..., Status]
          // Layout C: Col 0 is DocNo
          const docNoCandidateA = String(row[2] ?? "").trim();
          const docNoCandidateB = String(row[1] ?? "").trim();
          const docNoCandidateC = String(row[0] ?? "").trim();
          const skuCandidateA = String(row[0] ?? "").trim();
          const skuCandidateB = String(row[3] ?? "").trim();

          let layout: "A" | "B" | "C" | null = null;
          let rowDocNo = "";
          let rowSku = "";
          if (itemsByDocKey.has(cleanExpressCode(docNoCandidateA))) {
            layout = "A";
            rowDocNo = docNoCandidateA;
            rowSku = skuCandidateA;
          } else if (itemsByDocKey.has(cleanExpressCode(docNoCandidateB))) {
            layout = "B";
            rowDocNo = docNoCandidateB;
            rowSku = skuCandidateB;
          } else if (itemsByDocKey.has(cleanExpressCode(docNoCandidateC))) {
            layout = "C";
            rowDocNo = docNoCandidateC;
            rowSku = skuCandidateA;
          }
          if (!layout) continue;

          const candidates = itemsByDocKey.get(cleanExpressCode(rowDocNo)) || [];

          // จับคู่ระดับรายการ: เอกสารตรงกัน + SKU ตรงกัน
          // เดิม match ด้วยเลขเอกสารเท่านั้น ทำให้กด 1 SKU ทั้งเอกสาร (ทุก SKU) ถูกเขียนทับ
          let matchedItem: StatusUpdateItem | undefined;
          const bySku = candidates.find(
            (c) => c.sku && cleanExpressCode(c.sku) === cleanExpressCode(rowSku)
          );
          if (bySku) {
            matchedItem = bySku;
          } else if (rowSku) {
            // แถวนี้มี SKU ที่ไม่ตรงรายการใด → ไม่แตะแถวนี้เด็ดขาด
            continue;
          } else {
            // แถวไม่มีข้อมูล SKU — ยังอนุญาตเฉพาะเอกสารที่ส่งมา 1 รายการเท่านั้น
            // (กินความหมาย "ทั้งเอกสาร" ตามที่ผู้ใช้เห็น ไม่ใช่ทุกแถวของเอกสารหลายรายการ)
            const uniqueItems = new Set(candidates.map((c) => c.sku || ""));
            if (candidates.length === 1 || uniqueItems.size === 1) {
              matchedItem = candidates[0];
            } else {
              continue;
            }
          }

          if (matchedRowItems.has(rowIndex)) continue;
          matchedRowItems.set(rowIndex, matchedItem);

          let statusColIdx = 6;
          if (layout === "B") {
            statusColIdx = row.length >= 11 ? 10 : row.length >= 10 ? 9 : 6;
          }

          const statusText =
            matchedItem!.status === "IMPORTED" ? "นำเข้า Express แล้ว" : "รอนำเข้า Express";

          const updatedRow = [...row];
          while (updatedRow.length <= statusColIdx) {
            updatedRow.push("");
          }
          updatedRow[statusColIdx] = statusText;

          const sheetRowNumber = rowIndex + 1;

          // ยืนยันก่อนเขียนทุกครั้ง: อ่านแถวกายภาพนั้นกลับมาเทียบเนื้อหา —
          // ถ้าเนื้อหาไม่ตรงแปลว่าเลขแถวเพี้ยน (เช่นทางอ่านที่ตัดหัวตารางเอง เช่น CSV fallback)
          // ให้งดเขียนเพื่อไม่ทับแถวข้างเคียงทั้งแถว แล้วรายงาน sheet_synced: false
          let rowVerified = false;
          try {
            const verifyRows = await readSheet(
              targetSheet,
              `A${sheetRowNumber}:${columnLetter(updatedRow.length)}${sheetRowNumber}`,
              { forceFresh: true, keepHeader: true }
            ).catch(() => [] as string[][]);
            if (verifyRows.length === 1) {
              const phys = verifyRows[0];
              rowVerified =
                String(phys[0] ?? "").trim() === String(row[0] ?? "").trim() &&
                String(phys[1] ?? "").trim() === String(row[1] ?? "").trim() &&
                String(phys[2] ?? "").trim() === String(row[2] ?? "").trim();
            }
          } catch (verifyErr) {
            console.warn(`[POST /api/express-import/status] Row verify failed on row ${sheetRowNumber}:`, verifyErr);
          }

          let rowUpdated = false;
          if (rowVerified) {
            try {
              await updateRow(targetSheet, sheetRowNumber, updatedRow);
              rowUpdated = true;
            } catch (err) {
              console.warn(`[POST /api/express-import/status] updateRow failed on row ${sheetRowNumber}:`, err);
            }
          } else {
            console.warn(`[POST /api/express-import/status] Skip sheet write for row ${sheetRowNumber} (row content mismatch — avoiding off-by-one overwrite)`);
          }

          const existingResult = results.find(
            (r) =>
              r.document_no === matchedItem!.document_no &&
              (r.sku || "") === (matchedItem!.sku || "")
          );
          if (existingResult) {
            existingResult.sheet_synced = existingResult.sheet_synced && rowUpdated;
          } else {
            results.push({
              document_no: matchedItem!.document_no,
              sku: matchedItem!.sku,
              updated: true,
              matched: true,
              sheet_synced: rowUpdated,
            });
          }
        }
      } catch (sheetErr) {
        console.warn(`[POST /api/express-import/status] Process sheet ${targetSheet} error:`, sheetErr);
      }
    }

    // รายการที่ไม่เจอแถวในชีตเลย — ยังถือว่า "อัปเดตบนระบบสำเร็จ" (สถานะอยู่ใน memory + note)
    // แต่แยก matched=false ให้ client รู้ว่าชีตไม่มีแถวนี้
    rawItems.forEach((item) => {
      const found = results.find(
        (r) => r.document_no === item.document_no && (r.sku || "") === (item.sku || "")
      );
      if (!found) {
        results.push({
          document_no: item.document_no,
          sku: item.sku,
          updated: true,
          matched: false,
          sheet_synced: true,
        });
      }
    });

    const allSheetSynced = results.every((r) => r.sheet_synced);

    // 3. Update document note — เก็บสถานะ "รายรายการ" ใน express_items
    //    express_status (ระดับเอกสาร) เหลือเป็น aggregate: IMPORTED เฉพาะเมื่อทุกรายการ IMPORTED
    for (const item of rawItems) {
      try {
        // เลขเอกสารอาจเป็นชุดต่อกันหลายเลข — หาเอกสารจริงจากทุกชิ้น
        let doc = null;
        for (const variant of docNoVariants(item.document_no)) {
          doc = await repo.documents.findByNo(variant);
          if (doc) break;
        }
        if (!doc && item.id) {
          doc = await repo.documents.findById(item.id);
        }

        if (doc) {
          // รักษาเนื้อหา note เดิมไว้เสมอ — note อาจมี from/to ที่ parseTransferMetadata ใช้อ่านทิศโกดัง
          let meta: Record<string, any> = {};
          if (doc.note && typeof doc.note === "string" && doc.note.trim()) {
            if (doc.note.trim().startsWith("{")) {
              try {
                meta = JSON.parse(doc.note);
              } catch {
                meta = { original_note: doc.note };
              }
            } else {
              meta = { original_note: doc.note };
            }
          }

          const items = meta.express_items && typeof meta.express_items === "object" ? { ...meta.express_items } : {};
          if (item.sku) {
            items[cleanExpressCode(item.sku)] = item.status;
          } else {
            // ผู้เรียกไม่ระบุ SKU — เอกสารนี้ควรมีรายการเดียว จึงใส่ที่คีย์ว่างให้ aggregate ทำงานถูก
            items[""] = item.status;
          }
          meta.express_items = items;
          meta.express_status = aggregateDocStatus(Object.values(items));
          meta.express_status_text = meta.express_status === "IMPORTED" ? "นำเข้า Express แล้ว" : "รอนำเข้า Express";
          meta.express_synced_at = now;

          const updatedNote = JSON.stringify(meta);
          await repo.documents.updateNote(doc.document_id, updatedNote);
        }
      } catch (docErr) {
        console.warn(`[POST /api/express-import/status] Update doc note failed for ${item.document_no}:`, docErr);
      }
    }

    return successResponse(
      {
        updated_count: rawItems.length,
        details: results,
        all_sheet_synced: allSheetSynced,
        unmatched_count: results.filter((r) => !r.matched).length,
        updated_at: now,
      },
      allSheetSynced
        ? "อัปเดตสถานะ Express ทั้งบนระบบและ Google Sheet เรียบร้อยแล้ว"
        : "อัปเดตสถานะบนระบบแล้ว แต่ยังเขียน Google Sheet ไม่ครบทุกแถว"
    );
  } catch (error) {
    console.error("[POST /api/express-import/status] Error:", error);
    return serverErrorResponse(error);
  }
}
