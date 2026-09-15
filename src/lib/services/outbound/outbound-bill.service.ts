import type { Document } from "@/types/models";
import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/security/actor";
import {
  listBillDocuments,
  listBoxDocuments,
  parseBillNote,
  parseBoxNote,
  mutateBillNote,
  findDocumentByIdOrNo,
} from "./outbound-documents";
import {
  assertBillTransition,
  billStatusToDocumentStatus,
  BILL_STATUS_LABELS_TH,
  isBillReserving,
} from "./outbound-state-machine";
import { getAvailability, type AvailabilityRow } from "./stock-reservation.service";

export interface BillSummary {
  document_id: string;
  document_no: string;
  express_bill_no: string;
  customer?: string;
  warehouse_id: string;
  outbound_status: keyof typeof BILL_STATUS_LABELS_TH;
  status_label: string;
  item_count: number;
  total_qty_required: number;
  total_qty_picked: number;
  problem_count: number;
  box_count: number;
  created_at: string;
  pick_assigned_to_name?: string;
}

export async function listBills(repo: IStockRepository): Promise<{
  bills: BillSummary[];
  counts: Record<string, number>;
}> {
  const [billDocs, boxDocs] = await Promise.all([
    listBillDocuments(repo),
    listBoxDocuments(repo),
  ]);

  const boxCountByBill = new Map<string, number>();
  for (const b of boxDocs) {
    const note = parseBoxNote(b);
    if (!note || note.box_status === "CANCELLED") continue;
    boxCountByBill.set(
      note.bill_document_id,
      (boxCountByBill.get(note.bill_document_id) || 0) + 1
    );
  }

  const bills: BillSummary[] = [];
  const counts: Record<string, number> = {};

  for (const doc of billDocs) {
    const note = parseBillNote(doc);
    if (!note) continue;
    const status = note.outbound_status;
    counts[status] = (counts[status] || 0) + 1;
    bills.push({
      document_id: doc.document_id,
      document_no: doc.document_no,
      express_bill_no: note.express_bill_no || doc.reference_no,
      customer: note.customer,
      warehouse_id: note.warehouse_id,
      outbound_status: status,
      status_label: BILL_STATUS_LABELS_TH[status],
      item_count: note.items.length,
      total_qty_required: note.items.reduce((s, it) => s + it.qty_required, 0),
      total_qty_picked: note.items.reduce((s, it) => s + it.qty_picked, 0),
      problem_count: note.items.filter((it) => it.status === "PROBLEM").length,
      box_count: boxCountByBill.get(doc.document_id) || 0,
      created_at: doc.created_at,
      pick_assigned_to_name: note.pick_assigned_to_name,
    });
  }

  bills.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { bills, counts };
}

export interface BillDetail {
  doc: Document;
  note: import("@/types/models").OutboundBillNote;
  boxes: Array<{
    document_id: string;
    document_no: string;
    box_no: number;
    box_status: import("@/types/models").OutboundBoxStatus;
    item_count: number;
    total_qty: number;
    shipment_no?: string;
    sticker_printed: boolean;
  }>;
  availability: AvailabilityRow[];
  reserving: boolean;
}

export async function getBillDetail(
  repo: IStockRepository,
  idOrNo: string
): Promise<BillDetail | null> {
  const doc = await findDocumentByIdOrNo(repo, idOrNo);
  if (!doc) return null;
  const note = parseBillNote(doc);
  if (!note) return null;

  const boxDocs = await listBoxDocuments(repo);
  const boxes = boxDocs
    .filter((b) => {
      const bn = parseBoxNote(b);
      return bn && bn.bill_document_id === doc.document_id;
    })
    .map((b) => {
      const bn = parseBoxNote(b)!;
      return {
        document_id: b.document_id,
        document_no: b.document_no,
        box_no: bn.box_no,
        box_status: bn.box_status,
        item_count: bn.items.length,
        total_qty: bn.items.reduce((s, it) => s + it.qty, 0),
        shipment_no: bn.shipment_no,
        sticker_printed: Boolean(bn.sticker_printed_at),
      };
    })
    .sort((a, b) => a.box_no - b.box_no);

  const availability =
    note.warehouse_id && (note.outbound_status === "IMPORTED" || note.outbound_status === "READY_TO_PICK")
      ? await getAvailability(
          repo,
          note.warehouse_id,
          note.items.map((it) => ({ sku: it.sku, product_id: it.product_id, qty: it.qty_required })),
          { allWarehouses: true }
        ).catch(() => [])
      : [];

  return { doc, note, boxes, availability, reserving: isBillReserving(note.outbound_status) };
}

