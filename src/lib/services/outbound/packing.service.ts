import type { Document } from "@/types/models";
import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/security/actor";
import { areBarcodesMatching, normalizeBarcode } from "@/lib/barcode-utils";
import {
  findDocumentByIdOrNo,
  listBoxDocuments,
  mutateBillNote,
  mutateBoxNote,
  parseBillNote,
  parseBoxNote,
} from "./outbound-documents";
import {
  assertBillTransition,
  assertBoxTransition,
  billStatusToDocumentStatus,
} from "./outbound-state-machine";

/**
 * Packing — แพ็กของที่หยิบแล้วลงกล่อง (1 บิล = หลายกล่องได้)
 * กล่อง 1 ใบ = record OUTBOUND_BOX 1 record (บาร์โค้ด BX-... = document_no)
 * การสแกนของแต่ละครั้งแก้เฉพาะ record กล่องปัจจุบัน ไม่แตะ note ของบิล
 * จนกว่าจะแพ็กครบ → บิล PACKED
 */

function cleanSku(v: string): string {
  return v.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_#]/g, "");
}

export interface BoxInfo {
  document_id: string;
  document_no: string;
  box_no: number;
  box_status: import("@/types/models").OutboundBoxStatus;
  items: Array<{ sku: string; qty: number }>;
  total_qty: number;
  sticker_printed: boolean;
}

/** หากล่อง (BX-...) จาก document_id หรือบาร์โค้ดที่สแกน */
export async function findBoxByCode(
  repo: IStockRepository,
  code: string
): Promise<{ doc: Document; note: import("@/types/models").OutboundBoxNote } | null> {
  const key = String(code ?? "").trim().toUpperCase();
  const doc = await findDocumentByIdOrNo(repo, key);
  if (doc && doc.document_type === "OUTBOUND_BOX") {
    const note = parseBoxNote(doc);
    if (note) return { doc, note };
  }
  return null;
}

async function getBoxesOfBill(
  repo: IStockRepository,
  billDocumentId: string
): Promise<Array<{ doc: Document; note: import("@/types/models").OutboundBoxNote }>> {
  const all = await listBoxDocuments(repo);
  return all
    .map((doc) => ({ doc, note: parseBoxNote(doc) }))
    .filter(
      (b): b is { doc: Document; note: import("@/types/models").OutboundBoxNote } =>
        b.note !== null && b.note.bill_document_id === billDocumentId
    )
    .sort((a, b) => a.note.box_no - b.note.box_no);
}

async function getOpenBox(
  repo: IStockRepository,
  billDocumentId: string
): Promise<{ doc: Document; note: import("@/types/models").OutboundBoxNote } | null> {
  const boxes = await getBoxesOfBill(repo, billDocumentId);
  return boxes.find((b) => b.note.box_status === "OPEN") ?? null;
}

/** ยอดรวมที่ลงกล่องแล้วของแต่ละ SKU (นับเฉพาะกล่องที่ยังไม่ถูกยกเลิก) */
async function getPackedQtyBySku(
  repo: IStockRepository,
  billDocumentId: string
): Promise<Map<string, number>> {
  const boxes = await getBoxesOfBill(repo, billDocumentId);
  const map = new Map<string, number>();
  for (const { note } of boxes) {
    if (note.box_status === "CANCELLED") continue;
    for (const it of note.items) {
      map.set(cleanSku(it.sku), (map.get(cleanSku(it.sku)) || 0) + it.qty);
    }
  }
  return map;
}

