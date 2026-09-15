import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/security/actor";
import type {
  Document,
  OutboundBillNote,
  OutboundExceptionType,
  OutboundItemStatus,
  WorkOrderQBox,
  WorkOrderQBoxStatus,
  WorkOrderQItem,
  StockSummary,
} from "@/types/models";
import { issueStock } from "@/lib/services/stock";
import { receiveStock } from "@/lib/services/stock";
import {
  findDocumentByIdOrNo,
  listBillDocuments,
  listWorkOrderDocuments,
  mutateBillNote,
  parseBillNote,
} from "./outbound-documents";
import {
  assertBillTransition,
  billStatusToDocumentStatus,
} from "./outbound-state-machine";
import {
  assertAvailableForPick,
  suggestPickLocationAll,
} from "./stock-reservation.service";
import { findBillItemByScan } from "./picking.service";
import { getBusyQCodes } from "./q-assignment.service";

// ============================================================
// ใบงานกล่อง Q (WORK_ORDER / เลขที่ TV-...)
// Admin กำหนดล่วงหน้าว่าแต่ละกล่อง Q มีสินค้าอะไรจำนวนเท่าไร
// พนักงานทำแค่: สแกนกล่อง Q → ดูรายการ → หยิบ → สแกนสินค้ายืนยันทีละชิ้น
//
// หลักการ: สต็อกถูกตัดตั้งแต่ Admin กด "ส่งใบงาน" (issueStock idempotent)
// เมื่อทุกกล่องหยิบเสร็จ → READY_TO_PACK เข้าคิวแพ็กของเดิมทันที
// ============================================================

export class WorkOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkOrderError";
  }
}

const Q_CODE_PATTERN = /^Q\d{1,3}$/;

function normalizeQCode(raw: string): string {
  return String(raw ?? "").trim().toUpperCase();
}

function cleanSku(v: string): string {
  return v.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_#]/g, "");
}

function isWorkOrderNote(note: OutboundBillNote | null): note is OutboundBillNote {
  return Boolean(note && note.source === "WORK_ORDER" && Array.isArray(note.q_boxes));
}

export interface WorkOrderItemInput {
  sku: string;
  product_id?: string;
  barcode?: string;
  product_name?: string;
  qty: number;
}

export interface WorkOrderQBoxInput {
  q_code: string;
  items: WorkOrderItemInput[];
}

export interface CreateWorkOrderInput {
  warehouse_id: string;
  title?: string;
  q_boxes: WorkOrderQBoxInput[];
}

/** รวมรายการทุกกล่อง Q เป็น items ยอดรวม (unique ต่อ sku) ให้ขั้นแพ็ก/ขึ้นรถใช้ของเดิม */
function aggregateItems(qBoxes: WorkOrderQBoxInput[]): WorkOrderQItem[] {
  const map = new Map<string, WorkOrderQItem>();
  for (const box of qBoxes) {
    for (const it of box.items) {
      const key = cleanSku(it.sku);
      const existing = map.get(key);
      if (existing) {
        existing.qty_required += it.qty;
      } else {
        map.set(key, {
          sku: it.sku,
          product_id: it.product_id,
          barcode: it.barcode,
          product_name: it.product_name,
          qty_required: it.qty,
          qty_picked: 0,
          status: "PENDING",
        });
      }
    }
  }
  return Array.from(map.values());
}

async function findQConflicts(
  repo: IStockRepository,
  qCodes: string[],
  excludeDocumentId?: string
): Promise<Map<string, string>> {
  const conflicts = new Map<string, string>();
  if (qCodes.length === 0) return conflicts;
  // ตรวจรหัส Q ที่ติดงานทั้งระบบ — ทั้งใบงาน Q และบิล Express ที่ถูกแบ่ง Q ไว้
  const busy = await getBusyQCodes(repo);
  for (const code of qCodes) {
    const info = busy.get(code);
    if (info && info.document_id !== excludeDocumentId) {
      conflicts.set(code, info.document_no);
    }
  }
  return conflicts;
}

/** หน้าสร้าง: ตรวจว่ากล่อง Q ว่างพอจะใช้ในใบงานใหม่ไหม (สำหรับ UI เตือนแบบ real-time) */
export async function checkQAvailability(
  repo: IStockRepository,
  qCodes: string[],
  excludeDocumentId?: string
): Promise<{ available: string[]; busy: Array<{ q_code: string; document_no: string }> }> {
  const normalized = qCodes.map(normalizeQCode).filter(Boolean);
  const conflicts = await findQConflicts(repo, normalized, excludeDocumentId);
  return {
    available: normalized.filter((c) => !conflicts.has(c)),
    busy: Array.from(conflicts.entries()).map(([q_code, document_no]) => ({ q_code, document_no })),
  };
}

