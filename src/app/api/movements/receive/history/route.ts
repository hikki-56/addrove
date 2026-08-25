import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { getDocumentStatus } from "@/lib/document-status-store";
import {
  successResponse,
  unauthorizedResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();

    const repo = getRepository();
    const allDocsResult = await repo.documents.findAll({ page: 1, limit: 99999 });
    const allDocuments = allDocsResult.data || [];

    // Fetch PRODUCTS repository to enrich SKU, barcodes and suppliers
    const allProducts = await repo.products.findAll().catch(() => []);
    const productBarcodeMap = new Map<string, string>();
    const productSupplierMap = new Map<string, string>();
    const productNameMap = new Map<string, string>();
    const productUnitMap = new Map<string, string>();

    allProducts.forEach((p: any) => {
      const skuKey = String(p.sku || "").trim().toLowerCase();
      const idKey = String(p.product_id || "").trim().toLowerCase();
      if (skuKey) {
        if (p.barcode && p.barcode !== "-" && p.barcode.toLowerCase() !== skuKey) {
          productBarcodeMap.set(skuKey, p.barcode);
        }
        const s = p.supplier || (p.description ? p.description.replace(/^ผู้จำหน่าย:\s*/, "") : "");
        if (s) productSupplierMap.set(skuKey, s);
        if (p.product_name) productNameMap.set(skuKey, p.product_name);
        if (p.base_unit) productUnitMap.set(skuKey, p.base_unit);
      }
      if (idKey) {
        if (p.product_name && !productNameMap.has(idKey)) productNameMap.set(idKey, p.product_name);
        if (p.base_unit && !productUnitMap.has(idKey)) productUnitMap.set(idKey, p.base_unit);
      }
    });

    const resultDocs: Array<any> = [];

    for (const doc of allDocuments) {
      if (!doc.document_id && !doc.document_no) continue;

      const docType = (doc.document_type || "").trim().toUpperCase();
      const rawDocStatus = (doc.status || "").trim().toUpperCase();
      const overrideStatus = getDocumentStatus(doc.document_id) || getDocumentStatus(doc.document_no);
      const docStatus = (overrideStatus || rawDocStatus || "PENDING").toUpperCase();

      // Check if it is a RECEIVE document
      const isReceive =
        docType.includes("RECEIVE") ||
        docType.includes("RCV") ||
        (doc.document_no && doc.document_no.startsWith("RCV-")) ||
        (doc.note && doc.note.includes("target_sheet") && !doc.note.includes("from_warehouse_id"));

      if (!isReceive) continue;

      let parsedPayload: any = { warehouse_id: "wh-01", target_sheet: "โกดัง1", rows: [], lines: [] };
      try {
        if (doc.note && typeof doc.note === "string") {
          const trimmed = doc.note.trim();
          if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            parsedPayload = JSON.parse(trimmed);
          } else {
            const first = trimmed.indexOf("{");
            const last = trimmed.lastIndexOf("}");
            if (first !== -1 && last > first) {
              parsedPayload = JSON.parse(trimmed.slice(first, last + 1));
            }
          }
        }
      } catch {}

      // Normalize status
      let normalizedStatus: "COMPLETED" | "WAITING_APPROVAL" | "CANCELLED" | "PENDING" = "PENDING";
      if (["POSTED", "APPROVED", "COMPLETED", "DONE", "SUCCESS", "สำเร็จ"].includes(docStatus)) {
        normalizedStatus = "COMPLETED";
      } else if (["REJECTED", "REJECT", "CANCELLED", "CANCEL", "VOID", "ยกเลิก"].includes(docStatus)) {
        normalizedStatus = "CANCELLED";
      } else if (["WAITING_APPROVAL", "WAITING", "รออนุมัติ"].includes(docStatus)) {
        normalizedStatus = "WAITING_APPROVAL";
      } else {
        normalizedStatus = "WAITING_APPROVAL"; // Receive documents are created as pending approval
      }

      // Extract rows
      const rawRows: any[] = Array.isArray(parsedPayload.rows) ? parsedPayload.rows : [];
      const lines: any[] = Array.isArray(parsedPayload.lines) ? parsedPayload.lines : [];

      // Build structured items
      const items: Array<{
        sku: string;
        location_code: string;
        barcode: string;
        product_name: string;
        qty: number;
        base_unit: string;
        warehouse_name: string;
        supplier: string;
      }> = [];

      if (rawRows.length > 0) {
        for (const rowItem of rawRows) {
          const sku = String(rowItem[0] ?? "").trim();
          const locationCode = String(rowItem[1] ?? "-").trim();
          const rawBarcode = String(rowItem[2] ?? "").trim();
          const prodName = String(rowItem[3] ?? "").trim() || productNameMap.get(sku.toLowerCase()) || (sku ? `สินค้า ${sku}` : "รายการรับสินค้า");
          const qty = Number(rowItem[4]) || 1;
          const whName = String(rowItem[5] ?? parsedPayload.target_sheet ?? "โกดัง1").trim();
          const supplier = String(rowItem[6] ?? "").trim() || productSupplierMap.get(sku.toLowerCase()) || "-";
          const barcode = rawBarcode && rawBarcode !== "-" && rawBarcode !== "ทั่วไป" ? rawBarcode : productBarcodeMap.get(sku.toLowerCase()) || sku || "-";
          const baseUnit = productUnitMap.get(sku.toLowerCase()) || "ชิ้น";

          items.push({
            sku: sku || "-",
            location_code: locationCode || "ตำแหน่งเริ่มต้น",
            barcode: barcode || "-",
            product_name: prodName,
            qty,
            base_unit: baseUnit,
            warehouse_name: whName,
            supplier: supplier || "-",
          });
        }
      } else if (lines.length > 0) {
        for (const l of lines) {
          const sku = String(l.sku || l.product_id || "").replace(/^prod-/, "").trim();
          const locationCode = String(l.location_id || l.location_code || "ตำแหน่งเริ่มต้น").trim();
          const barcode = String(l.barcode || productBarcodeMap.get(sku.toLowerCase()) || sku || "-").trim();
          const prodName = String(l.product_name || productNameMap.get(sku.toLowerCase()) || (sku ? `สินค้า ${sku}` : "รายการรับสินค้า")).trim();
          const qty = Number(l.qty) || 1;
          const whName = parsedPayload.target_sheet || "โกดัง1";
          const supplier = productSupplierMap.get(sku.toLowerCase()) || "-";
          const baseUnit = productUnitMap.get(sku.toLowerCase()) || "ชิ้น";

          items.push({
            sku: sku || "-",
            location_code: locationCode,
            barcode,
            product_name: prodName,
            qty,
            base_unit: baseUnit,
            warehouse_name: whName,
            supplier,
          });
        }
      }

      // If no items extracted, make fallback item
      if (items.length === 0) {
        const prodId = String(parsedPayload.product_id || "").replace(/^prod-/, "");
        items.push({
          sku: prodId || "-",
          location_code: parsedPayload.location_id || "ตำแหน่งเริ่มต้น",
          barcode: "-",
          product_name: productNameMap.get(prodId.toLowerCase()) || (prodId ? `สินค้า ${prodId}` : "รายการรับสินค้า"),
          qty: Number(parsedPayload.qty) || 1,
          base_unit: "ชิ้น",
          warehouse_name: parsedPayload.target_sheet || "โกดัง1",
          supplier: "-",
        });
      }

      const totalQty = items.reduce((sum, it) => sum + it.qty, 0);
      const primaryItem = items[0];

      resultDocs.push({
        id: doc.document_id || doc.document_no,
        document_no: doc.document_no || doc.document_id,
        reference_no: doc.reference_no || "-",
        warehouse_id: parsedPayload.warehouse_id || "wh-01",
        warehouse_name: parsedPayload.target_sheet || primaryItem?.warehouse_name || "โกดัง 1",
        document_date: doc.document_date || String(doc.created_at || "").slice(0, 10),
        status: normalizedStatus,
        raw_status: docStatus,
        created_by: doc.created_by || "staff",
        created_by_name: doc.created_by || "พนักงานรับสินค้า",
        created_at: doc.created_at || new Date().toISOString(),
        total_items: items.length,
        total_qty: totalQty,
        primary_product_name: primaryItem?.product_name || "รายการรับสินค้า",
        primary_sku: primaryItem?.sku || "-",
        primary_barcode: primaryItem?.barcode || "-",
        primary_supplier: primaryItem?.supplier || "-",
        primary_location: primaryItem?.location_code || "ตำแหน่งเริ่มต้น",
        items,
        note: parsedPayload.note || (typeof doc.note === "string" && !doc.note.startsWith("{") ? doc.note : ""),
      });
    }

    // Sort newest first
    resultDocs.sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.document_no || "").localeCompare(a.document_no || "");
    });

    return successResponse(resultDocs, "โหลดประวัติการรับสินค้าสำเร็จ");
  } catch (e) {
    console.error("[GET /api/movements/receive/history] Error:", e);
    return serverErrorResponse(e);
  }
}
