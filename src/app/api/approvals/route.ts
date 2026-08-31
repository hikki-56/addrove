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
import { expressStatusMap } from "@/app/api/express-import/status/route";

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
      created_by_name?: string;
      created_at: string;
      target_sheet: string;
      express_status?: string;
      express_status_text?: string;
      rows: Array<[string, string, string, string, number, string, string, string]>;
    }> = [];

    // Fetch PRODUCTS repository to build SKU -> Barcode and SKU -> Supplier map
    const [allProducts, allUsers] = await Promise.all([
      repo.products.findAll().catch(() => []),
      repo.users.findAll().catch(() => []),
    ]);

    const productBarcodeMap = new Map<string, string>();
    const productSupplierMap = new Map<string, string>();
    allProducts.forEach((p: any) => {
      if (p.sku && p.barcode && p.barcode !== "-" && p.barcode.toLowerCase() !== p.sku.toLowerCase()) {
        productBarcodeMap.set(p.sku.toLowerCase(), p.barcode);
      }
      const s = p.supplier || (p.description ? p.description.replace(/^ผู้จำหน่าย:\s*/, "") : "");
      if (s && p.sku) productSupplierMap.set(p.sku.toLowerCase(), s);
    });

    const userMap = new Map<string, string>();
    allUsers.forEach((u: any) => {
      const name = u.full_name || u.username || (u.email ? u.email.split("@")[0] : "");
      if (name) {
        if (u.user_id) userMap.set(String(u.user_id).toLowerCase(), name);
        if (u.email) userMap.set(String(u.email).toLowerCase(), name);
        if (u.username) userMap.set(String(u.username).toLowerCase(), name);
      }
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
        let parsedPayload: { warehouse_id?: string; target_sheet?: string; rows?: any[][]; express_status?: string; created_by_name?: string } = { warehouse_id: "wh-1", target_sheet: "โกดัง1", rows: [] };
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
            const match = textToSearch.match(/^(\d{3,18})/);
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

        const docKey = (doc.document_no || "").trim().toLowerCase();
        const docIdKey = (doc.document_id || "").trim().toLowerCase();
        const memStatus = (docKey && expressStatusMap.get(docKey)?.status) || (docIdKey && expressStatusMap.get(docIdKey)?.status);
        const effectiveExpressStatus = memStatus || parsedPayload.express_status || "PENDING";

        const rawCreatedBy = (doc.created_by || "").trim();
        const creatorNameFromPayload = parsedPayload.created_by_name || (parsedPayload as any).user_name || (parsedPayload as any).moved_by;
        const creatorNameFromDoc = (doc as any).created_by_name;
        const creatorNameFromUser = rawCreatedBy ? userMap.get(rawCreatedBy.toLowerCase()) : "";
        const isUuidOrId = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(rawCreatedBy) || /^id-[0-9]+/i.test(rawCreatedBy) || /^usr-/i.test(rawCreatedBy);
        const fallbackName = rawCreatedBy && !isUuidOrId ? rawCreatedBy : "พนักงานรับสินค้า";

        const resolvedCreator = (creatorNameFromPayload || creatorNameFromDoc || creatorNameFromUser || fallbackName).trim();

        resultDocs.push({
          document_id: doc.document_id,
          document_no: doc.document_no || "",
          warehouse_id: parsedPayload.warehouse_id || "wh-1",
          document_date: doc.document_date || "",
          status: docStatus,
          created_by: resolvedCreator,
          created_by_name: resolvedCreator,
          created_at: doc.created_at || new Date().toISOString(),
          target_sheet: parsedPayload.target_sheet || "โกดัง1",
          express_status: effectiveExpressStatus,
          express_status_text: effectiveExpressStatus === "IMPORTED" ? "นำเข้า Express แล้ว" : "รอนำเข้า Express",
          rows: resolvedRows as any,
        });
      }
    }

    return successResponse(resultDocs, "ดึงรายการเอกสารสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
