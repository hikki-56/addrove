import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/security/actor";
import { issueStock } from "@/lib/services/stock";
import { findDocumentByIdOrNo, mutateBillNote, parseBillNote } from "./outbound-documents";
import { assertBillTransition, billStatusToDocumentStatus } from "./outbound-state-machine";

export class OutboundApproveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundApproveError";
  }
}

/**
 * อนุมัติบิลส่งของออก (ยืนยันจำนวนที่หยิบ → ตัดสต็อก) — เรียก issueStock
 * ของระบบเดิมซึ่ง: ตรวจยอดต่อตำแหน่ง → สร้างเอกสาร ISSUE (POSTED) →
 * movements ISSUE_OUT → อัปเดต StockSummary → syncDeduct แท็บคลัง
 * (ทั้งหมด atomic + idempotent)
 *
 * หมายเหตุเรื่องคำศัพท์: ห้ามใช้คำว่า "ใบเบิก/เบิก" กับโมดูลนี้ในหน้าจอ —
 * คำนั้นหมายถึงโฟลว์ TRF เดิม (เมนู "เบิกสินค้า") ผู้ใช้เห็นแค่ "อนุมัติบิล"
 *
 * idempotency key = "outbound-approve-<bill_document_id>" กดอนุมัติซ้ำไม่ตัดซ้ำ
 * สำเร็จ → บิล READY_TO_PACK (สต็อกถูกตัด การจองถูกปล่อยไปพร้อมกัน)
 * สต็อกไม่พอ ณ ตอนอนุมัติ → บิลเข้า SHORTAGE ให้แอดมินตัดสิน (ไม่ตัดติดลบ)
 */
