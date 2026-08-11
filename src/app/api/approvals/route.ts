import { NextRequest } from "next/server";
import { getRepository } from "@/lib/repositories";
import { readSheet, SHEETS } from "@/lib/google-sheets/client";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import {
  successResponse,
  unauthorizedResponse,
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
    // Allow all roles to view approvals (Admin can approve, staff can check status)

    const { searchParams } = new URL(req.url);
    const targetStatus = (searchParams.get("status") || "PENDING").toUpperCase();

    // Read documents through repository (includes in-memory fallback documents)
    const repo = getRepository();
    const allDocsResult = await repo.documents.findAll({ page: 1, limit: 99999 });
    const allDocuments = allDocsResult.data || [];

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

    // Fetch PRODUCTS repository to build SKU -> Supplier map
    const allProducts = await repo.products.findAll().catch(() => []);
    const productSupplierMap = new Map<string, string>();
    allProducts.forEach((p: any) => {
      const s = p.supplier || (p.description ? p.description.replace(/^ผู้จำหน่าย:\s*/, "") : "");
      if (s && p.sku) productSupplierMap.set(p.sku.toLowerCase(), s);
    });

    for (const doc of allDocuments) {
      if (!doc.document_id) continue;

      const docType = (doc.document_type || "").trim().toUpperCase();
      const rawDocStatus = (doc.status || "").trim().toUpperCase();
      const overrideStatus = getDocumentStatus(doc.document_id) || getDocumentStatus(doc.document_no);
      const docStatus = overrideStatus || rawDocStatus;

      // Approvals page is for RECEIVE documents
      const isReceive = docType.includes("RECEIVE") || docType.includes("RCV") || (doc.note && doc.note.includes("target_sheet"));
      if (!isReceive) continue;

      const isApprovedOrRejected = ["POSTED", "APPROVED", "COMPLETED", "REJECTED", "REJECT", "CANCELLED"].includes(docStatus);

      const matchesStatus =
        targetStatus === "ALL" ||
        (targetStatus === "PENDING" && !isApprovedOrRejected && (docStatus === "PENDING" || docStatus === "DRAFT" || docStatus === "NEW" || !docStatus)) ||
        (targetStatus === "POSTED" && (docStatus === "POSTED" || docStatus === "APPROVED" || docStatus === "COMPLETED")) ||
        (targetStatus === "REJECTED" && (docStatus === "REJECTED" || docStatus === "REJECT" || docStatus === "CANCELLED"));

      if (matchesStatus) {
        let parsedPayload = { warehouse_id: "wh-1", target_sheet: "โกดัง1", rows: [] as Array<any[]> };
        try {
          if (doc.note && doc.note.startsWith("{")) {
            parsedPayload = JSON.parse(doc.note);
          }
        } catch {}

        // Resolve numeric barcodes & supplier for all items in parsedPayload.rows
        const resolvedRows = (parsedPayload.rows || []).map((rowItem) => {
          const itemRow = [...rowItem];
          const sku = String(itemRow[0] ?? "").trim();
          const r1 = String(itemRow[1] ?? "").trim();
          const r2 = String(itemRow[2] ?? "").trim();
          const r3 = String(itemRow[3] ?? "").trim();

          let rawBarcode = productBarcodeMap.get(sku.toLowerCase()) || "";

          if (!rawBarcode && r2 && r2 !== "ทั่วไป" && r2.toLowerCase() !== sku.toLowerCase()) {
            rawBarcode = r2;
          }

          if (!rawBarcode || rawBarcode.toLowerCase() === sku.toLowerCase()) {
            const textToSearch = r3 || r1;
            const match = textToSearch.match(/^(\d{3,10})/);
            if (match) {
              rawBarcode = match[1];
            }
          }

          const formattedBarcode = to8DigitBarcode(rawBarcode, sku);
          itemRow[2] = formattedBarcode || rawBarcode || r1 || sku;

          const currentSupplier = String(itemRow[6] ?? "").trim();
          if (!currentSupplier || currentSupplier === "-" || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(currentSupplier)) {
            itemRow[6] = productSupplierMap.get(sku.toLowerCase()) || "-";
          }

          return itemRow;
        });

        resultDocs.push({
          document_id: doc.document_id,
          document_no: doc.document_no || "",
          warehouse_id: parsedPayload.warehouse_id || "wh-1",
          document_date: doc.document_date || "",
          status: docStatus,
          created_by: doc.created_by || "Staff",
          created_at: doc.created_at || new Date().toISOString(),
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
