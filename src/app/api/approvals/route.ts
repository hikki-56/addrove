import { NextRequest } from "next/server";
import { readSheet, SHEETS } from "@/lib/google-sheets/client";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { getAuthSession } from "@/lib/auth-session";
import { getDocumentStatus } from "@/lib/document-status-store";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่ดูรายการอนุมัติได้");

    const { searchParams } = new URL(req.url);
    const targetStatus = (searchParams.get("status") || "PENDING").toUpperCase();

    const rows = await readSheet(SHEETS.DOCUMENTS);
    const resultDocs: Array<{
      document_id: string;
      document_no: string;
      warehouse_id: string;
      document_date: string;
      status: string;
      created_by: string;
      created_at: string;
      target_sheet: string;
      rows: Array<[string, string, string, string, number, string, string, string]>;
    }> = [];

    // Fetch PRODUCTS sheet to build exact SKU -> Barcode lookup map
    const productSheetRows = await readSheet(SHEETS.PRODUCTS).catch(() => []);
    const productBarcodeMap = new Map<string, string>();
    for (const pRow of productSheetRows) {
      if (!pRow || pRow.length === 0) continue;
      const pSku = String(pRow[0] ?? "").trim();
      if (!pSku || pSku === "รหัสสินค้า" || pSku === "SKU") continue;
      const pBarcode = String(pRow[1] ?? "").trim();
      if (pBarcode && pBarcode.toLowerCase() !== pSku.toLowerCase()) {
        productBarcodeMap.set(pSku.toLowerCase(), pBarcode);
      }
    }

    for (const r of rows) {
      if (!r || r.length === 0) continue;
      // Skip header row if present
      if (r[0] === "document_id" || r[0] === "ID" || r[0] === "document_no") continue;

      const docType = (r[2] || "").trim().toUpperCase();
      const rawDocStatus = (r[5] || "").trim().toUpperCase();
      const overrideStatus = getDocumentStatus(r[0]) || getDocumentStatus(r[1]);
      const docStatus = overrideStatus || rawDocStatus;

      // Approvals page is for RECEIVE documents (or payloads containing target_sheet)
      const isReceive = docType.includes("RECEIVE") || docType.includes("RCV") || (r[6] && r[6].includes("target_sheet"));
      if (!isReceive) continue;

      const isApprovedOrRejected = ["POSTED", "APPROVED", "COMPLETED", "REJECTED", "REJECT", "CANCELLED"].includes(docStatus);

      const matchesStatus =
        targetStatus === "ALL" ||
        (targetStatus === "PENDING" && !isApprovedOrRejected && (docStatus === "PENDING" || docStatus === "DRAFT" || docStatus === "NEW" || !docStatus)) ||
        (targetStatus === "POSTED" && (docStatus === "POSTED" || docStatus === "APPROVED" || docStatus === "COMPLETED")) ||
        (targetStatus === "REJECTED" && (docStatus === "REJECTED" || docStatus === "REJECT" || docStatus === "CANCELLED"));

      if (r[0] && matchesStatus) {
        let parsedPayload = { warehouse_id: r[3] || "wh-1", target_sheet: "โกดัง1", rows: [] as Array<any[]> };
        try {
          if (r[6] && r[6].startsWith("{")) {
            parsedPayload = JSON.parse(r[6]);
          }
        } catch {}

        // Resolve numeric barcodes for all items in parsedPayload.rows
        const resolvedRows = (parsedPayload.rows || []).map((rowItem) => {
          const itemRow = [...rowItem];
          const sku = String(itemRow[0] ?? "").trim();
          const r1 = String(itemRow[1] ?? "").trim();
          const r2 = String(itemRow[2] ?? "").trim();
          const r3 = String(itemRow[3] ?? "").trim();

          // 1. First priority: Check PRODUCTS sheet lookup map for real barcode
          let rawBarcode = productBarcodeMap.get(sku.toLowerCase()) || "";

          // 2. Second priority: Check if r2 is a numeric/distinct barcode
          if (!rawBarcode && r2 && r2 !== "ทั่วไป" && r2.toLowerCase() !== sku.toLowerCase()) {
            rawBarcode = r2;
          }

          // 3. Third priority: Extract leading numbers from product name (r3 or r1)
          if (!rawBarcode || rawBarcode.toLowerCase() === sku.toLowerCase()) {
            const textToSearch = r3 || r1;
            const match = textToSearch.match(/^(\d{3,10})/);
            if (match) {
              rawBarcode = match[1];
            }
          }

          const formattedBarcode = to8DigitBarcode(rawBarcode, sku);
          itemRow[2] = formattedBarcode || rawBarcode || r1 || sku;

          return itemRow;
        });

        resultDocs.push({
          document_id: r[0],
          document_no: r[1] || "",
          warehouse_id: r[3] || parsedPayload.warehouse_id || "wh-1",
          document_date: r[4] || "",
          status: docStatus,
          created_by: r[7] || "Staff",
          created_at: r[8] || new Date().toISOString(),
          target_sheet: parsedPayload.target_sheet || "โกดัง1",
          rows: resolvedRows as any,
        });
      }
    }

    return successResponse(resultDocs, "ดึงรายการเอกสารสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