// ---------- actions ----------

const CANCELABLE_PRE_STOCK = new Set([
  "IMPORTED",
  "READY_TO_PICK",
  "PICKING",
  "SHORTAGE",
  "PICKED_WAITING_APPROVAL",
]);

export async function activateBill(
  repo: IStockRepository,
  idOrNo: string,
  actor: Actor
): Promise<void> {
  const result = await mutateBillNote(repo, idOrNo, (note) => {
    assertBillTransition(note.outbound_status, "READY_TO_PICK", note.held_from);
    note.outbound_status = "READY_TO_PICK";
  }, { alsoStatus: billStatusToDocumentStatus("READY_TO_PICK") });
  if (!result) throw new Error("ไม่พบบิลนี้ หรือข้อมูลบิลไม่ถูกต้อง");
  void actor;
}

export async function holdBill(
  repo: IStockRepository,
  idOrNo: string,
  actor: Actor,
  reason?: string
): Promise<void> {
  const result = await mutateBillNote(repo, idOrNo, (note) => {
    assertBillTransition(note.outbound_status, "HOLD", note.held_from);
    note.held_from = note.outbound_status;
    note.hold_reason = reason || "";
    note.outbound_status = "HOLD";
  }, { alsoStatus: billStatusToDocumentStatus("HOLD") });
  if (!result) throw new Error("ไม่พบบิลนี้ หรือข้อมูลบิลไม่ถูกต้อง");
  void actor;
}

export async function resumeBill(
  repo: IStockRepository,
  idOrNo: string,
  actor: Actor
): Promise<void> {
  // อ่าน held_from ก่อนเพื่อคำนวณ DocumentStatus ปลายทาง
  const current = await findDocumentByIdOrNo(repo, idOrNo);
  if (!current) throw new Error("ไม่พบบิลนี้");
  const currentNote = parseBillNote(current);
  if (!currentNote) throw new Error("ข้อมูลบิลไม่ถูกต้อง");
  if (currentNote.outbound_status !== "HOLD" || !currentNote.held_from) {
    throw new Error("บิลนี้ไม่ได้อยู่ในสถานะพักงาน");
  }
  const target = currentNote.held_from;
  const result = await mutateBillNote(repo, current.document_id, (note) => {
    assertBillTransition(note.outbound_status, target, note.held_from);
    note.outbound_status = target;
    note.held_from = undefined;
    note.hold_reason = undefined;
  }, { alsoStatus: billStatusToDocumentStatus(target) });
  if (!result) throw new Error("ไม่พบบิลนี้ หรือข้อมูลบิลไม่ถูกต้อง");
  void actor;
}

export async function cancelBill(
  repo: IStockRepository,
  idOrNo: string,
  actor: Actor,
  reason?: string
): Promise<void> {
  const result = await mutateBillNote(repo, idOrNo, (note) => {
    const canCancel =
      CANCELABLE_PRE_STOCK.has(note.outbound_status) ||
      (note.outbound_status === "HOLD" && note.held_from && CANCELABLE_PRE_STOCK.has(note.held_from));
    if (!canCancel) {
      throw new Error(
        `บิลสถานะ ${BILL_STATUS_LABELS_TH[note.outbound_status]} หักสต็อกไปแล้วหรืออยู่ระหว่างขนส่ง — ยกเลิกไม่ได้ (ใช้การรับคืน/REVERSAL แทน)`
      );
    }
    assertBillTransition(note.outbound_status, "CANCELLED", note.held_from);
    note.cancel_reason = reason || "";
    note.outbound_status = "CANCELLED";
    // การจองสต็อกถูกปล่อยอัตโนมัติเพราะสถานะออกจากชุด RESERVING
  }, { alsoStatus: "CANCELLED" });
  if (!result) throw new Error("ไม่พบบิลนี้ หรือข้อมูลบิลไม่ถูกต้อง");
  void actor;
}

