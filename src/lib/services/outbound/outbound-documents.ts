import type { Document } from "@/types/models";
import type {
  OutboundBillNote,
  OutboundBoxNote,
  ShipmentNote,
  WorkOrderQBox,
} from "@/types/models";
import type { IStockRepository } from "@/lib/repositories/interfaces";
import { withKeyedLock } from "@/lib/keyed-lock";

/**
 * Helper จัดการเอกสาร outbound (บิล/กล่อง/รอบรถ) ที่เก็บข้อมูลละเอียด
 * ใน note (JSON) ของแท็บ Documents — บิล/กล่อง/รอบละ 1 record
 *
 * การแก้ note ทุกครั้งต้องผ่าน mutateXxxNote เพื่ออ่าน-แก้-เขียนภายใต์
 * keyed lock เดียวกับที่ Documents repository ใช้ (sheet-doc-row:<id>)
 * ไม่ให้สอง request เขียน note ทับกัน
 */

export const OUTBOUND_BILL_DOC_TYPE = "OUTBOUND_ORDER" as const;
export const OUTBOUND_BOX_DOC_TYPE = "OUTBOUND_BOX" as const;
export const SHIPMENT_DOC_TYPE = "SHIPMENT" as const;
export const WORK_ORDER_DOC_TYPE = "WORK_ORDER" as const;

function parseQBoxes(raw: unknown): WorkOrderQBox[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((b) => {
    const box = b as Partial<WorkOrderQBox>;
    return {
      q_code: String(box.q_code ?? ""),
      status: box.status ?? "PENDING",
      items: Array.isArray(box.items)
        ? box.items.map((it) => ({
            sku: String(it.sku ?? ""),
            product_id: it.product_id,
            barcode: it.barcode,
            product_name: it.product_name,
            qty_required: Number(it.qty_required) || 0,
            qty_picked: Number(it.qty_picked) || 0,
            status: it.status ?? "PENDING",
            location_id: it.location_id,
          }))
        : [],
      picked_by: box.picked_by,
      picked_by_name: box.picked_by_name,
      started_at: box.started_at,
      completed_at: box.completed_at,
    };
  });
}

function docRowLockKey(id: string): string {
  // ต้องตรงกับ documentRowLockKey ใน sheets/document.repository.ts
  return `sheet-doc-row:${String(id || "").trim().toLowerCase()}`;
}

export function parseBillNote(doc: Document): OutboundBillNote | null {
  if (!doc.note || !doc.note.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(doc.note) as Partial<OutboundBillNote>;
    if (parsed.kind !== "outbound_bill" || !Array.isArray(parsed.items)) return null;
    return {
      kind: "outbound_bill",
      outbound_status: parsed.outbound_status ?? "IMPORTED",
      express_bill_no: parsed.express_bill_no ?? doc.reference_no ?? "",
      customer: parsed.customer,
      warehouse_id: parsed.warehouse_id ?? "",
      source_file: parsed.source_file,
      imported_at: parsed.imported_at,
      imported_by: parsed.imported_by,
      items: parsed.items.map((it) => ({
        sku: String(it.sku ?? ""),
        product_id: it.product_id,
        barcode: it.barcode,
        product_name: it.product_name,
        qty_required: Number(it.qty_required) || 0,
        qty_picked: Number(it.qty_picked) || 0,
        status: it.status ?? "PENDING",
        location_hint: it.location_hint,
        location_id: it.location_id,
      })),
      pick_assigned_to: parsed.pick_assigned_to,
      pick_assigned_to_name: parsed.pick_assigned_to_name,
      pick_started_at: parsed.pick_started_at,
      pick_completed_at: parsed.pick_completed_at,
      issue_document_id: parsed.issue_document_id,
      issue_document_no: parsed.issue_document_no,
      approved_by: parsed.approved_by,
      approved_at: parsed.approved_at,
      packed_at: parsed.packed_at,
      box_document_ids: Array.isArray(parsed.box_document_ids) ? parsed.box_document_ids : [],
      exceptions: Array.isArray(parsed.exceptions) ? parsed.exceptions : [],
      held_from: parsed.held_from,
      hold_reason: parsed.hold_reason,
      cancel_reason: parsed.cancel_reason,
      express_synced_at: parsed.express_synced_at,
      source: parsed.source,
      q_boxes: parseQBoxes(parsed.q_boxes),
      q_assignments: Array.isArray(parsed.q_assignments)
        ? parsed.q_assignments.map((a) => ({
            q_code: String(a.q_code ?? ""),
            items: Array.isArray(a.items)
              ? a.items.map((it) => ({ sku: String(it.sku ?? ""), qty: Number(it.qty) || 0 }))
              : [],
            status: a.status,
            picked_by: a.picked_by,
            picked_by_name: a.picked_by_name,
            started_at: a.started_at,
            completed_at: a.completed_at,
          }))
        : undefined,
      sent_by: parsed.sent_by,
      sent_at: parsed.sent_at,
    };
  } catch {
    return null;
  }
}

