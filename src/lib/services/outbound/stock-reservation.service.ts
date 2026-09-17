import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { OutboundBillNote, StockSummary } from "@/types/models";
import { isBillReserving } from "./outbound-state-machine";
import { listBillDocuments, parseBillNote } from "./outbound-documents";

/**
 * Stock Reservation — จองสต็อกเมื่อเริ่มหยิบ เพื่อกันสองบิลถูกส่งไปหยิบ
 * สินค้าชุดเดิมพร้อมกันจนเกินของที่มีจริง
 *
 *   On Hand   = ยอดจาก StockSummary (เปลี่ยนเมื่ออนุมัติเท่านั้น)
 *   Reserved  = ผลรวม qty_required ของบิลที่อยู่ในสถานะจอง
 *               (PICKING / SHORTAGE / PICKED_WAITING_APPROVAL)
 *   Available = On Hand − Reserved
 *
 * ไม่มีการเขียนสต็อกจริงจนกว่าแอดมินจะอนุมัติบิล (issueStock)
 * ยกเลิกบิล = ออกจากชุดจอง → Reserved คืนโดยอัตโนมัติ
 */

export class OutboundReservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundReservationError";
  }
}

export interface ReservedEntry {
  sku: string;
  product_id: string;
  qty: number;
  bill_document_id: string;
  bill_document_no: string;
  express_bill_no: string;
}

/** Reserved รวมตาม product_id ของบิลที่ยังจองอยู่ทั้งหมด (ทุกคลัง) */
export async function getReservedEntries(repo: IStockRepository): Promise<ReservedEntry[]> {
  const docs = await listBillDocuments(repo);
  const entries: ReservedEntry[] = [];
  for (const doc of docs) {
    const note = parseBillNote(doc);
    if (!note || !isBillReserving(note.outbound_status)) continue;
    // ใบงานกล่อง Q (WORK_ORDER) ตัดสต็อกจริงตั้งแต่กดส่งใบงาน (issueStock) —
    // On Hand ลดไปแล้ว ห้ามนับยอดที่เหลือเป็น "จอง" ซ้ำ ไม่งั้น Available จะติดลบ/เป็น 0 ทั้งที่ของมีจริง
    if (note.source === "WORK_ORDER") continue;
    for (const item of note.items) {
      if (item.status === "PICKED") continue; // หยิบและยืนยันแล้ว นับเป็นของบิลนี้แน่นอน
      if (!item.product_id || item.qty_required <= 0) continue;
      entries.push({
        sku: item.sku,
        product_id: item.product_id,
        qty: item.qty_required - item.qty_picked,
        bill_document_id: doc.document_id,
        bill_document_no: doc.document_no,
        express_bill_no: note.express_bill_no,
      });
    }
  }
  return entries.filter((e) => e.qty > 0);
}

export interface AvailabilityRow {
  sku: string;
  product_id: string;
  on_hand: number;
  reserved: number;
  available: number;
  requested?: number;
  short?: number; // ขาดเท่าไร (available - requested)
}

function summarizeOnHand(summaries: StockSummary[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of summaries) {
    if (!s?.product_id) continue;
    map.set(s.product_id, (map.get(s.product_id) || 0) + (Number(s.quantity) || 0));
  }
  return map;
}

/**
 * คำนวณ On Hand / Reserved / Available ของรายการสินค้าที่สนใจ
 * options.allWarehouses = true → รวม On Hand จากทุกคลัง + สำนักงานใหญ่ (wh-01..wh-06)
 * (ใช้ในหน้าบิล หน้าคิวหยิบ และหน้าพรีวิวนำเข้า)
 */
export async function getAvailability(
  repo: IStockRepository,
  warehouseId: string,
  items: Array<{ sku: string; product_id?: string; qty?: number }>,
  options?: { excludeBillId?: string; allWarehouses?: boolean }
): Promise<AvailabilityRow[]> {
  const [summaries, reservedEntries] = await Promise.all([
    repo.stockSummary.findAll(options?.allWarehouses ? undefined : warehouseId),
    getReservedEntries(repo),
  ]);
  const onHand = summarizeOnHand(summaries);

  const reservedByProduct = new Map<string, number>();
  for (const e of reservedEntries) {
    if (options?.excludeBillId && e.bill_document_id === options.excludeBillId) continue;
    reservedByProduct.set(e.product_id, (reservedByProduct.get(e.product_id) || 0) + e.qty);
  }

  return items.map((it) => {
    const pid = it.product_id || "";
    const on_hand = onHand.get(pid) ?? 0;
    const reserved = reservedByProduct.get(pid) ?? 0;
    const available = on_hand - reserved;
    const row: AvailabilityRow = {
      sku: it.sku,
      product_id: pid,
      on_hand,
      reserved,
      available,
    };
    if (typeof it.qty === "number") {
      row.requested = it.qty;
      row.short = available - it.qty;
    }
    return row;
  });
}

