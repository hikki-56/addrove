import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/security/actor";
import type {
  OutboundBillItem,
  OutboundExceptionType,
  StockSummary,
} from "@/types/models";
import { areBarcodesMatching, normalizeBarcode } from "@/lib/barcode-utils";
import {
  findDocumentByIdOrNo,
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

function cleanSku(v: string): string {
  return v.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_#]/g, "");
}

/** หารายการในบิลจากสิ่งที่สแกน (sku ตรง หรือ ตรงกับ barcode ของสินค้า) */
export function findBillItemByScan(
  items: OutboundBillItem[],
  scanned: string
): OutboundBillItem | null {
  const key = cleanSku(scanned);
  // 1) SKU ตรง
  const bySku = items.find((it) => cleanSku(it.sku) === key);
  if (bySku) return bySku;
  // 2) barcode ตรง (สแกนบาร์โค้ดของสินค้า)
  const scannedNorm = normalizeBarcode(scanned);
  if (!scannedNorm) return null;
  for (const it of items) {
    const targets = [it.barcode, it.sku, it.product_id].filter(Boolean) as string[];
    if (areBarcodesMatching(scanned, targets)) return it;
  }
  return null;
}

/**
 * เริ่มหยิบ = RESERVE — ตรวจ Available ครบทุกรายการก่อน แล้ว:
 *  • ผูกบิลกับคนหยิบ (กันสองคนเปิดบิลเดียวกัน)
 *  • แนะนำตำแหน่งหยิบ (ตำแหน่งที่มีสต็อกมากสุดในคลัง) เก็บใน location_id
 *  • READY_TO_PICK → PICKING (บิลเข้าชุด "จองสต็อก" ทันที)
 */
export async function startPick(
  repo: IStockRepository,
  idOrNo: string,
  actor: Actor
): Promise<{ document_no: string }> {
  const doc = await findDocumentByIdOrNo(repo, idOrNo);
  if (!doc) throw new Error("ไม่พบบิลนี้");
  const note = parseBillNote(doc);
  if (!note) throw new Error("ข้อมูลบิลไม่ถูกต้อง");
  if (note.outbound_status === "PICKING" && note.pick_assigned_to && note.pick_assigned_to !== actor.id) {
    throw new Error(`บิลนี้กำลังถูกหยิบโดย ${note.pick_assigned_to_name || note.pick_assigned_to} อยู่`);
  }

  // ตรวจ Available ก่อนเปลี่ยนสถานะ (ไม่พอ → คง READY_TO_PICK พร้อมเหตุผล)
  await assertAvailableForPick(repo, note.warehouse_id, note);

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
      assertBillTransition(n.outbound_status, "PICKING", n.held_from);
      n.outbound_status = "PICKING";
      n.pick_assigned_to = actor.id;
      n.pick_assigned_to_name = actor.username;
      n.pick_started_at = new Date().toISOString();
      // แนะนำตำแหน่งหยิบเฉพาะรายการที่ยังไม่มี location_id
      // (คลังของบิลก่อน ถ้าไม่มีสต็อกค่อยไล่คลังอื่น/สำนักงานใหญ่)
      for (const item of n.items) {
        if (item.location_id) continue;
        const sug = item.product_id
          ? suggestPickLocationAll(summaries, n.warehouse_id, item.product_id)
          : null;
        if (sug) {
          item.location_id = sug.location_id;
          item.location_wh = sug.warehouse_id;
        }
      }
    },
    { alsoStatus: billStatusToDocumentStatus("PICKING") }
  );
  if (!result) throw new Error("ไม่พบบิลนี้");
  return { document_no: result.doc.document_no };
}

export interface ConfirmPickItemInput {
  sku: string; // สิ่งที่สแกน (sku หรือ barcode)
  qty: number;
  location_id?: string;
}