export function parseBoxNote(doc: Document): OutboundBoxNote | null {
  if (!doc.note || !doc.note.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(doc.note) as Partial<OutboundBoxNote>;
    if (parsed.kind !== "outbound_box") return null;
    return {
      kind: "outbound_box",
      box_status: parsed.box_status ?? "OPEN",
      bill_document_id: parsed.bill_document_id ?? "",
      bill_document_no: parsed.bill_document_no ?? "",
      box_no: Number(parsed.box_no) || 0,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      sticker_printed_at: parsed.sticker_printed_at,
      shipment_id: parsed.shipment_id,
      shipment_no: parsed.shipment_no,
      loaded_at: parsed.loaded_at,
      loaded_by: parsed.loaded_by,
      rollover_count: Number(parsed.rollover_count) || 0,
      cancel_reason: parsed.cancel_reason,
      cancelled_by: parsed.cancelled_by,
      cancelled_at: parsed.cancelled_at,
    };
  } catch {
    return null;
  }
}

export function parseShipmentNote(doc: Document): ShipmentNote | null {
  if (!doc.note || !doc.note.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(doc.note) as Partial<ShipmentNote>;
    if (parsed.kind !== "shipment") return null;
    return {
      kind: "shipment",
      shipment_status: parsed.shipment_status ?? "OPEN",
      truck_plate: parsed.truck_plate ?? "",
      destination: parsed.destination,
      bill_document_ids: Array.isArray(parsed.bill_document_ids) ? parsed.bill_document_ids : [],
      expected_box_ids: Array.isArray(parsed.expected_box_ids) ? parsed.expected_box_ids : [],
      loaded_box_ids: Array.isArray(parsed.loaded_box_ids) ? parsed.loaded_box_ids : [],
      created_by: parsed.created_by,
      created_by_name: parsed.created_by_name,
      created_at: parsed.created_at,
      closed_at: parsed.closed_at,
      closed_by: parsed.closed_by,
      closed_by_name: parsed.closed_by_name,
      skip_confirmations: Array.isArray(parsed.skip_confirmations) ? parsed.skip_confirmations : [],
      cancel_reason: parsed.cancel_reason,
      express_synced_at: parsed.express_synced_at,
    };
  } catch {
    return null;
  }
}

async function listDocumentsByType(
  repo: IStockRepository,
  document_type: string
): Promise<Document[]> {
  const res = await repo.documents.findAll({ page: 1, limit: 9999, document_type } as never);
  return res.data.filter((d) => d.document_type === document_type);
}

export async function listBillDocuments(repo: IStockRepository): Promise<Document[]> {
  // รวมใบงานกล่อง Q (WORK_ORDER) เข้ากับบิล Express — ทั้งคู่ใช้โครง note
  // outbound_bill เหมือนกัน ขั้นแพ็ก/ขึ้นรถ/หน้าสรุปจึงเห็นเป็นคิวเดียวกัน
  const [bills, workOrders] = await Promise.all([
    listDocumentsByType(repo, OUTBOUND_BILL_DOC_TYPE),
    listDocumentsByType(repo, WORK_ORDER_DOC_TYPE),
  ]);
  return [...bills, ...workOrders];
}

export async function listWorkOrderDocuments(repo: IStockRepository): Promise<Document[]> {
  return listDocumentsByType(repo, WORK_ORDER_DOC_TYPE);
}

export async function listBoxDocuments(repo: IStockRepository): Promise<Document[]> {
  return listDocumentsByType(repo, OUTBOUND_BOX_DOC_TYPE);
}

export async function listShipmentDocuments(repo: IStockRepository): Promise<Document[]> {
  return listDocumentsByType(repo, SHIPMENT_DOC_TYPE);
}