/** เปิดกล่องใหม่ — บิลต้องอยู่ READY_TO_PACK (กล่องแรก) หรือ PACKING (กล่องถัดไป) */
export async function createBox(
  repo: IStockRepository,
  billIdOrNo: string,
  actor: Actor
): Promise<BoxInfo> {
  const billDoc = await findDocumentByIdOrNo(repo, billIdOrNo);
  if (!billDoc) throw new Error("ไม่พบบิลนี้");
  const billNote = parseBillNote(billDoc);
  if (!billNote) throw new Error("ข้อมูลบิลไม่ถูกต้อง");

  const existingOpen = await getOpenBox(repo, billDoc.document_id);
  if (existingOpen) {
    throw new Error(
      `มีกล่องที่ยังเปิดอยู่ (${existingOpen.doc.document_no}) — ปิดกล่องนี้ก่อนจึงเปิดกล่องใหม่ได้`
    );
  }

  const boxes = await getBoxesOfBill(repo, billDoc.document_id);
  const nextBoxNo = boxes.reduce((max, b) => Math.max(max, b.note.box_no), 0) + 1;

  // สร้าง record กล่องก่อน (ได้เลข BX จากตัวเลขเอกสาร พร้อม lock กันซ้ำ)
  const boxDoc = await repo.documents.create({
    document_type: "OUTBOUND_BOX",
    reference_no: billDoc.document_no,
    document_date: new Date().toISOString().slice(0, 10),
    status: "PROCESSING",
    note: JSON.stringify({
      kind: "outbound_box",
      box_status: "OPEN",
      bill_document_id: billDoc.document_id,
      bill_document_no: billDoc.document_no,
      box_no: nextBoxNo,
      items: [],
    }),
    created_by: actor.id,
    created_by_name: actor.username,
  });

  // บิล → PACKING (กล่องแรก) และจด box id ลงบิล
  await mutateBillNote(repo, billDoc.document_id, (n) => {
    if (n.outbound_status === "READY_TO_PACK" || n.outbound_status === "PACKING") {
      if (n.outbound_status === "READY_TO_PACK") {
        assertBillTransition(n.outbound_status, "PACKING");
        n.outbound_status = "PACKING";
      }
    } else {
      throw new Error(`แพ็กได้เฉพาะบิลที่อนุมัติแล้ว (ปัจจุบัน: ${n.outbound_status})`);
    }
    if (!n.box_document_ids.includes(boxDoc.document_id)) {
      n.box_document_ids.push(boxDoc.document_id);
    }
  }, { alsoStatus: billStatusToDocumentStatus("PACKING") });

  return {
    document_id: boxDoc.document_id,
    document_no: boxDoc.document_no,
    box_no: nextBoxNo,
    box_status: "OPEN",
    items: [],
    total_qty: 0,
    sticker_printed: false,
  };
}

/**
 * สแกนสินค้าใส่กล่องปัจจุบัน — ต้องเป็นสินค้าในบิล + รวมแล้วไม่เกินที่หยิบมาได้
 * ถ้าครบทุกรายการหลังใส่กล่องนี้ → บิล PACKED อัตโนมัติ
 */
export async function scanItemIntoBox(
  repo: IStockRepository,
  billIdOrNo: string,
  input: { sku: string; qty: number },
  actor: Actor
): Promise<{
  box_no: number;
  box_document_no: string;
  sku: string;
  qty_in_boxes: number;
  qty_picked: number;
  bill_status: string;
}> {
  const billDoc = await findDocumentByIdOrNo(repo, billIdOrNo);
  if (!billDoc) throw new Error("ไม่พบบิลนี้");
  const billNote = parseBillNote(billDoc);
  if (!billNote) throw new Error("ข้อมูลบิลไม่ถูกต้อง");
  if (billNote.outbound_status !== "PACKING") {
    throw new Error(`บิลนี้ไม่ได้อยู่ในสถานะกำลังแพ็ก (ปัจจุบัน: ${billNote.outbound_status})`);
  }

  // หารายการบิลจากสิ่งที่สแกน (sku หรือ barcode)
  const key = cleanSku(input.sku);
  const scannedNorm = normalizeBarcode(input.sku);
  const item = billNote.items.find((it) => cleanSku(it.sku) === key) ??
    billNote.items.find((it) =>
      areBarcodesMatching(input.sku, [it.barcode, it.sku, it.product_id].filter(Boolean) as string[])
    );
  if (!item) {
    throw new Error(`สินค้าที่สแกนไม่อยู่ในบิลนี้ (${input.sku})`);
  }
  if (item.qty_picked <= 0) {
    throw new Error(`รายการ ${item.sku} ไม่ได้ถูกหยิบมา (หยิบได้ 0)`);
  }

  const openBox = await getOpenBox(repo, billDoc.document_id);
  if (!openBox) {
    throw new Error("ไม่มีกล่องที่เปิดอยู่ — กดเปิดกล่องใหม่ก่อน");
  }

  const packed = await getPackedQtyBySku(repo, billDoc.document_id);
  const alreadyPacked = packed.get(cleanSku(item.sku)) || 0;
  if (alreadyPacked + input.qty > item.qty_picked) {
    throw new Error(
      `เกินจำนวนที่หยิบมา — ${item.sku} หยิบได้ ${item.qty_picked} ลงกล่องไปแล้ว ${alreadyPacked} (สแกนเพิ่มอีก ${input.qty})`
    );
  }

  // แก้เฉพาะ record กล่องปัจจุบัน
  await mutateBoxNote(repo, openBox.doc.document_id, (n) => {
    const existing = n.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku));
    if (existing) existing.qty += input.qty;
    else n.items.push({ sku: item.sku, product_id: item.product_id, qty: input.qty });
  });

  // เช็คครบทุกรายการ → PACKED
  const packedNow = await getPackedQtyBySku(repo, billDoc.document_id);
  const allBoxed = billNote.items.every(
    (it) => it.qty_picked === 0 || (packedNow.get(cleanSku(it.sku)) || 0) >= it.qty_picked
  );
  let billStatus: string = billNote.outbound_status;
  if (allBoxed) {
    const result = await mutateBillNote(repo, billDoc.document_id, (n) => {
      assertBillTransition(n.outbound_status, "PACKED");
      n.outbound_status = "PACKED";
      n.packed_at = new Date().toISOString();
    }, { alsoStatus: billStatusToDocumentStatus("PACKED") });
    if (result) billStatus = result.note.outbound_status;
  }

  return {
    box_no: openBox.note.box_no,
    box_document_no: openBox.doc.document_no,
    sku: item.sku,
    qty_in_boxes: alreadyPacked + input.qty,
    qty_picked: item.qty_picked,
    bill_status: billStatus,
  };
}