/**
 * ยืนยันหยิบ 1 รายการ — สแกนต้องตรงกับรายการในบิล และจำนวนห้ามเกินที่บิลกำหนด
 * คนงานลดจำนวนเองไม่ได้ ถ้าหยิบได้น้อยกว่าต้องแจ้งผ่าน report-problem
 */
export async function confirmPickItem(
  repo: IStockRepository,
  idOrNo: string,
  input: ConfirmPickItemInput,
  actor: Actor
): Promise<{
  sku: string;
  qty_picked: number;
  qty_required: number;
  item_status: string;
}> {
  const doc = await findDocumentByIdOrNo(repo, idOrNo);
  if (!doc) throw new Error("ไม่พบบิลนี้");
  const note = parseBillNote(doc);
  if (!note) throw new Error("ข้อมูลบิลไม่ถูกต้อง");
  if (note.outbound_status !== "PICKING") {
    throw new Error(`บิลนี้ไม่ได้อยู่ในสถานะกำลังหยิบ (ปัจจุบัน: ${note.outbound_status})`);
  }

  const item = findBillItemByScan(note.items, input.sku);
  if (!item) {
    throw new Error(`สินค้าที่สแกนไม่อยู่ในบิลนี้ (${input.sku})`);
  }
  const remaining = item.qty_required - item.qty_picked;
  if (remaining <= 0) {
    throw new Error(`รายการ ${item.sku} หยิบครบแล้ว`);
  }
  if (input.qty > remaining) {
    throw new Error(`จำนวนเกินที่บิลกำหนด — เหลือต้องหยิบอีก ${remaining} (สแกนมา ${input.qty})`);
  }
  if (input.qty < remaining) {
    throw new Error(
      `จำนวนไม่ครบ — ต้องหยิบ ${remaining} ชิ้น ถ้ามีไม่พอให้กดปุ่ม ⚠️ แจ้งหัวหน้า (ห้ามยืนยัน ${input.qty} ชิ้นเอง)`
    );
  }

  const result = await mutateBillNote(repo, doc.document_id, (n) => {
    const target = n.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku));
    if (!target) throw new Error("ไม่พบรายการ");
    target.qty_picked += input.qty;
    target.status = "PICKED";
    if (input.location_id) target.location_id = input.location_id;
  });
  if (!result) throw new Error("บันทึกไม่สำเร็จ");

  const updated = result.note.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku))!;
  return {
    sku: updated.sku,
    qty_picked: updated.qty_picked,
    qty_required: updated.qty_required,
    item_status: updated.status,
  };
}

export interface ReportProblemInput {
  sku: string;
  problem: OutboundExceptionType;
  picked_qty?: number;
  note?: string;
}

/**
 * คนงานแจ้งปัญหา (หาไม่เจอ/ไม่ครบ/ชำรุด/บาร์โค้ดเสีย/อื่นๆ)
 * บันทึก exception + ระบุจำนวนที่หยิบได้จริง (ถ้ามี) — คนงานแก้จำนวนบิลเองไม่ได้
 * หัวหน้า/แอดมินใช้ resolve-shortage ตัดสินต่อ
 */