export async function createWorkOrder(
  repo: IStockRepository,
  input: CreateWorkOrderInput,
  actor: Actor
): Promise<{ document_id: string; document_no: string }> {
  if (!input.warehouse_id) throw new WorkOrderError("กรุณาเลือกโกดัง");
  if (!Array.isArray(input.q_boxes) || input.q_boxes.length === 0) {
    throw new WorkOrderError("กรุณาเพิ่มกล่อง Q อย่างน้อย 1 กล่อง");
  }

  const seen = new Set<string>();
  const qBoxes: WorkOrderQBox[] = [];
  for (const box of input.q_boxes) {
    const qCode = normalizeQCode(box.q_code);
    if (!Q_CODE_PATTERN.test(qCode)) {
      throw new WorkOrderError(`รหัสกล่องต้องอยู่ในรูป Q1, Q2, ... (ได้รับ: ${box.q_code})`);
    }
    if (seen.has(qCode)) {
      throw new WorkOrderError(`กล่อง ${qCode} ถูกระบุซ้ำในใบงานนี้`);
    }
    seen.add(qCode);
    if (!Array.isArray(box.items) || box.items.length === 0) {
      throw new WorkOrderError(`กล่อง ${qCode} ยังไม่มีรายการสินค้า`);
    }
    const items: WorkOrderQItem[] = box.items.map((it) => {
      const qty = Math.floor(Number(it.qty));
      if (!it.sku || !Number.isFinite(qty) || qty < 1) {
        throw new WorkOrderError(`กล่อง ${qCode}: รายการ ${it.sku || "(ว่าง)"} ต้องมีจำนวนอย่างน้อย 1`);
      }
      return {
        sku: it.sku,
        product_id: it.product_id,
        barcode: it.barcode,
        product_name: it.product_name,
        qty_required: qty,
        qty_picked: 0,
        status: "PENDING",
      };
    });
    qBoxes.push({ q_code: qCode, status: "PENDING", items });
  }

  const conflicts = await findQConflicts(repo, Array.from(seen));
  if (conflicts.size > 0) {
    const detail = Array.from(conflicts.entries())
      .map(([code, docNo]) => `${code} (ติดงาน ${docNo})`)
      .join(", ");
    throw new WorkOrderError(`กล่อง Q ยังติดงานอื่นอยู่ — ${detail}`);
  }

  const note: OutboundBillNote = {
    kind: "outbound_bill",
    outbound_status: "DRAFT",
    express_bill_no: "",
    customer: input.title?.trim() || undefined,
    warehouse_id: input.warehouse_id,
    items: aggregateItems(input.q_boxes),
    box_document_ids: [],
    exceptions: [],
    source: "WORK_ORDER",
    q_boxes: qBoxes,
  };

  const doc = await repo.documents.create({
    document_type: "WORK_ORDER",
    reference_no: input.title?.trim() || "",
    document_date: new Date().toISOString().slice(0, 10),
    status: "DRAFT",
    note: JSON.stringify(note),
    created_by: actor.id,
  });

  // เติมเลขที่ใบงาน (TV-...) ใน note ให้แสดงตรงกับทุกหน้า
  note.express_bill_no = doc.document_no;
  await repo.documents.updateNote(doc.document_id, JSON.stringify(note));

  return { document_id: doc.document_id, document_no: doc.document_no };
}

async function getWorkOrder(repo: IStockRepository, idOrNo: string): Promise<{ doc: Document; note: OutboundBillNote }> {
  const doc = await findDocumentByIdOrNo(repo, idOrNo);
  if (!doc) throw new WorkOrderError("ไม่พบใบงานนี้");
  const note = parseBillNote(doc);
  if (!isWorkOrderNote(note)) throw new WorkOrderError("เอกสารนี้ไม่ใช่ใบงานกล่อง Q");
  return { doc, note };
}

export interface WorkOrderSummary {
  document_id: string;
  document_no: string;
  title?: string;
  outbound_status: string;
  warehouse_id: string;
  q_total: number;
  q_done: number;
  item_total_qty: number;
  item_picked_qty: number;
  created_at: string;
  sent_at?: string;
  cancel_reason?: string;
}

export async function listWorkOrders(repo: IStockRepository): Promise<WorkOrderSummary[]> {
  const docs = await listWorkOrderDocuments(repo);
  const summaries: WorkOrderSummary[] = [];
  for (const doc of docs) {
    const note = parseBillNote(doc);
    if (!isWorkOrderNote(note)) continue;
    summaries.push({
      document_id: doc.document_id,
      document_no: doc.document_no,
      title: note.customer,
      outbound_status: note.outbound_status,
      warehouse_id: note.warehouse_id,
      q_total: note.q_boxes!.length,
      q_done: note.q_boxes!.filter((q) => q.status === "DONE").length,
      item_total_qty: note.items.reduce((s, it) => s + it.qty_required, 0),
      item_picked_qty: note.items.reduce((s, it) => s + it.qty_picked, 0),
      created_at: doc.created_at,
      sent_at: note.sent_at,
      cancel_reason: note.cancel_reason,
    });
  }
  summaries.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return summaries;
}

export async function getWorkOrderDetail(repo: IStockRepository, idOrNo: string) {
  const { doc, note } = await getWorkOrder(repo, idOrNo);
  return { doc, note };
}

/**
 * ส่งใบงานถึงพนักงาน — ตรวจสต็อกพอ → ตัดสต็อกทันที (issueStock idempotent)
 * → DRAFT → READY_TO_PICK พร้อม stamp ตำแหน่งหยิบให้ทุกรายการ
 */
