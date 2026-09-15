import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
  errorResponse,
} from "@/lib/api-response";
import {
  analyzeWorkbook,
  matchProducts,
  parseBills,
  MAX_FILE_SIZE_BYTES,
  type ParsedBill,
} from "@/lib/services/outbound/bill-import.service";
import { parseExpressPdf } from "@/lib/services/outbound/express-pdf-parser";
import {
  OutboundColumnMappingSchema,
} from "@/lib/services/outbound/outbound-schemas";
import { listBillDocuments, parseBillNote } from "@/lib/services/outbound/outbound-documents";
import { billStatusToDocumentStatus } from "@/lib/services/outbound/outbound-state-machine";
import {
  getBusyQCodes,
  parseMaxItemsPerQ,
  planBillQAssignments,
} from "@/lib/services/outbound/q-assignment.service";
import type { OutboundBillItem } from "@/types/models";

export const maxDuration = 60;

/**
 * POST /api/outbound/import — นำเข้าบิลจากไฟล์ Express (.xlsx/.csv)
 * stateless ทุกขั้นส่งไฟล์มาใหม่:
 *   mode=analyze : ไฟล์ → รายชื่อ sheet + หัวตา + mapping ที่ระบบแนะนำ
 *   mode=preview : ไฟล์ + mapping → บิลที่จะได้ + สถานะ match สินค้า + บิลซ้ำ
 *   mode=commit  : ไฟล์ + mapping + warehouse → สร้างเอกสาร BIL (IMPORTED)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    try {
      authorize(actor, PERMISSIONS.OUTBOUND_IMPORT);
    } catch (authErr: unknown) {
      if (authErr && typeof authErr === "object" && "statusCode" in authErr && (authErr as any).statusCode === 401) {
        return unauthorizedResponse((authErr as any).message);
      }
      return forbiddenResponse(authErr instanceof Error ? authErr.message : "คุณไม่มีสิทธิ์นำเข้าบิล");
    }

    const form = await req.formData();
    const mode = String(form.get("mode") ?? "analyze");
    const file = form.get("file");
    if (!(file instanceof File)) {
      return errorResponse("กรุณาแนบไฟล์ (.xlsx หรือ .csv)", 400);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return errorResponse(`ไฟล์ใหญ่เกิน 5MB (ได้ ${(file.size / 1024 / 1024).toFixed(1)}MB)`, 400);
    }
    const lowerName = file.name.toLowerCase();
    if (!/\.(xlsx|xls|csv|txt|pdf)$/.test(lowerName)) {
      return errorResponse("รองรับเฉพาะไฟล์ .xlsx .xls .csv .txt .pdf", 400);
    }
    const isPdf = lowerName.endsWith(".pdf");

    const buffer = Buffer.from(await file.arrayBuffer());

    // ---------- PDF ของ Express (ใบสั่งขาย/ใบส่งของ 1 เอกสาร = 1 บิล) ----------
    // คอลัมน์ถูกกำหนดโดย parser แล้ว — ส่ง mapping จำลองกลับไปให้ UI เดิน 3 ขั้นเหมือนเดิม
    const PDF_MAPPING = {
      bill_no: "เลขที่เอกสาร",
      sku: "รหัสสินค้า",
      qty: "จำนวน",
      product_name: "ชื่อสินค้า",
      location: "",
      customer: "ลูกค้า",
      date: "วันที่",
    };

    const parsePdfBills = async (): Promise<ParsedBill[]> => {
      const pdfBill = await parseExpressPdf(buffer);
      return [
        {
          express_bill_no: pdfBill.express_bill_no,
          customer: pdfBill.customer,
          date: pdfBill.date,
          items: pdfBill.items,
        },
      ];
    };

    if (isPdf && mode === "analyze") {
      const pdfBill = await parseExpressPdf(buffer);
      return successResponse({
        fileName: file.name,
        kind: "pdf",
        doc_no: pdfBill.doc_no,
        iv_no: pdfBill.iv_no,
        express_bill_no: pdfBill.express_bill_no,
        customer: pdfBill.customer,
        date: pdfBill.date,
        // รายการสินค้าฉบับเต็มจากเอกสาร — ให้หน้า UI แสดงข้อมูลใต้เอกสารจริง
        items: pdfBill.items.map((it, i) => ({
          no: i + 1,
          sku: it.sku,
          product_name: it.product_name ?? "",
          qty: it.qty,
        })),
        sheets: [
          {
            name: "PDF",
            totalRows: pdfBill.items.length,
            suggestedHeaderRow: 1,
            headers: ["ลำดับ", "รหัสสินค้า", "ชื่อสินค้า", "จำนวน"],
            sampleRows: pdfBill.items.slice(0, 8).map((it, i) => [
              String(i + 1),
              it.sku,
              it.product_name ?? "",
              String(it.qty),
            ]),
          },
        ],
        suggestedSheet: "PDF",
        suggestedMapping: PDF_MAPPING,
      });
    }

    // ---------- analyze (Excel/CSV) ----------
    if (mode === "analyze") {
      const result = analyzeWorkbook(buffer, file.name);
      return successResponse(result);
    }

    // ---------- ตรวจพารามิเตอร์ mapping ของ preview/commit ----------
    const sheet = String(form.get("sheet") ?? "");
    const headerRow = Number(form.get("header_row") ?? 0);
    const rawMapping = String(form.get("mapping") ?? "");
    if (!sheet || !headerRow) {
      return errorResponse("ต้องระบุ sheet และ header_row", 400);
    }
    let mappingJson: unknown;
    try {
      mappingJson = JSON.parse(rawMapping);
    } catch {
      return errorResponse("mapping ไม่ใช่ JSON ที่ถูกต้อง", 400);
    }
    const mappingParsed = OutboundColumnMappingSchema.safeParse(mappingJson);
    if (!mappingParsed.success) {
      return errorResponse(`การจับคู่คอลัมน์ไม่ครบ: ${mappingParsed.error.issues.map((i) => i.message).join(", ")}`, 400);
    }
    const mapping = mappingParsed.data;

    let parsedBills;
    try {
      parsedBills = isPdf ? await parsePdfBills() : parseBills(buffer, sheet, headerRow, mapping);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : "อ่านไฟล์ไม่สำเร็จ", 400);
    }

    const repo = getRepository();
    const products = await repo.products.findAll().catch(() => []);
    const previewBills = matchProducts(parsedBills, products);

    // ตรวจบิลซ้ำ (เลขบิล Express ต้องไม่ซ้ำกับบิลที่ยังไม่ยกเลิกในระบบ)
    const existingDocs = await listBillDocuments(repo);
    const existingByExpressNo = new Map<string, string>();
    for (const doc of existingDocs) {
      const note = parseBillNote(doc);
      if (!note || note.outbound_status === "CANCELLED") continue;
      if (note.express_bill_no) existingByExpressNo.set(note.express_bill_no.trim(), doc.document_no);
    }
    for (const b of previewBills) {
      const dup = existingByExpressNo.get(b.express_bill_no.trim());
      if (dup) b.duplicate_of = dup;
    }

    // ตัวเลือกการแบ่งกล่อง Q อัตโนมัติ (ใช้ทั้ง preview และ commit — default เปิด)
    const autoAssignQ = String(form.get("auto_assign_q") ?? "true") === "true";
    const maxItemsPerQ = parseMaxItemsPerQ(form.get("max_items_per_q"));

    // ---------- preview ----------
    if (mode === "preview") {
      if (autoAssignQ) {
        const busy = await getBusyQCodes(repo).catch(() => new Map());
        for (const b of previewBills) {
          if (b.duplicate_of) continue;
          b.q_assignments = planBillQAssignments(
            b.items.filter((it) => it.matched).map((it) => ({ sku: it.sku, qty: it.qty })),
            busy,
            maxItemsPerQ
          );
        }
      }
      return successResponse({ bills: previewBills, max_items_per_q: maxItemsPerQ });
    }

    // ---------- commit ----------
    if (mode !== "commit") {
      return errorResponse(`mode "${mode}" ไม่รองรับ`, 400);
    }

    const warehouseId = String(form.get("warehouse_id") ?? "");
    const skipUnmatched = String(form.get("skip_unmatched") ?? "false") === "true";
    if (!warehouseId) return errorResponse("ต้องเลือกคลังต้นทางที่จะหยิบสินค้า", 400);

    try {
      authorize(actor, PERMISSIONS.OUTBOUND_IMPORT, warehouseId);
    } catch (authErr: unknown) {
      if (authErr && typeof authErr === "object" && "statusCode" in authErr && (authErr as any).statusCode === 401) {
        return unauthorizedResponse((authErr as any).message);
      }
      return forbiddenResponse(authErr instanceof Error ? authErr.message : "คุณไม่มีสิทธิ์ในคลังนี้");
    }

    const duplicates = previewBills.filter((b) => b.duplicate_of);
    if (duplicates.length > 0) {
      return errorResponse(
        `บิลเลข ${duplicates.map((b) => b.express_bill_no).join(", ")} ถูกนำเข้าไปแล้ว (${duplicates.map((b) => b.duplicate_of).join(", ")})`,
        409
      );
    }

    const billsToCreate = previewBills.filter((b) => skipUnmatched || b.unmatched_count === 0);
    const skipped = previewBills.filter((b) => !skipUnmatched && b.unmatched_count > 0);
    if (billsToCreate.length === 0) {
      return errorResponse(
        `ไม่มีบิลที่นำเข้าได้ — ${skipped.length} บิลมีรหัสสินค้าที่ match ไม่ได้ (เลือก "ข้ามรายการที่ match ไม่ได้" หรือแก้ข้อมูลสินค้าก่อน)`,
        400
      );
    }

    const created: Array<{ document_no: string; express_bill_no: string; item_count: number; q_codes?: string[] }> = [];
    const nowIso = new Date().toISOString();
    const busyQs = autoAssignQ
      ? await getBusyQCodes(repo).catch(() => new Map())
      : null;

    for (const b of billsToCreate) {
      const items: OutboundBillItem[] = b.items
        .filter((it) => it.matched)
        .map((it) => ({
          sku: it.sku,
          product_id: it.product!.product_id,
          barcode: it.product!.barcode,
          product_name: it.product!.product_name,
          qty_required: it.qty,
          qty_picked: 0,
          status: "PENDING" as const,
          location_hint: it.location,
        }));

      if (items.length === 0) continue;

      // แบ่งกล่อง Q อัตโนมัติ: รายการบิลเดียวกันอยู่ด้วยกัน กล่องละไม่เกิน max รายการ
      // (รหัสที่จัดไปแล้วถูก mark busy ใน map → บิลถัดไปในไฟล์เดียวกันไม่ชนกัน)
      const qAssignments = busyQs
        ? planBillQAssignments(
            items.map((it) => ({ sku: it.sku, qty: it.qty_required })),
            busyQs,
            maxItemsPerQ
          )
        : undefined;

      const note = JSON.stringify({
        kind: "outbound_bill",
        outbound_status: "IMPORTED",
        express_bill_no: b.express_bill_no,
        customer: b.customer,
        warehouse_id: warehouseId,
        source_file: file.name,
        imported_at: nowIso,
        imported_by: actor.username,
        items,
        box_document_ids: [],
        exceptions: [],
        ...(qAssignments && qAssignments.length > 0 ? { q_assignments: qAssignments } : {}),
      });

      const doc = await repo.documents.create({
        document_type: "OUTBOUND_ORDER",
        reference_no: b.express_bill_no,
        document_date: b.date || nowIso.slice(0, 10),
        status: billStatusToDocumentStatus("IMPORTED"),
        note,
        created_by: actor.id,
        created_by_name: actor.username,
      });
      created.push({
        document_no: doc.document_no,
        express_bill_no: b.express_bill_no,
        item_count: items.length,
        q_codes: qAssignments?.map((q) => q.q_code),
      });
    }

    return successResponse(
      {
        created,
        skipped_bills: skipped.map((b) => ({
          express_bill_no: b.express_bill_no,
          unmatched: b.items.filter((it) => !it.matched).map((it) => it.sku),
        })),
      },
      `นำเข้าบิลสำเร็จ ${created.length} บิล` + (skipped.length > 0 ? ` (ข้าม ${skipped.length} บิลที่มีสินค้า match ไม่ได้)` : ""),
      201
    );
  } catch (e) {
    return serverErrorResponse(e);
  }
}