export async function findDocumentByIdOrNo(
  repo: IStockRepository,
  idOrNo: string
): Promise<Document | null> {
  const key = String(idOrNo ?? "").trim();
  if (!key) return null;
  return (
    (await repo.documents.findById(key, { forceFresh: true })) ??
    (await repo.documents.findByNo(key, { forceFresh: true }))
  );
}

/**
 * อ่าน-แก้-เขียน note ของบิลภายใต้ lock (กัน note ถูกเขียนทับข้าม request)
 * คืน note ใหม่หลังแก้ หรือ null ถ้าไม่พบเอกสาร
 */
export async function mutateBillNote(
  repo: IStockRepository,
  documentIdOrNo: string,
  mutator: (note: OutboundBillNote, doc: Document) => void | Promise<void>,
  options?: { alsoStatus?: Document["status"] }
): Promise<{ doc: Document; note: OutboundBillNote } | null> {
  return withKeyedLock(docRowLockKey(documentIdOrNo), async () => {
    const doc =
      (await repo.documents.findById(documentIdOrNo, { forceFresh: true })) ??
      (await repo.documents.findByNo(documentIdOrNo, { forceFresh: true }));
    if (!doc) return null;
    const note = parseBillNote(doc);
    if (!note) return null;
    await mutator(note, doc);
    if (options?.alsoStatus) {
      if (repo.documents.updateDoc) {
        await repo.documents.updateDoc(doc.document_id, {
          status: options.alsoStatus,
          note: JSON.stringify(note),
        });
      } else {
        await repo.documents.updateNote(doc.document_id, JSON.stringify(note));
        await repo.documents.updateStatus(doc.document_id, options.alsoStatus);
      }
    } else {
      await repo.documents.updateNote(doc.document_id, JSON.stringify(note));
    }
    const updated = await repo.documents.findById(doc.document_id, { forceFresh: true });
    return updated ? { doc: updated, note: parseBillNote(updated) ?? note } : { doc, note };
  });
}

export async function mutateBoxNote(
  repo: IStockRepository,
  documentIdOrNo: string,
  mutator: (note: OutboundBoxNote, doc: Document) => void | Promise<void>
): Promise<{ doc: Document; note: OutboundBoxNote } | null> {
  return withKeyedLock(docRowLockKey(documentIdOrNo), async () => {
    const doc =
      (await repo.documents.findById(documentIdOrNo, { forceFresh: true })) ??
      (await repo.documents.findByNo(documentIdOrNo, { forceFresh: true }));
    if (!doc) return null;
    const note = parseBoxNote(doc);
    if (!note) return null;
    await mutator(note, doc);
    await repo.documents.updateNote(doc.document_id, JSON.stringify(note));
    const updated = await repo.documents.findById(doc.document_id, { forceFresh: true });
    return updated ? { doc: updated, note: parseBoxNote(updated) ?? note } : { doc, note };
  });
}

export async function mutateShipmentNote(
  repo: IStockRepository,
  documentIdOrNo: string,
  mutator: (note: ShipmentNote, doc: Document) => void | Promise<void>,
  options?: { alsoStatus?: Document["status"] }
): Promise<{ doc: Document; note: ShipmentNote } | null> {
  return withKeyedLock(docRowLockKey(documentIdOrNo), async () => {
    const doc =
      (await repo.documents.findById(documentIdOrNo, { forceFresh: true })) ??
      (await repo.documents.findByNo(documentIdOrNo, { forceFresh: true }));
    if (!doc) return null;
    const note = parseShipmentNote(doc);
    if (!note) return null;
    await mutator(note, doc);
    if (options?.alsoStatus) {
      if (repo.documents.updateDoc) {
        await repo.documents.updateDoc(doc.document_id, {
          status: options.alsoStatus,
          note: JSON.stringify(note),
        });
      } else {
        await repo.documents.updateNote(doc.document_id, JSON.stringify(note));
        await repo.documents.updateStatus(doc.document_id, options.alsoStatus);
      }
    } else {
      await repo.documents.updateNote(doc.document_id, JSON.stringify(note));
    }
    const updated = await repo.documents.findById(doc.document_id, { forceFresh: true });
    return updated ? { doc: updated, note: parseShipmentNote(updated) ?? note } : { doc, note };
  });
}