export async function sendWorkOrder(
  repo: IStockRepository,
  idOrNo: string,
  actor: Actor
): Promise<{ document_no: string; issue_document_no: string }> {
  const { doc, note } = await getWorkOrder(repo, idOrNo);
  if (note.outbound_status !== "DRAFT") {
    throw new WorkOrderError(`ส่งได้เฉพาะร่างใบงาน (ปัจจุบัน: ${note.outbound_status})`);
  }
  if (note.issue_document_id) {
    throw new WorkOrderError(`ใบงานนี้ถูกส่งและตัดสต็อกไปแล้ว (${note.issue_document_no})`);
  }

  // Available = สต็อกคงเหลือ − ที่บิล Express กำลังจองอยู่ (รวมทุกคลัง + สำนักงานใหญ่)
  await assertAvailableForPick(repo, note.warehouse_id, note);
  const summaries = await repo.stockSummary
    .findAll()
    .catch(() => []);

  // ตำแหน่งหยิบ: ชอบคลังของใบงานก่อน ถ้าไม่มีสต็อกไล่คลังอื่น/สำนักงานใหญ่
  // location_wh = คลังเจ้าของตำแหน่งจริง (ใช้ตอนตัดสต็อกให้ถูกคลัง)
  const locationFor = (productId?: string): { location_id: string; location_wh: string } | undefined => {
    if (!productId) return undefined;
    const sug = suggestPickLocationAll(summaries, note.warehouse_id, productId);
    return sug ? { location_id: sug.location_id, location_wh: sug.warehouse_id } : undefined;
  };
  const stampItem = (item: { location_id?: string; location_wh?: string; product_id?: string }) => {
    if (item.location_id) return;
    const sug = locationFor(item.product_id);
    if (sug) {
      item.location_id = sug.location_id;
      item.location_wh = sug.location_wh;
    }
  };
  for (const item of note.items) {
    stampItem(item);
  }
  for (const q of note.q_boxes!) {
    for (const item of q.items) {
      stampItem(item);
    }
  }

  // รวมยอดตามคลัง+ตำแหน่งเพื่อตัดสต็อก (แยกตามคลังเจ้าของตำแหน่ง)
  const lineMap = new Map<string, { warehouse_id: string; product_id: string; location_id: string; qty: number }>();
  for (const item of note.items) {
    if (!item.product_id || !item.location_id) {
      throw new WorkOrderError(`รายการ ${item.sku} ไม่มีตำแหน่งจัดเก็บ — ตรวจสอบสต็อกก่อนส่งใบงาน`);
    }
    const wh = item.location_wh || note.warehouse_id;
    const key = `${wh}|${item.product_id}|${item.location_id}`;
    const line = lineMap.get(key);
    if (line) line.qty += item.qty_required;
    else lineMap.set(key, { warehouse_id: wh, product_id: item.product_id, location_id: item.location_id, qty: item.qty_required });
  }

  // issueStock ตัดได้คลังละบิล — จัดกลุ่มตามคลัง คลังของใบงานเองได้ idempotency key เดิม (compat)
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

  const issueDocs: Array<{ document_id: string; document_no: string }> = [];
  for (const wh of warehousesOrdered) {
    issueDocs.push(
      await issueStock(
        { repo },
        {
          warehouse_id: wh,
          reference_no: doc.document_no,
          document_date: new Date().toISOString().slice(0, 10),
          note: `ใบงานกล่อง Q ${doc.document_no}${note.customer ? ` — ${note.customer}` : ""}`.slice(0, 500),
          idempotency_key:
            wh === note.warehouse_id
              ? `work-order-${doc.document_id}`
              : `work-order-${doc.document_id}-${wh}`,
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
    assertBillTransition(n.outbound_status, "READY_TO_PICK");
    n.outbound_status = "READY_TO_PICK";
    n.issue_document_id = issueDoc.document_id;
    n.issue_document_no = issueDocs.map((d) => d.document_no).join(", ");
    n.sent_by = actor.username;
    n.sent_at = new Date().toISOString();
    n.items = note.items;
    n.q_boxes = note.q_boxes;
  }, { alsoStatus: billStatusToDocumentStatus("READY_TO_PICK") });
  if (!result) throw new WorkOrderError("บันทึกสถานะใบงานไม่สำเร็จ (สต็อกถูกตัดแล้ว — ตรวจสอบอีกครั้ง)");

  return { document_no: result.doc.document_no, issue_document_no: issueDocs.map((d) => d.document_no).join(", ") };
}

interface ActiveQ {
  doc: Document;
  note: OutboundBillNote;
  q: WorkOrderQBox;
  isBill?: boolean;
}

/** ค้นหา "กล่อง Q ที่กำลังทำอยู่" — 1 รหัส Q ผูกกับใบงานหรือบิล Express ที่ยังไม่จบได้ทีละ 1 ใบ */
async function findActiveQ(repo: IStockRepository, rawQCode: string): Promise<ActiveQ | { doneIn?: string }> {
  const qCode = normalizeQCode(rawQCode);
  if (!Q_CODE_PATTERN.test(qCode)) {
    throw new WorkOrderError(`รหัสกล่องต้องอยู่ในรูป Q1, Q2, ... (สแกนได้: ${rawQCode})`);
  }

  // 1. ค้นหาในใบงาน Q (WORK_ORDER)
  const woDocs = await listWorkOrderDocuments(repo);
  for (const doc of woDocs) {
    const note = parseBillNote(doc);
    if (!isWorkOrderNote(note)) continue;
    const q = note.q_boxes!.find((b) => b.q_code === qCode);
    if (!q) continue;
    if (note.outbound_status === "DRAFT") {
      throw new WorkOrderError(`กล่อง ${qCode} อยู่ในใบงาน ${doc.document_no} ที่ยังไม่ถูกส่ง — ให้แอดมินกดส่งใบงานก่อน`);
    }
    if (q.status === "DONE") {
      if (note.outbound_status === "PICKING" || note.outbound_status === "SHORTAGE") continue;
      return { doneIn: doc.document_no };
    }
    if (note.outbound_status === "READY_TO_PICK" || note.outbound_status === "PICKING") {
      return { doc, note, q, isBill: false };
    }
    if (note.outbound_status === "SHORTAGE") {
      throw new WorkOrderError(`ใบงาน ${doc.document_no} ติดปัญหาของไม่ครบ — รอหัวหน้าตัดสินก่อน`);
    }
  }

  // 2. ค้นหาในบิล Express ที่มีการแบ่งกล่อง Q (OUTBOUND_ORDER ที่มี q_assignments)
  const billDocs = await listBillDocuments(repo);
  for (const doc of billDocs) {
    const note = parseBillNote(doc);
    if (!note || !Array.isArray(note.q_assignments) || note.q_assignments.length === 0) continue;
    const assignment = note.q_assignments.find((a) => a.q_code === qCode);
    if (!assignment) continue;

    if (note.outbound_status === "CANCELLED") continue;
    if (note.outbound_status === "HOLD") {
      throw new WorkOrderError(`บิล ${doc.document_no} พักงานอยู่ (HOLD)`);
    }
    if (note.outbound_status === "SHORTAGE") {
      throw new WorkOrderError(`บิล ${doc.document_no} ติดปัญหาของไม่ครบ — รอหัวหน้าตัดสินก่อน`);
    }

    // สร้าง Map รายการของบิลเพื่อดึง barcode, product_name, location_hint/id, qty_picked
    const itemsMap = new Map<string, typeof note.items[0]>();
    for (const it of note.items || []) {
      itemsMap.set(cleanSku(it.sku), it);
    }

    const qBoxItems: WorkOrderQItem[] = assignment.items.map((qItem) => {
      const detail = itemsMap.get(cleanSku(qItem.sku));
      return {
        sku: qItem.sku,
        product_id: detail?.product_id,
        barcode: detail?.barcode,
        product_name: detail?.product_name,
        qty_required: qItem.qty,
        qty_picked: detail?.qty_picked ?? 0,
        status: (detail?.status as OutboundItemStatus) ?? "PENDING",
        location_id: detail?.location_id || detail?.location_hint,
        location_wh: detail?.location_wh,
      };
    });

    const isDone =
      assignment.status === "DONE" ||
      (qBoxItems.length > 0 && qBoxItems.every((it) => it.qty_picked >= it.qty_required));

    if (isDone) {
      if (
        note.outbound_status === "PICKING" ||
        note.outbound_status === "IMPORTED" ||
        note.outbound_status === "READY_TO_PICK"
      ) {
        continue;
      }
      return { doneIn: doc.document_no };
    }

    if (["IMPORTED", "READY_TO_PICK", "PICKING"].includes(note.outbound_status)) {
      const q: WorkOrderQBox = {
        q_code: assignment.q_code,
        status: (assignment.status as WorkOrderQBoxStatus) || "PENDING",
        items: qBoxItems,
        picked_by: assignment.picked_by,
        picked_by_name: assignment.picked_by_name,
        started_at: assignment.started_at,
        completed_at: assignment.completed_at,
      };
      return { doc, note, q, isBill: true };
    }

    if (
      ["PACKED", "ASSIGNED_TO_SHIPMENT", "LOADING", "SHIPPED", "READY_TO_PACK", "PACKING"].includes(
        note.outbound_status
      )
    ) {
      return { doneIn: doc.document_no };
    }
  }

  throw new WorkOrderError(`ไม่พบงานของกล่อง ${qCode} — ให้แอดมินสร้างใบงานหรือนำเข้าบิลก่อน`);
}

export interface QPickView {
  document_id: string;
  document_no: string;
  q_code: string;
  q_status: WorkOrderQBox["status"];
  title?: string;
  items: Array<WorkOrderQItem & { remaining: number }>;
}

function toQView(doc: Document, note: OutboundBillNote, q: WorkOrderQBox): QPickView {
  const items = [...q.items]
    .sort((a, b) => (a.location_id || "zz").localeCompare(b.location_id || "zz"))
    .map((it) => ({ ...it, remaining: Math.max(0, it.qty_required - it.qty_picked) }));
  return {
    document_id: doc.document_id,
    document_no: doc.document_no,
    q_code: q.q_code,
    q_status: q.status,
    title: note.customer || note.express_bill_no,
    items,
  };
}

/** พนักงานสแกนกล่อง Q → เริ่ม/กลับเข้าทำงานของกล่องนั้น */
export async function startQBox(
  repo: IStockRepository,
  rawQCode: string,
  actor: Actor
): Promise<QPickView> {
  const found = await findActiveQ(repo, rawQCode);
  if (!("doc" in found)) {
    throw new WorkOrderError(`กล่อง ${normalizeQCode(rawQCode)} หยิบเสร็จแล้วใน ${found.doneIn} — หยิบซ้ำไม่ได้`);
  }
  const { doc, note, q, isBill } = found;

  if (q.status === "PICKING" && q.picked_by && q.picked_by !== actor.id) {
    throw new WorkOrderError(`กล่อง ${q.q_code} กำลังถูกหยิบโดย ${q.picked_by_name || q.picked_by} อยู่`);
  }

  if (isBill) {
    if (note.outbound_status === "IMPORTED" || note.outbound_status === "READY_TO_PICK") {
      await assertAvailableForPick(repo, note.warehouse_id, note);
    }
    const summaries: StockSummary[] = await repo.stockSummary
      .findAll()
      .catch(() => [] as StockSummary[]);

    const result = await mutateBillNote(
      repo,
      doc.document_id,
      (n) => {
        if (n.outbound_status === "IMPORTED") {
          assertBillTransition(n.outbound_status, "READY_TO_PICK");
          n.outbound_status = "READY_TO_PICK";
        }
        if (n.outbound_status === "READY_TO_PICK") {
          assertBillTransition(n.outbound_status, "PICKING");
          n.outbound_status = "PICKING";
          n.pick_started_at = new Date().toISOString();
          n.pick_assigned_to = actor.id;
          n.pick_assigned_to_name = actor.username;
          for (const item of n.items) {
            if (!item.location_id && item.product_id) {
              const sug = suggestPickLocationAll(summaries, n.warehouse_id, item.product_id);
              if (sug) {
                item.location_id = sug.location_id;
                item.location_wh = sug.warehouse_id;
              }
            }
          }
        }
        const targetAssignment = n.q_assignments?.find((a) => a.q_code === q.q_code);
        if (targetAssignment && targetAssignment.status !== "DONE") {
          targetAssignment.status = "PICKING";
          targetAssignment.picked_by = actor.id;
          targetAssignment.picked_by_name = actor.username;
          if (!targetAssignment.started_at) targetAssignment.started_at = new Date().toISOString();
        }
      },
      { alsoStatus: billStatusToDocumentStatus("PICKING") }
    );
    if (!result) throw new WorkOrderError("ไม่พบบิลนี้");

    const itemsMap = new Map<string, typeof result.note.items[0]>();
    for (const it of result.note.items || []) {
      itemsMap.set(cleanSku(it.sku), it);
    }
    const updatedAssignment = result.note.q_assignments?.find((a) => a.q_code === q.q_code);
    const updatedItems: WorkOrderQItem[] = (updatedAssignment?.items || []).map((qItem) => {
      const detail = itemsMap.get(cleanSku(qItem.sku));
      return {
        sku: qItem.sku,
        product_id: detail?.product_id,
        barcode: detail?.barcode,
        product_name: detail?.product_name,
        qty_required: qItem.qty,
        qty_picked: detail?.qty_picked ?? 0,
        status: (detail?.status as OutboundItemStatus) ?? "PENDING",
        location_id: detail?.location_id || detail?.location_hint,
        location_wh: detail?.location_wh,
      };
    });
    const updatedQ: WorkOrderQBox = {
      q_code: q.q_code,
      status: updatedAssignment?.status ?? "PICKING",
      items: updatedItems,
      picked_by: updatedAssignment?.picked_by ?? actor.id,
      picked_by_name: updatedAssignment?.picked_by_name ?? actor.username,
      started_at: updatedAssignment?.started_at,
      completed_at: updatedAssignment?.completed_at,
    };
    return toQView(result.doc, result.note, updatedQ);
  }

  // สำหรับ Work Order
  const result = await mutateBillNote(
    repo,
    doc.document_id,
    (n) => {
      if (n.outbound_status === "READY_TO_PICK") {
        assertBillTransition(n.outbound_status, "PICKING");
        n.outbound_status = "PICKING";
        n.pick_started_at = new Date().toISOString();
        n.pick_assigned_to = actor.id;
        n.pick_assigned_to_name = actor.username;
      }
      const target = n.q_boxes!.find((b) => b.q_code === q.q_code);
      if (!target) throw new WorkOrderError("ไม่พบกล่องในใบงาน");
      if (target.status !== "DONE") {
        target.status = "PICKING";
        target.picked_by = actor.id;
        target.picked_by_name = actor.username;
        if (!target.started_at) target.started_at = new Date().toISOString();
      }
    },
    { alsoStatus: billStatusToDocumentStatus("PICKING") }
  );
  if (!result) throw new WorkOrderError("ไม่พบใบงานนี้");

  const updatedQ = result.note.q_boxes!.find((b) => b.q_code === q.q_code)!;
  return toQView(result.doc, result.note, updatedQ);
}

export interface ConfirmQItemResult {
  q_code: string;
  sku: string;
  qty_picked: number;
  qty_required: number;
  item_status: string;
  q_status: string;
  work_order_status: string;
  message: string;
}

/** พนักงานสแกนสินค้ายืนยัน — 1 สแกน = 1 ชิ้น (กันสินค้าผิด/เกินจำนวน/ทำ Q ซ้ำ) */
export async function confirmQItemScan(
  repo: IStockRepository,
  rawQCode: string,
  scanned: string,
  actor: Actor
): Promise<ConfirmQItemResult> {
  const found = await findActiveQ(repo, rawQCode);
  if (!("doc" in found)) {
    throw new WorkOrderError(`กล่อง ${normalizeQCode(rawQCode)} หยิบเสร็จแล้ว — หยิบซ้ำไม่ได้`);
  }
  const { doc, q, isBill } = found;
  if (found.note.outbound_status !== "PICKING") {
    throw new WorkOrderError(`ใบงานนี้ไม่ได้อยู่ในสถานะกำลังหยิบ (ปัจจุบัน: ${found.note.outbound_status})`);
  }
  if (q.picked_by && q.picked_by !== actor.id) {
    throw new WorkOrderError(`กล่อง ${q.q_code} กำลังถูกหยิบโดย ${q.picked_by_name || q.picked_by} อยู่`);
  }

  const item = findBillItemByScan(q.items, scanned);
  if (!item) {
    throw new WorkOrderError(`สินค้าที่สแกนไม่อยู่ในกล่อง ${q.q_code} (${scanned})`);
  }
  const remaining = item.qty_required - item.qty_picked;
  if (remaining <= 0) {
    throw new WorkOrderError(`รายการ ${item.sku} ในกล่อง ${q.q_code} หยิบครบแล้ว`);
  }

  let message = "";
  let outStatus = "";

  if (isBill) {
    const result = await mutateBillNote(
      repo,
      doc.document_id,
      (n) => {
        const target = n.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku));
        if (!target) throw new WorkOrderError("ไม่พบรายการ");
        if (target.qty_picked >= target.qty_required) {
          throw new WorkOrderError(`รายการ ${target.sku} หยิบครบแล้ว`);
        }
        target.qty_picked += 1;
        target.status = target.qty_picked >= target.qty_required ? "PICKED" : "PENDING";

        const targetAssignment = n.q_assignments?.find((a) => a.q_code === q.q_code);
        const assignmentComplete =
          targetAssignment?.items.every((it) => {
            const detail = n.items.find((x) => cleanSku(x.sku) === cleanSku(it.sku));
            return (detail?.qty_picked ?? 0) >= it.qty;
          }) ?? false;

        if (assignmentComplete && targetAssignment && targetAssignment.status !== "DONE") {
          targetAssignment.status = "DONE";
          targetAssignment.completed_at = new Date().toISOString();
        }

        message = `${target.sku}: ${target.qty_picked}/${target.qty_required}${
          target.qty_picked >= target.qty_required ? " ✓ หยิบครบ" : ""
        }`;

        const allBillDone = n.items.every((it) => it.qty_picked >= it.qty_required);
        const hasProblem = n.items.some((it) => it.status === "PROBLEM");
        const hasPendingQty = n.items.some(
          (it) => it.status !== "PROBLEM" && it.qty_picked < it.qty_required
        );

        if (allBillDone && !hasProblem) {
          assertBillTransition(n.outbound_status, "READY_TO_PACK");
          n.outbound_status = "READY_TO_PACK";
          n.pick_completed_at = new Date().toISOString();
          message += ` — กล่อง ${q.q_code} หยิบเสร็จ และบิลครบทุกรายการแล้ว 🎉`;
        } else if (!hasPendingQty && hasProblem) {
          assertBillTransition(n.outbound_status, "SHORTAGE");
          n.outbound_status = "SHORTAGE";
          message += ` — บิลเหลือแต่รายการที่แจ้งปัญหา รอหัวหน้าตัดสิน`;
        } else if (assignmentComplete) {
          message += ` — กล่อง ${q.q_code} หยิบเสร็จ`;
        }
        outStatus = n.outbound_status;
      },
      outStatus === "READY_TO_PACK" ? { alsoStatus: billStatusToDocumentStatus("READY_TO_PACK") } : undefined
    );
    if (!result) throw new WorkOrderError("บันทึกไม่สำเร็จ");

    const itemAfter = result.note.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku))!;
    const targetAssignment = result.note.q_assignments?.find((a) => a.q_code === q.q_code);
    const qStatusAfter =
      targetAssignment?.status ||
      (targetAssignment?.items.every((it) => {
        const detail = result.note.items.find((x) => cleanSku(x.sku) === cleanSku(it.sku));
        return (detail?.qty_picked ?? 0) >= it.qty;
      })
        ? "DONE"
        : "PICKING");

    return {
      q_code: q.q_code,
      sku: itemAfter.sku,
      qty_picked: itemAfter.qty_picked,
      qty_required: item.qty_required,
      item_status: itemAfter.status,
      q_status: qStatusAfter,
      work_order_status: result.note.outbound_status,
      message,
    };
  }

  // สำหรับ Work Order
  const result = await mutateBillNote(
    repo,
    doc.document_id,
    (n) => {
      const targetQ = n.q_boxes!.find((b) => b.q_code === q.q_code);
      if (!targetQ) throw new WorkOrderError("ไม่พบกล่องในใบงาน");
      const target = targetQ.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku));
      if (!target) throw new WorkOrderError("ไม่พบรายการ");
      if (target.qty_picked >= target.qty_required) {
        throw new WorkOrderError(`รายการ ${target.sku} หยิบครบแล้ว`);
      }
      target.qty_picked += 1;
      target.status = target.qty_picked >= target.qty_required ? "PICKED" : "PENDING";

      // sync ยอดรวม (items) ให้ขั้นแพ็กเห็นตรงกันเสมอ
      const agg = n.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku));
      if (agg && agg.qty_picked < agg.qty_required) {
        agg.qty_picked += 1;
        if (agg.qty_picked >= agg.qty_required) agg.status = "PICKED";
      }

      // กล่องนี้ครบทุกรายการ → DONE
      const qComplete = targetQ.items.every((it) => it.qty_picked >= it.qty_required);
      if (qComplete && targetQ.status !== "DONE") {
        targetQ.status = "DONE";
        targetQ.completed_at = new Date().toISOString();
      }

      message = `${target.sku}: ${target.qty_picked}/${target.qty_required}${
        target.qty_picked >= target.qty_required ? " ✓ หยิบครบ" : ""
      }`;

      // ทุกกล่องเสร็จ + ไม่มีรายการค้าง → ใบงานเข้าคิวแพ็กทันที (สต็อกถูกตัดไปแล้วตอนส่งใบงาน)
      const allDone = n.q_boxes!.every((b) => b.status === "DONE");
      const hasProblem = n.q_boxes!.some((b) => b.items.some((it) => it.status === "PROBLEM"));
      const hasPendingQty = n.q_boxes!.some((b) =>
        b.items.some((it) => it.status !== "PROBLEM" && it.qty_picked < it.qty_required)
      );
      if (allDone && !hasProblem) {
        assertBillTransition(n.outbound_status, "READY_TO_PACK");
        n.outbound_status = "READY_TO_PACK";
        n.pick_completed_at = new Date().toISOString();
        message += ` — กล่อง ${targetQ.q_code} หยิบเสร็จ และใบงานครบทุกกล่องแล้ว 🎉`;
      } else if (!hasPendingQty && hasProblem) {
        assertBillTransition(n.outbound_status, "SHORTAGE");
        n.outbound_status = "SHORTAGE";
        message += ` — ใบงานเหลือแต่รายการที่แจ้งปัญหา รอหัวหน้าตัดสิน`;
      } else if (targetQ.status === "DONE") {
        message += ` — กล่อง ${targetQ.q_code} หยิบเสร็จ`;
      }
      outStatus = n.outbound_status;
    },
    outStatus === "READY_TO_PACK" ? { alsoStatus: billStatusToDocumentStatus("READY_TO_PACK") } : undefined
  );
  if (!result) throw new WorkOrderError("บันทึกไม่สำเร็จ");

  const qAfter = result.note.q_boxes!.find((b) => b.q_code === q.q_code)!;
  const itemAfter = qAfter.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku))!;
  return {
    q_code: qAfter.q_code,
    sku: itemAfter.sku,
    qty_picked: itemAfter.qty_picked,
    qty_required: itemAfter.qty_required,
    item_status: itemAfter.status,
    q_status: qAfter.status,
    work_order_status: result.note.outbound_status,
    message,
  };
}

