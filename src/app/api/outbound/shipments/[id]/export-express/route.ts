import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  conflictResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { appendRows, SHEETS } from "@/lib/google-sheets/client";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { todayBangkokIsoDate } from "@/lib/express-status-utils";
import { getShipmentDetail } from "@/lib/services/outbound/shipment.service";
import {
  mutateShipmentNote,
  mutateBillNote,
  listBillDocuments,
  parseBillNote,
} from "@/lib/services/outbound/outbound-documents";

export const maxDuration = 60;

/**
 * POST /api/outbound/shipments/[id]/export-express
 * ส่งยอดของรอบที่ปิดแล้วเข้าแท็บ "เบิกสินค้าเข้าExpress" (9 คอลัมน์เดิม)
 * ปิดวงจร: Express สร้างบิล → คลังหยิบ/แพ็ก/ขึ้นรถ → ส่งยอดกลับ Express
 *
 * กันซ้ำ 2 ชั้น: express_synced_at ทั้งของรอบและของแต่ละบิล
 * (บิล partial ที่กล่อง rollover ไปรอบถัดไปจะไม่ถูกส่งซ้ำอีก)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.OUTBOUND_IMPORT);
    } catch {
      return forbiddenResponse("เฉพาะแอดมิน/ผู้จัดการที่ส่งเข้า Express ได้");
    }

    const { id } = await params;
    const repo = getRepository();
    const detail = await getShipmentDetail(repo, decodeURIComponent(id));
    if (!detail) return notFoundResponse("ไม่พบรอบรถนี้");
    if (detail.note.shipment_status !== "CLOSED") {
      return conflictResponse("ส่งเข้า Express ได้เฉพาะรอบที่ปิดแล้ว");
    }
    if (detail.note.express_synced_at) {
      return conflictResponse(`รอบนี้ถูกส่งเข้า Express ไปแล้ว (${detail.note.express_synced_at})`);
    }

    const billDocs = await listBillDocuments(repo);
    // วันที่ตามเวลาไทย — เดิมใช้ UTC ทำให้บิลที่ส่งช่วงก่อน 07:00 น. ตกเป็นวันก่อนหน้าแล้วหลุดกรอง "วันนี้"
    const today = todayBangkokIsoDate();
    const rows: string[][] = [];
    const exportedBillIds: string[] = [];

    for (const bill of detail.bills) {
      const billDoc = billDocs.find(
        (d) => d.document_no === bill.bill_document_no || d.document_id === bill.bill_document_no
      );
      if (!billDoc) continue;
      const billNote = parseBillNote(billDoc);
      if (!billNote) continue;
      if (billNote.express_synced_at) continue; // ส่งไปแล้วในรอบก่อน (partial/rollover)

      // รวมยอดต่อ SKU ของบิลนี้ (จำนวนที่หยิบ = จำนวนที่ถูกตัดสต็อกตอนอนุมัติบิล)
      const bySku = new Map<string, { name: string; barcode: string; qty: number; location: string }>();
      for (const it of billNote.items) {
        if (it.qty_picked <= 0) continue;
        const existing = bySku.get(it.sku);
        if (existing) existing.qty += it.qty_picked;
        else
          bySku.set(it.sku, {
            name: it.product_name || it.sku,
            barcode: it.barcode || "",
            qty: it.qty_picked,
            location: it.location_id || "-",
          });
      }

      const refDoc = billNote.issue_document_no || billDoc.document_no;
      for (const [sku, info] of bySku) {
        rows.push([
          sku,
          info.location,
          refDoc,
          billNote.warehouse_id,
          today,
          info.name,
          "รอนำเข้า Express",
          String(info.qty),
          to8DigitBarcode(info.barcode, sku) || info.barcode || sku,
        ]);
      }
      exportedBillIds.push(billDoc.document_id);
    }

    if (rows.length === 0) {
      return errorResponse(
        "ไม่มีรายการใหม่ให้ส่ง (บิลทุกใบในรอบนี้ถูกส่งเข้า Express ไปแล้วในรอบก่อน หรือไม่มีบิลที่หยิบได้)",
        400
      );
    }

    await appendRows(SHEETS.EXPRESS_ISSUE, rows);

    const nowIso = new Date().toISOString();
    await Promise.all(
      exportedBillIds.map((billId) =>
        mutateBillNote(repo, billId, (n) => {
          n.express_synced_at = nowIso;
        })
      )
    );
    await mutateShipmentNote(repo, detail.doc.document_id, (n) => {
      n.express_synced_at = nowIso;
    });

    return successResponse(
      { rows: rows.length, bills: exportedBillIds.length, synced_at: nowIso },
      `ส่ง ${rows.length} รายการ (${exportedBillIds.length} บิล) เข้าแท็บ "เบิกสินค้าเข้าExpress" เรียบร้อย`
    );
  } catch (e) {
    return serverErrorResponse(e);
  }
}