/** ปิดกล่องปัจจุบัน — กล่อง CLOSED พร้อมพิมพ์สติกเกอร์ (สติกเกอร์ไม่มี m ณ จุดนี้) */
export async function closeBox(
  repo: IStockRepository,
  billIdOrNo: string,
  actor: Actor
): Promise<{ box_document_no: string; box_no: number; total_qty: number }> {
  const billDoc = await findDocumentByIdOrNo(repo, billIdOrNo);
  if (!billDoc) throw new Error("ไม่พบบิลนี้");
  const billNote = parseBillNote(billDoc);
  if (!billNote) throw new Error("ข้อมูลบิลไม่ถูกต้อง");
  if (billNote.outbound_status !== "PACKING") {
    throw new Error(`บิลนี้ไม่ได้อยู่ในสถานะกำลังแพ็ก (ปัจจุบัน: ${billNote.outbound_status})`);
  }

  const openBox = await getOpenBox(repo, billDoc.document_id);
  if (!openBox) throw new Error("ไม่มีกล่องที่เปิดอยู่");
  if (openBox.note.items.length === 0) {
    throw new Error("กล่องนี้ยังว่างเปล่า — สแกนของใส่ก่อนปิดกล่อง (หรือยกเลิกกล่อง)");
  }

  const result = await mutateBoxNote(repo, openBox.doc.document_id, (n) => {
    assertBoxTransition(n.box_status, "CLOSED");
    n.box_status = "CLOSED";
  });
  if (!result) throw new Error("ปิดกล่องไม่สำเร็จ");
  void actor;

  return {
    box_document_no: result.doc.document_no,
    box_no: result.note.box_no,
    total_qty: result.note.items.reduce((s, it) => s + it.qty, 0),
  };
}

/** ยกเลิกกล่องเปล่า/กล่องที่ยัง OPEN อยู่ (ใส่ผิดบิล ฯลฯ) */
export async function cancelOpenBox(
  repo: IStockRepository,
  billIdOrNo: string,
  actor: Actor,
  reason?: string
): Promise<void> {
  const billDoc = await findDocumentByIdOrNo(repo, billIdOrNo);
  if (!billDoc) throw new Error("ไม่พบบิลนี้");
  const openBox = await getOpenBox(repo, billDoc.document_id);
  if (!openBox) throw new Error("ไม่มีกล่องที่เปิดอยู่");
  if (openBox.note.items.length > 0) {
    throw new Error("กล่องมีของอยู่ — ห้ามยกเลิก ให้แจ้งหัวหน้า (ของติดค้างใน record กล่อง)");
  }
  await mutateBoxNote(repo, openBox.doc.document_id, (n) => {
    assertBoxTransition(n.box_status, "CANCELLED");
    n.box_status = "CANCELLED";
    n.cancel_reason = reason || "ยกเลิกกล่องเปล่า";
    n.cancelled_by = actor.username;
    n.cancelled_at = new Date().toISOString();
  });
}

export async function markStickerPrinted(
  repo: IStockRepository,
  boxIdOrNo: string
): Promise<void> {
  const result = await mutateBoxNote(repo, boxIdOrNo, (n) => {
    if (!n.sticker_printed_at) n.sticker_printed_at = new Date().toISOString();
  });
  if (!result) throw new Error("ไม่พบกล่องนี้");
}

/** ข้อมูลกล่องทั้งหมดของบิล (ใช้พิมพ์สติกเกอร์ชุด n/m หลัง PACKED) */
export async function getBoxesOfBillInfo(
  repo: IStockRepository,
  billIdOrNo: string
): Promise<Array<BoxInfo & { bill_document_no: string }>> {
  const billDoc = await findDocumentByIdOrNo(repo, billIdOrNo);
  if (!billDoc) throw new Error("ไม่พบบิลนี้");
  const boxes = await getBoxesOfBill(repo, billDoc.document_id);
  return boxes
    .filter((b) => b.note.box_status !== "CANCELLED")
    .map(({ doc, note }) => ({
      document_id: doc.document_id,
      document_no: doc.document_no,
      box_no: note.box_no,
      box_status: note.box_status,
      items: note.items.map((it) => ({ sku: it.sku, qty: it.qty })),
      total_qty: note.items.reduce((s, it) => s + it.qty, 0),
      sticker_printed: Boolean(note.sticker_printed_at),
      bill_document_no: note.bill_document_no,
    }));
}