export interface ReportQProblemInput {
  problem: OutboundExceptionType;
  picked_qty?: number;
  note?: string;
}

/** พนักงานแจ้งปัญหาของรายการในกล่อง Q (หาไม่เจอ/ชำรุด/...) — หัวหน้าตัดสินต่อ */
export async function reportQProblem(
  repo: IStockRepository,
  rawQCode: string,
  scanned: string,
  input: ReportQProblemInput,
  actor: Actor
): Promise<{ work_order_status: string }> {
  const found = await findActiveQ(repo, rawQCode);
  if (!("doc" in found)) throw new WorkOrderError(`กล่อง ${normalizeQCode(rawQCode)} หยิบเสร็จแล้ว`);
  const { doc, note, q, isBill } = found;
  if (note.outbound_status !== "PICKING") {
    throw new WorkOrderError(`ใบงานนี้ไม่ได้อยู่ในสถานะกำลังหยิบ (ปัจจุบัน: ${note.outbound_status})`);
  }
  const item = findBillItemByScan(q.items, scanned);
  if (!item) throw new WorkOrderError(`สินค้าที่ระบุไม่อยู่ในกล่อง ${q.q_code} (${scanned})`);
  if (typeof input.picked_qty === "number" && (input.picked_qty < 0 || input.picked_qty > item.qty_required)) {
    throw new WorkOrderError(`จำนวนที่หยิบได้ต้องอยู่ระหว่าง 0–${item.qty_required}`);
  }

  if (isBill) {
    const result = await mutateBillNote(repo, doc.document_id, (n) => {
      const target = n.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku));
      if (!target) throw new WorkOrderError("ไม่พบรายการ");
      if (typeof input.picked_qty === "number" && input.picked_qty > target.qty_picked) {
        target.qty_picked = input.picked_qty;
      }
      target.status = "PROBLEM";

      n.exceptions.push({
        type: input.problem,
        sku: target.sku,
        reported_qty: typeof input.picked_qty === "number" ? input.picked_qty : target.qty_picked,
        note: input.note ? `[${q.q_code}] ${input.note}` : `กล่อง ${q.q_code}`,
        reported_by: actor.id,
        reported_by_name: actor.username,
        reported_at: new Date().toISOString(),
      });

      const hasNormalPending = n.items.some(
        (it) => it.status !== "PROBLEM" && it.status !== "PICKED" && it.qty_picked < it.qty_required
      );
      if (!hasNormalPending) {
        assertBillTransition(n.outbound_status, "SHORTAGE");
        n.outbound_status = "SHORTAGE";
      }
    });
    if (!result) throw new WorkOrderError("บันทึกไม่สำเร็จ");
    if (result.note.outbound_status === "SHORTAGE") {
      await repo.documents.updateStatus(result.doc.document_id, billStatusToDocumentStatus("SHORTAGE")).catch(() => {});
    }
    return { work_order_status: result.note.outbound_status };
  }

  // สำหรับ Work Order
  const result = await mutateBillNote(repo, doc.document_id, (n) => {
    const targetQ = n.q_boxes!.find((b) => b.q_code === q.q_code);
    if (!targetQ) throw new WorkOrderError("ไม่พบกล่องในใบงาน");
    const target = targetQ.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku));
    if (!target) throw new WorkOrderError("ไม่พบรายการ");
    if (typeof input.picked_qty === "number" && input.picked_qty > target.qty_picked) {
      const diff = input.picked_qty - target.qty_picked;
      target.qty_picked = input.picked_qty;
      const agg = n.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku));
      if (agg) agg.qty_picked = Math.min(agg.qty_required, agg.qty_picked + diff);
    }
    target.status = "PROBLEM";

    n.exceptions.push({
      type: input.problem,
      sku: target.sku,
      reported_qty: typeof input.picked_qty === "number" ? input.picked_qty : target.qty_picked,
      note: input.note ? `[${targetQ.q_code}] ${input.note}` : `กล่อง ${targetQ.q_code}`,
      reported_by: actor.id,
      reported_by_name: actor.username,
      reported_at: new Date().toISOString(),
    });

    const hasNormalPending = n.q_boxes!.some((b) =>
      b.items.some((it) => it.status !== "PROBLEM" && it.status !== "PICKED" && it.qty_picked < it.qty_required)
    );
    if (!hasNormalPending) {
      assertBillTransition(n.outbound_status, "SHORTAGE");
      n.outbound_status = "SHORTAGE";
    }
  });
  if (!result) throw new WorkOrderError("บันทึกไม่สำเร็จ");
  if (result.note.outbound_status === "SHORTAGE") {
    await repo.documents.updateStatus(result.doc.document_id, billStatusToDocumentStatus("SHORTAGE")).catch(() => {});
  }
  return { work_order_status: result.note.outbound_status };
}