/**
 * ตรวจก่อนเริ่มหยิบ (RESERVE) — ถ้ามีรายการไหน Available < ที่บิลต้องการ
 * จะ throw พร้อมรายละเอียด ไม่ให้เปิดงานหยิบ (บิลอยู่ READY_TO_PICK ต่อ)
 * นับ On Hand รวมทุกคลัง + สำนักงานใหญ่ (ของอยู่คลังไหนก็นับได้หมด)
 */
export async function assertAvailableForPick(
  repo: IStockRepository,
  warehouseId: string,
  note: OutboundBillNote
): Promise<AvailabilityRow[]> {
  const items = note.items
    .filter((it) => it.status !== "PICKED" && it.qty_required > it.qty_picked)
    .map((it) => ({ sku: it.sku, product_id: it.product_id, qty: it.qty_required - it.qty_picked }));
  if (items.length === 0) return [];

  const unlinked = items.filter((it) => !it.product_id?.trim());
  if (unlinked.length > 0) {
    throw new OutboundReservationError(
      `รายการในบิลยังไม่ได้เชื่อมกับสินค้าในระบบ: ${unlinked.map((it) => it.sku).join(", ")} — ให้แอดมินตรวจสอบรหัสสินค้าก่อนเริ่มหยิบ`
    );
  }

  // บิลนี้ยังไม่ถูกนับเป็น "จอง" (สถานะ READY_TO_PICK) จึงไม่ต้อง exclude ตัวเอง
  const rows = await getAvailability(repo, warehouseId, items, { allWarehouses: true });
  const shortRows = rows.filter((r) => (r.short ?? 0) < 0);
  if (shortRows.length > 0) {
    const detail = shortRows
      .map(
        (r) =>
          `${r.sku}: ต้องการ ${r.requested} แต่ Available ${r.available} (มีรวมทุกคลัง ${r.on_hand} ถูกจอง ${r.reserved})`
      )
      .join("; ");
    throw new OutboundReservationError(
      `สต็อกไม่พอสำหรับหยิบบิลนี้ (รวมทุกคลัง + สำนักงานใหญ่) — ${detail}`
    );
  }
  return rows;
}

/** ตำแหน่งที่แนะนำให้หยิบ: ตำแหน่งในคลังที่มีสต็อกมากสุดของสินค้านั้น */
export function suggestPickLocation(
  summaries: StockSummary[],
  warehouseId: string,
  productId: string
): { location_id: string; quantity: number } | null {
  let best: { location_id: string; quantity: number } | null = null;
  for (const s of summaries) {
    if (s.product_id !== productId || s.warehouse_id !== warehouseId) continue;
    const qty = Number(s.quantity) || 0;
    if (qty <= 0) continue;
    if (!best || qty > best.quantity) best = { location_id: s.location_id, quantity: qty };
  }
  return best;
}

/**
 * ตำแหน่งที่แนะนำให้หยิบแบบรวมทุกคลัง: ชอบคลังของบิลเองก่อน (เดินใกล้สุด)
 * ถ้าคลังของบิลไม่มีสต็อกเลย ไล่หาตำแหน่งที่มีสต็อกมากสุดจากคลังอื่น/สำนักงานใหญ่
 * คืน warehouse_id ของตำแหน่งนั้นด้วยเพื่อใช้ตอนตัดสต็อก
 */
export function suggestPickLocationAll(
  summaries: StockSummary[],
  preferredWarehouseId: string,
  productId: string
): { warehouse_id: string; location_id: string; quantity: number } | null {
  let best: { warehouse_id: string; location_id: string; quantity: number } | null = null;
  // รอบแรก: ในคลังของบิลเอง — ถ้าเจอใช้เลย
  for (const s of summaries) {
    if (s.product_id !== productId || s.warehouse_id !== preferredWarehouseId) continue;
    const qty = Number(s.quantity) || 0;
    if (qty <= 0) continue;
    if (!best || qty > best.quantity) best = { warehouse_id: s.warehouse_id, location_id: s.location_id, quantity: qty };
  }
  if (best) return best;
  // รอบสอง: คลังอื่นทั้งหมด (รวมสำนักงานใหญ่)
  for (const s of summaries) {
    if (s.product_id !== productId || s.warehouse_id === preferredWarehouseId) continue;
    const qty = Number(s.quantity) || 0;
    if (qty <= 0) continue;
    if (!best || qty > best.quantity) best = { warehouse_id: s.warehouse_id, location_id: s.location_id, quantity: qty };
  }
  return best;
}
