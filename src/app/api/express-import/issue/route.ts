import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { readSheet, SHEETS } from "@/lib/google-sheets/client";
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
      created_at: string;
      created_by_name: string;
      sku: string;
      product_name: string;
      quantity: number;
      location: string;
      barcode: string;
      movement_type: string;
      tag: string;
      status: string;
    }> = [];

    const seenIds = new Set<string>();

    // 1. Read directly from Google Sheets Tab: "เบิกสินค้าเข้าExpress"
    try {
      const sheetRows = await readSheet(SHEETS.EXPRESS_ISSUE).catch(() => []);
      for (let idx = 0; idx < sheetRows.length; idx++) {
        const row = sheetRows[idx];
        if (!row || row.length === 0) continue;
        const col0 = String(row[0] ?? "").trim();
        if (col0 === "วันที่" || col0 === "Date" || col0 === "เลขที่เอกสาร") continue;

        const date = String(row[0] ?? "").trim() || new Date().toISOString().slice(0, 10);
        const docNo = String(row[1] ?? "").trim() || `ISS-${idx + 1}`;
        const rawBarcode = String(row[2] ?? "").trim();
        const sku = String(row[3] ?? "").trim();
        const productName = String(row[4] ?? "").trim() || sku;
        const whName = String(row[5] ?? "").trim() || "โกดัง1";
        const location = String(row[6] ?? "").trim() || "-";
        const qty = Math.abs(parseFloat(String(row[7] ?? "1").replace(/,/g, "")) || 1);
        const createdBy = String(row[8] ?? "").trim() || "ผู้ใช้งาน";
        const status = String(row[10] ?? row[9] ?? "รอนำเข้า Express").trim();

        const barcode =
          rawBarcode && rawBarcode !== "-" && rawBarcode !== "null"
            ? rawBarcode
            : to8DigitBarcode(rawBarcode, sku) || sku;

        const uniqueKey = `sheet_iss_${docNo}_${sku}_${idx}`;
        if (!seenIds.has(uniqueKey)) {
          seenIds.add(uniqueKey);
          items.push({
            id: uniqueKey,
            movement_id: `mov-${docNo}-${idx}`,
            document_id: docNo,
            document_no: docNo,
            warehouse_name: whName,
            warehouse_id: whName,
            created_at: date,
            created_by_name: createdBy,
            sku,
            product_name: productName,
            quantity: qty,
            location,
            barcode,
            movement_type: "ISSUE_OUT",
            tag: "เบิกสินค้าเข้า Express",
            status: status.includes("แล้ว") ? "IMPORTED" : "PENDING",
          });
        }
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
          if (doc.note && doc.note.startsWith("{")) meta = JSON.parse(doc.note);
        } catch {}

        const sku = meta.sku || "";
        const rawBarcode = meta.barcode || "";
        const barcode =
          rawBarcode && rawBarcode !== "-" && rawBarcode !== "null"
            ? rawBarcode
            : to8DigitBarcode(rawBarcode, sku) || sku;

        const uniqueKey = `iss_trf-mov-${doc.document_id}_${sku}_0`;
        const hasMatch = Array.from(seenIds).some((id) => id.includes(doc.document_no));

        if (!hasMatch && !seenIds.has(uniqueKey)) {
          seenIds.add(uniqueKey);
          items.push({
            id: uniqueKey,
            movement_id: `trf-mov-${doc.document_id}`,
            document_id: doc.document_id,
            document_no: doc.document_no,
            warehouse_name: meta.from_warehouse_name || meta.from_warehouse_id || "โกดัง 1",
            warehouse_id: meta.from_warehouse_id || "wh-1",
            created_at: (meta.completed_at || doc.created_at || new Date().toISOString()).slice(0, 10),
            created_by_name: meta.moved_by || meta.assigned_to_name || "ผู้ใช้งาน",
            sku,
            product_name: meta.product_name || sku,
            quantity: Math.abs(Number(meta.qty) || 1),
            location: meta.from_location_id || "-",
            barcode,
            movement_type: "TRANSFER_OUT",
            tag: meta.express_tag || "เบิกสินค้าเข้า Express",
            status: meta.express_status || "PENDING",
          });
        }
      }
    } catch (e) {
      console.warn("[GET /api/express-import/issue] Repo docs error:", e);
    }

    return successResponse(items, "โหลดรายการเบิกสินค้าเข้า Express สำเร็จ");
  } catch (error) {
    return serverErrorResponse(error);
  }
}