/** คืนสต็อกส่วนที่ไม่ได้ใช้จริงกลับตำแหน่งเดิม (receiveStock idempotent ต่อใบงาน) */
async function returnUnusedStock(
  repo: IStockRepository,
  note: OutboundBillNote,
  documentNo: string,
  lines: Array<{ product_id: string; location_id: string; qty: number }>,
  actor: Actor,
  reason: string
): Promise<void> {
  if (lines.length === 0) return;
  await receiveStock(
    { repo },
    {
      warehouse_id: note.warehouse_id,
      reference_no: documentNo,
      document_date: new Date().toISOString().slice(0, 10),
      note: `คืนสต็อกใบงานกล่อง Q ${documentNo} — ${reason}`.slice(0, 500),
      idempotency_key: `work-order-return-${documentNo}`,
      lines: lines.map((l) => ({
        product_id: l.product_id,
        location_id: l.location_id,
        qty: l.qty,
        boxes: 1,
        barcode: "",
        extra_locations: [],
        extra_qtys: [],
        location_allocations: [],
      })),
      user_id: actor.id,
      role: actor.role,
      correlation_id: actor.correlationId,
      user_name: actor.username,
    }
  );
}

/** รวมยอด "ที่ตัดไปแต่ยังไม่ได้หยิบจริง" ตามสินค้า+ตำแหน่ง เพื่อคืนสต็อก */
function buildRemainderLines(note: OutboundBillNote): Array<{ product_id: string; location_id: string; qty: number }> {
  const map = new Map<string, { product_id: string; location_id: string; qty: number }>();
  for (const q of note.q_boxes ?? []) {
    for (const it of q.items) {
      const remain = Math.max(0, it.qty_required - it.qty_picked);
      if (remain <= 0 || !it.product_id || !it.location_id) continue;
      const key = `${it.product_id}|${it.location_id}`;
      const line = map.get(key);
      if (line) line.qty += remain;
      else map.set(key, { product_id: it.product_id, location_id: it.location_id, qty: remain });
    }
  }
  return Array.from(map.values());
}

