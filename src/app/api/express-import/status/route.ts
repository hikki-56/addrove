import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { readSheet, updateRow, SHEETS } from "@/lib/google-sheets/client";
import {
  successResponse,
  unauthorizedResponse,
  serverErrorResponse,
  errorResponse,
} from "@/lib/api-response";

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
  sku?: string;
  barcode?: string;
  status: "IMPORTED" | "PENDING";
  type?: "ISSUE" | "RECEIVE" | "TRANSFER";
}

// Global in-memory status cache to immediately sync across all clients
const globalForExpressStatus = globalThis as unknown as {
  expressStatusMap?: Map<string, { status: "IMPORTED" | "PENDING"; type: string; updated_at: string; document_no: string }>;
};

export const expressStatusMap =
  globalForExpressStatus.expressStatusMap ||
  (globalForExpressStatus.expressStatusMap = new Map<
    string,
    { status: "IMPORTED" | "PENDING"; type: string; updated_at: string; document_no: string }
  >());

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(req.url);
    const typeFilter = searchParams.get("type")?.toUpperCase();

    const repo = getRepository();

    // 1. Convert in-memory statuses to a plain object
    const resultObj: Record<string, { status: "IMPORTED" | "PENDING"; type: string; updated_at: string; document_no: string }> = {};

    expressStatusMap.forEach((val, key) => {
      if (!typeFilter || val.type === typeFilter) {
        resultObj[key] = val;
      }
    });

    // 2. Also check recent documents from repository
    try {
      const allDocs = await repo.documents.findAll({ page: 1, limit: 1000 }).catch(() => ({ data: [] }));
      (allDocs.data || []).forEach((doc) => {
        if (!doc.document_no && !doc.document_id) return;
        let meta: Record<string, any> = {};
        try {
          if (doc.note && typeof doc.note === "string" && doc.note.startsWith("{")) {
            meta = JSON.parse(doc.note);
          }
        } catch {}

        if (meta.express_status) {
          const docNoKey = (doc.document_no || "").trim().toLowerCase();
          const docIdKey = (doc.document_id || "").trim().toLowerCase();
          const statusVal: "IMPORTED" | "PENDING" = meta.express_status === "IMPORTED" ? "IMPORTED" : "PENDING";
          const type = (doc.document_type || "RECEIVE").toUpperCase();
          const entry = {
            status: statusVal,
            type,
            updated_at: meta.express_synced_at || doc.created_at || new Date().toISOString(),
            document_no: doc.document_no || doc.document_id,
          };

          if (docNoKey && !resultObj[docNoKey]) {
            resultObj[docNoKey] = entry;
            expressStatusMap.set(docNoKey, entry);
          }
          if (docIdKey && !resultObj[docIdKey]) {
            resultObj[docIdKey] = entry;
            expressStatusMap.set(docIdKey, entry);
          }
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

    const body = await req.json().catch(() => ({}));
    const rawItems: StatusUpdateItem[] = Array.isArray(body.items)
      ? body.items
      : body.document_no
      ? [body]
      : [];

    if (rawItems.length === 0) {
      return errorResponse("กรุณาระบุข้อมูลรายการที่ต้องการอัปเดตสถานะ", 400);
    }

    const now = new Date().toISOString();

    // 1. Immediately store in global in-memory map
    rawItems.forEach((item) => {
      const type = (item.type || "ISSUE").toUpperCase();
      const statusVal: "IMPORTED" | "PENDING" = item.status === "IMPORTED" ? "IMPORTED" : "PENDING";
      const entry: { status: "IMPORTED" | "PENDING"; type: string; updated_at: string; document_no: string } = {
        status: statusVal,
        type,
        updated_at: now,
        document_no: item.document_no,
      };

      if (item.document_no) {
        expressStatusMap.set(item.document_no.trim().toLowerCase(), entry);
      }
      if (item.id) {
        expressStatusMap.set(item.id.trim().toLowerCase(), entry);
      }
    });

    const repo = getRepository();
    const results: Array<{ document_no: string; updated: boolean; sheet_synced: boolean }> = [];

    // 2. Group items by sheet type
    const sheetTypes = new Set(rawItems.map((i) => (i.type || "ISSUE").toUpperCase()));

    for (const type of Array.from(sheetTypes)) {
      let targetSheet: string = SHEETS.EXPRESS_ISSUE;
      if (type === "RECEIVE") targetSheet = SHEETS.EXPRESS_RECEIVE;
      if (type === "TRANSFER") targetSheet = SHEETS.EXPRESS_TRANSFER;

      const itemsForType = rawItems.filter((i) => (i.type || "ISSUE").toUpperCase() === type);
      const targetDocNos = new Map<string, StatusUpdateItem>();
      itemsForType.forEach((i) => {
        if (i.document_no) {
          targetDocNos.set(i.document_no.trim().toLowerCase(), i);
        }
      });

      try {
        // อ่านแบบ keepHeader เพื่อให้ index ตรงกับแถวจริงในชีต (แถวจริง = index + 1)
        // เดิมอ่านผ่าน readSheet ที่ตัดหัวตารางแบบมีเงื่อนไข ทำให้ rowIndex + 2 เพี้ยน 1 แถว
        // แล้วเขียนทับแถวข้างเคียงทั้งแถวได้
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

          let matchedItem: StatusUpdateItem | undefined;
          let statusColIdx = 6;

          // Check layout A: [SKU, Location, DocNo, Warehouse, Date, ProductName, Status, Qty, Barcode]
          const docNoCandidateA = String(row[2] ?? "").trim().toLowerCase();
          // Check layout B: [Date, DocNo, Barcode, SKU, ProductName, Warehouse, Location, Qty, ...]
          const docNoCandidateB = String(row[1] ?? "").trim().toLowerCase();
          // Check layout C: Col 0 is DocNo
          const docNoCandidateC = String(row[0] ?? "").trim().toLowerCase();

          if (targetDocNos.has(docNoCandidateA)) {
            matchedItem = targetDocNos.get(docNoCandidateA);
            statusColIdx = 6;
          } else if (targetDocNos.has(docNoCandidateB)) {
            matchedItem = targetDocNos.get(docNoCandidateB);
            statusColIdx = row.length >= 11 ? 10 : row.length >= 10 ? 9 : 6;
          } else if (targetDocNos.has(docNoCandidateC)) {
            matchedItem = targetDocNos.get(docNoCandidateC);
            statusColIdx = 6;
          }

          if (matchedItem) {
            const statusText =
              matchedItem.status === "IMPORTED"
                ? "นำเข้า Express แล้ว"
                : "รอนำเข้า Express";

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

            results.push({
              document_no: matchedItem.document_no,
              updated: true,
              sheet_synced: rowUpdated,
            });
          }
        }
      } catch (sheetErr) {
        console.warn(`[POST /api/express-import/status] Process sheet ${targetSheet} error:`, sheetErr);
      }
    }

    // เขียนชีตสำเร็จครบทุกรายการหรือไม่ — client ใช้ค่านี้ตัดสินว่าจะรอ sync ต่อหรือไม่
    // (หากไม่มีแถวที่ match เลยถือว่าผ่าน เพราะแถวอาจถูกลบไปแล้ว และสถานะยังอยู่ใน memory + doc note)
    const allSheetSynced = results.every((r) => r.sheet_synced);

    // 3. Update document note in repository
    for (const item of rawItems) {
      try {
        let doc = await repo.documents.findByNo(item.document_no);
        if (!doc && item.id) {
          doc = await repo.documents.findById(item.id);
        }

        if (doc) {
          // รักษาเนื้อหา note เดิมไว้เสมอ — note อาจมี from/to ที่ parseTransferMetadata ใช้อ่านทิศโกดัง
          // เดิมถ้า note ไม่ใช่ JSON จะถูกแทนที่ด้วย JSON ที่มีแต่ express_status ทำให้ข้อมูลทิศโกดังหาย
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

          meta.express_status = item.status;
          meta.express_status_text = item.status === "IMPORTED" ? "นำเข้า Express แล้ว" : "รอนำเข้า Express";
          meta.express_synced_at = now;

          const updatedNote = JSON.stringify(meta);
          await repo.documents.updateNote(doc.document_id, updatedNote);
        }
      } catch (docErr) {
        console.warn(`[POST /api/express-import/status] Update doc note failed for ${item.document_no}:`, docErr);
      }
    }

    return successResponse(
      { updated_count: rawItems.length, details: results, all_sheet_synced: allSheetSynced, updated_at: now },
      "อัปเดตสถานะ Express ทั้งบนระบบและ Google Sheet เรียบร้อยแล้ว"
    );
  } catch (error) {
    console.error("[POST /api/express-import/status] Error:", error);
    return serverErrorResponse(error);
  }
}