export interface ResolveShortageInput {
  outcome: "CONTINUE" | "REDUCE_QTY" | "CANCEL";
  reason?: string;
}

export async function resolveShortage(
  repo: IStockRepository,
  idOrNo: string,
  input: ResolveShortageInput,
  actor: Actor
): Promise<{ new_status: string; message: string }> {
  const current = await findDocumentByIdOrNo(repo, idOrNo);
  if (!current) throw new Error("ไม่พบบิลนี้");
  const currentNote = parseBillNote(current);
  if (!currentNote) throw new Error("ข้อมูลบิลไม่ถูกต้อง");

  if (input.outcome === "CANCEL") {
    await cancelBill(repo, current.document_id, actor, input.reason);
    return { new_status: "CANCELLED", message: "ยกเลิกบิลและปล่อยการจองสต็อกแล้ว" };
  }

  let message = "";
  const result = await mutateBillNote(repo, current.document_id, (note) => {
    if (note.outbound_status !== "SHORTAGE" && note.outbound_status !== "HOLD") {
      throw new Error(`ตัดสินของไม่ครบได้เฉพาะบิลสถานะของไม่ครบ/พักงาน (ปัจจุบัน: ${BILL_STATUS_LABELS_TH[note.outbound_status]})`);
    }

    // HOLD → resume กลับสู่สถานะที่ถูกพักไว้ก่อน แล้วดำเนินการต่อในฐานะสถานะนั้น
    if (note.outbound_status === "HOLD") {
      const resumeTo = note.held_from;
      if (!resumeTo || resumeTo === "HOLD" || resumeTo === "CANCELLED" || resumeTo === "SHIPPED") {
        throw new Error("บิลนี้ถูกพักไว้จากสถานะที่ตัดสินของไม่ครบไม่ได้");
      }
      note.outbound_status = resumeTo;
      note.held_from = undefined;
      note.hold_reason = undefined;
    }
    if (note.outbound_status !== "SHORTAGE" && note.outbound_status !== "PICKING" && note.outbound_status !== "PICKED_WAITING_APPROVAL") {
      throw new Error(`บิลสถานะ ${BILL_STATUS_LABELS_TH[note.outbound_status]} ไม่อยู่ในขั้นตอนหยิบ — ตัดสินของไม่ครบไม่ได้`);
    }

    if (input.outcome === "REDUCE_QTY") {
      // ลด qty_required ของรายการ PROBLEM ให้เท่ากับที่หยิบได้จริง
      for (const item of note.items) {
        if (item.status === "PROBLEM" && item.qty_picked < item.qty_required) {
          item.qty_required = item.qty_picked;
        }
      }
      for (const ex of note.exceptions) {
        if (!ex.resolved_at) {
          ex.resolved_at = new Date().toISOString();
          ex.resolved_by = actor.username;
          ex.resolution = "REDUCE_QTY";
        }
      }
    }

    const hasRemaining = note.items.some(
      (it) => it.qty_picked < it.qty_required && it.qty_required > 0 && it.status !== "PROBLEM"
    );

    if (!hasRemaining) {
      assertBillTransition(note.outbound_status, "PICKED_WAITING_APPROVAL");
      note.outbound_status = "PICKED_WAITING_APPROVAL";
      message = "ปรับจำนวนแล้ว — บิลพร้อมให้แอดมินอนุมัติ";
    } else {
      if (note.outbound_status !== "PICKING") {
        assertBillTransition(note.outbound_status, "PICKING");
      }
      note.outbound_status = "PICKING";
      message = "กลับไปหยิบต่อได้แล้ว";
    }
  }, { alsoStatus: "PROCESSING" });

  if (!result) throw new Error("ไม่พบบิลนี้ หรือข้อมูลบิลไม่ถูกต้อง");
  // ปรับ Document status ให้ตรงสถานะใหม่
  await repo.documents.updateStatus(
    result.doc.document_id,
    billStatusToDocumentStatus(result.note.outbound_status)
  );
  return { new_status: result.note.outbound_status, message };
}