/** รวมยอดเต็มตามที่เคยตัดไป (ใช้ตอนยกเลิกหลังส่ง) */
function buildFullLines(note: OutboundBillNote): Array<{ product_id: string; location_id: string; qty: number }> {
  const map = new Map<string, { product_id: string; location_id: string; qty: number }>();
  for (const q of note.q_boxes ?? []) {
    for (const it of q.items) {
      if (!it.product_id || !it.location_id || it.qty_required <= 0) continue;
      const key = `${it.product_id}|${it.location_id}`;
      const line = map.get(key);
      if (line) line.qty += it.qty_required;
      else map.set(key, { product_id: it.product_id, location_id: it.location_id, qty: it.qty_required });
    }
  }
  return Array.from(map.values());
}

/**
 * หัวหน้าตัดสินใบงานที่ติดปัญหา (SHORTAGE):
 *  - REDUCE_QTY: ยอมรับยอดที่หยิบได้ ตัดรายการเหลือออก + คืนสต็อกส่วนต่าง → เข้าคิวแพ็ก
 *  - CANCEL: ยกเลิกทั้งใบงาน + คืนสต็อกทั้งยอดที่ตัดไป
 */
export async function resolveWorkOrderShortage(
  repo: IStockRepository,
  idOrNo: string,
  outcome: "REDUCE_QTY" | "CANCEL",
  actor: Actor,
  reason?: string
): Promise<{ work_order_status: string; message: string }> {
  const { doc, note } = await getWorkOrder(repo, idOrNo);
  if (note.outbound_status !== "SHORTAGE") {
    throw new WorkOrderError(`ตัดสินได้เฉพาะใบงานสถานะของไม่ครบ (ปัจจุบัน: ${note.outbound_status})`);
  }

  if (outcome === "CANCEL") {
    await returnUnusedStock(repo, note, doc.document_no, buildFullLines(note), actor, reason || "ยกเลิกใบงาน");
    await mutateBillNote(repo, doc.document_id, (n) => {
      assertBillTransition(n.outbound_status, "CANCELLED");
      n.outbound_status = "CANCELLED";
      n.cancel_reason = reason || "ยกเลิกใบงานกล่อง Q";
    }, { alsoStatus: "CANCELLED" });
    return { work_order_status: "CANCELLED", message: "ยกเลิกใบงานและคืนสต็อกทั้งหมดแล้ว" };
  }

  // REDUCE_QTY — คืนเฉพาะส่วนที่หยิบไม่ได้ แล้วปิดรายการเหล่านั้น
  await returnUnusedStock(repo, note, doc.document_no, buildRemainderLines(note), actor, reason || "ตัดจำนวนลงตามที่หยิบได้");
  const result = await mutateBillNote(repo, doc.document_id, (n) => {
    for (const q of n.q_boxes ?? []) {
      for (const it of q.items) {
        if (it.status === "PROBLEM") {
          it.qty_required = it.qty_picked;
          it.status = "PICKED";
        }
      }
      const qComplete = q.items.every((it) => it.qty_picked >= it.qty_required);
      if (qComplete && q.status !== "DONE") {
        q.status = "DONE";
        if (!q.completed_at) q.completed_at = new Date().toISOString();
      }
    }
    // ยอดรวมตามรายการที่ปรับแล้ว
    for (const agg of n.items) {
      const totalRequired = (n.q_boxes ?? [])
        .flatMap((b) => b.items)
        .filter((it) => cleanSku(it.sku) === cleanSku(agg.sku))
        .reduce((s, it) => s + it.qty_required, 0);
      agg.qty_required = totalRequired;
      agg.status = agg.qty_picked >= agg.qty_required ? "PICKED" : agg.status;
    }
    for (const ex of n.exceptions) {
      if (!ex.resolved_at) {
        ex.resolved_at = new Date().toISOString();
        ex.resolved_by = actor.username;
        ex.resolution = "REDUCE_QTY";
      }
    }
    assertBillTransition(n.outbound_status, "READY_TO_PACK");
    n.outbound_status = "READY_TO_PACK";
    n.pick_completed_at = new Date().toISOString();
  }, { alsoStatus: billStatusToDocumentStatus("READY_TO_PACK") });
  if (!result) throw new WorkOrderError("บันทึกไม่สำเร็จ");

  return { work_order_status: "READY_TO_PACK", message: "ตัดจำนวนตามที่หยิบได้ คืนสต็อกส่วนต่าง และส่งเข้าคิวแพ็กแล้ว" };
}