export async function reportProblem(
  repo: IStockRepository,
  idOrNo: string,
  input: ReportProblemInput,
  actor: Actor
): Promise<{ bill_status: string }> {
  const doc = await findDocumentByIdOrNo(repo, idOrNo);
  if (!doc) throw new Error("ไม่พบบิลนี้");
  const note = parseBillNote(doc);
  if (!note) throw new Error("ข้อมูลบิลไม่ถูกต้อง");
  if (note.outbound_status !== "PICKING") {
    throw new Error(`บิลนี้ไม่ได้อยู่ในสถานะกำลังหยิบ (ปัจจุบัน: ${note.outbound_status})`);
  }

  const item = findBillItemByScan(note.items, input.sku);
  if (!item) throw new Error(`สินค้าที่ระบุไม่อยู่ในบิลนี้ (${input.sku})`);
  if (typeof input.picked_qty === "number" && (input.picked_qty < 0 || input.picked_qty > item.qty_required)) {
    throw new Error(`จำนวนที่หยิบได้ต้องอยู่ระหว่าง 0–${item.qty_required}`);
  }

  const result = await mutateBillNote(repo, doc.document_id, (n) => {
    const target = n.items.find((it) => cleanSku(it.sku) === cleanSku(item.sku));
    if (!target) throw new Error("ไม่พบรายการ");
    if (typeof input.picked_qty === "number") {
      target.qty_picked = Math.max(target.qty_picked, input.picked_qty);
    }
    target.status = "PROBLEM";

    n.exceptions.push({
      type: input.problem,
      sku: target.sku,
      reported_qty: input.picked_qty,
      note: input.note,
      reported_by: actor.id,
      reported_by_name: actor.username,
      reported_at: new Date().toISOString(),
    });

    // ถ้าทุกรายการที่เหลือถูกแจ้งปัญหาแล้ว → บิลเข้าสถานะ SHORTAGE ให้หัวหน้าตัดสินทันที
    const pendingNormal = n.items.some(
      (it) => it.status !== "PROBLEM" && it.status !== "PICKED" && it.qty_picked < it.qty_required
    );
    if (!pendingNormal) {
      assertBillTransition(n.outbound_status, "SHORTAGE");
      n.outbound_status = "SHORTAGE";
    }
  });

  if (!result) throw new Error("บันทึกไม่สำเร็จ");
  if (result.note.outbound_status === "SHORTAGE") {
    await repo.documents.updateStatus(result.doc.document_id, billStatusToDocumentStatus("SHORTAGE"));
  }
  return { bill_status: result.note.outbound_status };
}

/**
 * จบการหยิบ — ถ้าครบทุกรายการ → PICKED_WAITING_APPROVAL (รอแอดมินอนุมัติบิล)
 * ถ้ายังไม่ครบ → SHORTAGE (บังคับให้หัวหน้าตัดสิน ไม่ให้ปล่อยผ่าน)
 */
export async function completePick(
  repo: IStockRepository,
  idOrNo: string,
  actor: Actor
): Promise<{ bill_status: string; message: string }> {
  const doc = await findDocumentByIdOrNo(repo, idOrNo);
  if (!doc) throw new Error("ไม่พบบิลนี้");
  const note = parseBillNote(doc);
  if (!note) throw new Error("ข้อมูลบิลไม่ถูกต้อง");
  if (note.outbound_status !== "PICKING") {
    throw new Error(`บิลนี้ไม่ได้อยู่ในสถานะกำลังหยิบ (ปัจจุบัน: ${note.outbound_status})`);
  }

  const incomplete = note.items.filter((it) => it.qty_picked < it.qty_required);

  if (incomplete.length > 0) {
    await mutateBillNote(repo, doc.document_id, (n) => {
      assertBillTransition(n.outbound_status, "SHORTAGE");
      n.outbound_status = "SHORTAGE";
    });
    await repo.documents.updateStatus(doc.document_id, billStatusToDocumentStatus("SHORTAGE"));
    return {
      bill_status: "SHORTAGE",
      message: `ยังมี ${incomplete.length} รายการไม่ครบ — บิลเข้าสถานะของไม่ครบรอหัวหน้าตัดสิน`,
    };
  }

  const result = await mutateBillNote(repo, doc.document_id, (n) => {
    assertBillTransition(n.outbound_status, "PICKED_WAITING_APPROVAL");
    n.outbound_status = "PICKED_WAITING_APPROVAL";
    n.pick_completed_at = new Date().toISOString();
  }, { alsoStatus: billStatusToDocumentStatus("PICKED_WAITING_APPROVAL") });
  if (!result) throw new Error("บันทึกไม่สำเร็จ");
  void actor;

  return {
    bill_status: "PICKED_WAITING_APPROVAL",
    message: "หยิบครบทุกรายการ — รอแอดมินอนุมัติบิล",
  };
}
