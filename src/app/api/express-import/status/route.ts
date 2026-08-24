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

interface StatusUpdateItem {
  id?: string;
  document_no: string;
  sku?: string;
  barcode?: string;
  status: "IMPORTED" | "PENDING";
  type?: "ISSUE" | "RECEIVE" | "TRANSFER";
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

    const repo = getRepository();
    const results: Array<{ document_no: string; updated: boolean; sheet_synced: boolean }> = [];

    // Group items by sheet type
    const sheetTypes = new Set(rawItems.map((i) => i.type || "ISSUE"));

    for (const type of Array.from(sheetTypes)) {
      let targetSheet: string = SHEETS.EXPRESS_ISSUE;
      if (type === "RECEIVE") targetSheet = SHEETS.EXPRESS_RECEIVE;
      if (type === "TRANSFER") targetSheet = SHEETS.EXPRESS_TRANSFER;

      const itemsForType = rawItems.filter((i) => (i.type || "ISSUE") === type);
      const targetDocNos = new Map<string, StatusUpdateItem>();
      itemsForType.forEach((i) => {
        if (i.document_no) {
          targetDocNos.set(i.document_no.trim().toLowerCase(), i);
        }
      });

      try {
        const sheetRows = await readSheet(targetSheet, undefined, { forceFresh: true }).catch(() => []);
        
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

            // Update row in Google Sheets (rowIndex is 0-indexed, Google Sheets is 1-indexed, header is row 1)
            const sheetRowNumber = rowIndex + 2;
            await updateRow(targetSheet, sheetRowNumber, updatedRow).catch((err) => {
              console.warn(`[POST /api/express-import/status] updateRow failed on row ${sheetRowNumber}:`, err);
            });

            results.push({
              document_no: matchedItem.document_no,
              updated: true,
              sheet_synced: true,
            });
          }
        }
      } catch (sheetErr) {
        console.warn(`[POST /api/express-import/status] Process sheet ${targetSheet} error:`, sheetErr);
      }
    }

    // Also update document note in repository
    for (const item of rawItems) {
      try {
        let doc = await repo.documents.findByNo(item.document_no);
        if (!doc && item.id) {
          doc = await repo.documents.findById(item.id);
        }

        if (doc) {
          let meta: Record<string, any> = {};
          try {
            if (doc.note && typeof doc.note === "string" && doc.note.startsWith("{")) {
              meta = JSON.parse(doc.note);
            }
          } catch {}

          meta.express_status = item.status;
          meta.express_status_text = item.status === "IMPORTED" ? "นำเข้า Express แล้ว" : "รอนำเข้า Express";
          meta.express_synced_at = new Date().toISOString();

          const updatedNote = JSON.stringify(meta);
          await repo.documents.updateNote(doc.document_id, updatedNote);
        }
      } catch (docErr) {
        console.warn(`[POST /api/express-import/status] Update doc note failed for ${item.document_no}:`, docErr);
      }
    }

    return successResponse(
      { updated_count: rawItems.length, details: results },
      "อัปเดตสถานะ Express ทั้งบนระบบและ Google Sheet เรียบร้อยแล้ว"
    );
  } catch (error) {
    console.error("[POST /api/express-import/status] Error:", error);
    return serverErrorResponse(error);
  }
}