export async function approveOutboundPick(
  repo: IStockRepository,
  idOrNo: string,
  actor: Actor,
  options?: { reason?: string }
): Promise<{ issue_document_no: string }> {
  const doc = await findDocumentByIdOrNo(repo, idOrNo);
  if (!doc) throw new OutboundApproveError("ไม่พบบิลนี้");
  const note = parseBillNote(doc);
  if (!note) throw new OutboundApproveError("ข้อมูลบิลไม่ถูกต้อง");
  if (note.outbound_status !== "PICKED_WAITING_APPROVAL") {
    throw new OutboundApproveError(
      `อนุมัติได้เฉพาะบิลสถานะ "รออนุมัติบิล" (ปัจจุบัน: ${note.outbound_status})`
    );
  }
  if (note.issue_document_id) {
    throw new OutboundApproveError(`บิลนี้ถูกอนุมัติและตัดสต็อกไปแล้ว (${note.issue_document_no})`);
  }

  // รวมรายการที่หยิบได้จริงเป็น lines ของ issueStock (รวมตำแหน่งเดียวกัน)
  // location_wh = คลังเจ้าของตำแหน่งที่หยิบ (รองรับหยิบข้ามคลัง/สำนักงานใหญ่)
  const lineMap = new Map<string, { warehouse_id: string; product_id: string; location_id: string; qty: number }>();
  for (const item of note.items) {
    if (item.qty_picked <= 0 || !item.product_id) continue;
    const locationId = item.location_id || "";
    if (!locationId) {
      throw new OutboundApproveError(
        `รายการ ${item.sku} ไม่มีตำแหน่งหยิบ (location_id) — ให้หยิบใหม่หรือแก้ไขก่อนอนุมัติ`
      );
    }
    const wh = item.location_wh || note.warehouse_id;
    const key = `${wh}|${item.product_id}|${locationId}`;
    const existing = lineMap.get(key);
    if (existing) existing.qty += item.qty_picked;
    else lineMap.set(key, { warehouse_id: wh, product_id: item.product_id, location_id: locationId, qty: item.qty_picked });
  }
  if (lineMap.size === 0) {
    throw new OutboundApproveError("บิลนี้ไม่มีรายการที่หยิบได้จริง — ใช้การตัดสินของไม่ครบก่อน");
  }

  // issueStock ตัดได้คลังละบิล — จัดกลุ่มตามคลังเจ้าของตำแหน่ง
  // คลังของบิลเองได้ idempotency key เดิม (compat กับที่เคยอนุมัติมาก่อน)
  const byWarehouse = new Map<string, Array<{ product_id: string; location_id: string; qty: number }>>();
  for (const line of lineMap.values()) {
    const arr = byWarehouse.get(line.warehouse_id) ?? [];
    arr.push({ product_id: line.product_id, location_id: line.location_id, qty: line.qty });
    byWarehouse.set(line.warehouse_id, arr);
  }
  const warehousesOrdered = [
    note.warehouse_id,
    ...Array.from(byWarehouse.keys()).filter((w) => w !== note.warehouse_id).sort(),
  ].filter((w) => byWarehouse.has(w));

  try {
    const issueDocs: Array<{ document_id: string; document_no: string }> = [];
    for (const wh of warehousesOrdered) {
      issueDocs.push(
        await issueStock(
          { repo },
          {
            warehouse_id: wh,
            reference_no: doc.document_no,
            document_date: new Date().toISOString().slice(0, 10),
            note: `บิลส่งของออก ${note.express_bill_no}${note.customer ? ` (${note.customer})` : ""}${options?.reason ? ` — ${options.reason}` : ""}`.slice(0, 500),
            idempotency_key:
              wh === note.warehouse_id
                ? `outbound-approve-${doc.document_id}`
                : `outbound-approve-${doc.document_id}-${wh}`,
            lines: byWarehouse.get(wh)!,
            user_id: actor.id,
            role: actor.role,
            correlation_id: actor.correlationId,
          }
        )
      );
    }
    const issueDoc = issueDocs[0];

    const result = await mutateBillNote(repo, doc.document_id, (n) => {
      assertBillTransition(n.outbound_status, "READY_TO_PACK");
      n.outbound_status = "READY_TO_PACK";
      n.issue_document_id = issueDoc.document_id;
      n.issue_document_no = issueDocs.map((d) => d.document_no).join(", ");
      n.approved_by = actor.username;
      n.approved_at = new Date().toISOString();
    }, { alsoStatus: billStatusToDocumentStatus("READY_TO_PACK") });

    if (!result) throw new OutboundApproveError("บันทึกสถานะบิลไม่สำเร็จ (สต็อกถูกตัดแล้ว — ตรวจสอบบิลอีกครั้ง)");
    return { issue_document_no: issueDocs.map((d) => d.document_no).join(", ") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // สต็อกไม่พอ ณ จุดอนุมัติ → บล็อก + บิลเข้า SHORTAGE ให้แอดมินตัดสิน
    if (/ไม่พอ|ไม่เพียงพอ|Insufficient/i.test(message)) {
      await mutateBillNote(repo, doc.document_id, (n) => {
        if (n.outbound_status === "PICKED_WAITING_APPROVAL") {
          assertBillTransition(n.outbound_status, "SHORTAGE");
          n.outbound_status = "SHORTAGE";
          n.exceptions.push({
            type: "OTHER",
            sku: "*",
            note: `ตรวจพบสต็อกไม่พอ ณ ตอนอนุมัติ: ${message}`,
            reported_by: actor.id,
            reported_by_name: actor.username,
            reported_at: new Date().toISOString(),
          });
        }
      }).catch(() => {});
      await repo.documents.updateStatus(doc.document_id, billStatusToDocumentStatus("SHORTAGE")).catch(() => {});
      throw new OutboundApproveError(`สต็อกไม่พอ ณ ตอนอนุมัติ — บิลเข้าสถานะของไม่ครบ (${message})`);
    }
    throw err;
  }
}

/** ไม่อนุมัติ — ส่งกลับไปหยิบใหม่ (คงการจองสต็อก) หรือยกเลิกบิล */
export async function rejectOutboundPick(
  repo: IStockRepository,
  idOrNo: string,
  outcome: "REPICK" | "CANCEL",
  actor: Actor,
  reason?: string
): Promise<{ bill_status: string }> {
  const doc = await findDocumentByIdOrNo(repo, idOrNo);
  if (!doc) throw new OutboundApproveError("ไม่พบบิลนี้");
  const note = parseBillNote(doc);
  if (!note) throw new OutboundApproveError("ข้อมูลบิลไม่ถูกต้อง");
  if (note.outbound_status !== "PICKED_WAITING_APPROVAL") {
    throw new OutboundApproveError(`บิลไม่ได้อยู่ในสถานะรออนุมัติ (ปัจจุบัน: ${note.outbound_status})`);
  }

  if (outcome === "CANCEL") {
    await mutateBillNote(repo, doc.document_id, (n) => {
      assertBillTransition(n.outbound_status, "CANCELLED");
      n.outbound_status = "CANCELLED";
      n.cancel_reason = reason || "ไม่อนุมัติบิล";
    }, { alsoStatus: "CANCELLED" });
    return { bill_status: "CANCELLED" };
  }

  await mutateBillNote(repo, doc.document_id, (n) => {
    assertBillTransition(n.outbound_status, "PICKING");
    n.outbound_status = "PICKING";
    // รีเซ็ตการหยิบเพื่อเริ่มใหม่
    for (const item of n.items) {
      item.qty_picked = 0;
      item.status = "PENDING";
    }
    n.exceptions.push({
      type: "OTHER",
      sku: "*",
      note: `ไม่อนุมัติบิล — ให้หยิบใหม่${reason ? `: ${reason}` : ""}`,
      reported_by: actor.id,
      reported_by_name: actor.username,
      reported_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
      resolved_by: actor.username,
      resolution: "CONTINUE",
    });
  }, { alsoStatus: billStatusToDocumentStatus("PICKING") });
  return { bill_status: "PICKING" };
}