/** ยกเลิกใบงาน — ก่อนส่ง (DRAFT) ยกเลิกฟรี / หลังส่งต้องผ่าน resolveWorkOrderShortage เท่านั้น */
export async function cancelWorkOrder(
  repo: IStockRepository,
  idOrNo: string,
  actor: Actor,
  reason?: string
): Promise<{ work_order_status: string }> {
  const { doc, note } = await getWorkOrder(repo, idOrNo);
  if (note.outbound_status !== "DRAFT") {
    throw new WorkOrderError(
      "ใบงานนี้ส่งไปแล้ว (สต็อกถูกตัด) — ใช้การตัดสินของไม่ครบแบบยกเลิกแทนเพื่อคืนสต็อก"
    );
  }
  await mutateBillNote(repo, doc.document_id, (n) => {
    assertBillTransition(n.outbound_status, "CANCELLED");
    n.outbound_status = "CANCELLED";
    n.cancel_reason = reason || "ยกเลิกร่างใบงาน";
  }, { alsoStatus: "CANCELLED" });
  void actor;
  return { work_order_status: "CANCELLED" };
}

/** ประวัติย้อนหลังของกล่อง Q — ทั้งใบงาน Q และบิล Express ที่เคยใช้กล่องนี้ */
export async function getQBoxHistory(repo: IStockRepository, rawQCode: string) {
  const qCode = normalizeQCode(rawQCode);
  if (!Q_CODE_PATTERN.test(qCode)) throw new WorkOrderError(`รหัสกล่องไม่ถูกต้อง: ${rawQCode}`);

  const rows: Array<{
    document_no: string;
    outbound_status: string;
    q_status: string;
    source: "WORK_ORDER" | "BILL";
    title?: string;
    item_count: number;
    created_at: string;
    completed_at?: string;
  }> = [];

  for (const doc of await listWorkOrderDocuments(repo)) {
    const note = parseBillNote(doc);
    if (!isWorkOrderNote(note)) continue;
    const q = note.q_boxes!.find((b) => b.q_code === qCode);
    if (!q) continue;
    rows.push({
      document_no: doc.document_no,
      outbound_status: note.outbound_status,
      q_status: q.status,
      source: "WORK_ORDER",
      title: note.customer,
      item_count: q.items.length,
      created_at: doc.created_at,
      completed_at: q.completed_at,
    });
  }

  for (const doc of await listBillDocuments(repo)) {
    const note = parseBillNote(doc);
    if (!note || !Array.isArray(note.q_assignments)) continue;
    const q = note.q_assignments.find((a) => a.q_code === qCode);
    if (!q) continue;
    rows.push({
      document_no: doc.document_no,
      outbound_status: note.outbound_status,
      q_status: "ASSIGNED",
      source: "BILL",
      title: note.customer,
      item_count: q.items.length,
      created_at: doc.created_at,
    });
  }

  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rows;
}
