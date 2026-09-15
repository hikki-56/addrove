import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { BillQAssignment, OutboundBillStatus } from "@/types/models";
import {
  listBillDocuments,
  listWorkOrderDocuments,
  parseBillNote,
} from "./outbound-documents";

// ============================================================
// การจัดกล่อง Q ของบิล Express — จัดให้อัตโนมัติตอนนำเข้า
// กติกา (สเปกเจ้าของระบบ):
//  1. รายการของบิลเดียวกันต้องอยู่ด้วยกันเป็นกลุ่มติด ๆ ห้ามกระจาย
//  2. กล่อง Q ละไม่เกิน MAX รายการ (ค่าเริ่มต้น 5 — เปลี่ยนได้ในอนาคต)
//  3. ใช้เฉพาะรหัสกล่อง Q ที่ว่าง (ไม่ติดงานอื่น) เท่านั้น
//  4. เป็นข้อมูลกำกับสำหรับจัดของ — ไม่เปลี่ยนขั้นตอนการหยิบของบิล
// ============================================================

/** จำนวนรายการสูงสุดต่อกล่อง Q 1 กล่อง (แก้ค่านี้เพื่อเปลี่ยนกฎในอนาคต) */
export const DEFAULT_MAX_ITEMS_PER_Q = 5;
export const MAX_ITEMS_PER_Q_LIMIT = 50;

/** สถานะใบงาน Q ที่ถือว่ากล่องยัง "ติดงาน" */
const WO_BUSY_STATUSES = new Set(["DRAFT", "READY_TO_PICK", "PICKING", "SHORTAGE"]);

/**
 * สถานะบิล Express ที่ถือว่ากล่อง Q ยังถูกใช้อยู่ —
 * ปล่อยกล่องเมื่อของถูกแพ็กลงกล่อง BX จริง (PACKED) หรือยกเลิก
 */
const BILL_BUSY_STATUSES = new Set<OutboundBillStatus>([
  "IMPORTED",
  "READY_TO_PICK",
  "PICKING",
  "SHORTAGE",
  "PICKED_WAITING_APPROVAL",
  "READY_TO_PACK",
  "PACKING",
  // PACKED / SHIPPED / PARTIALLY_SHIPPED / CANCELLED / HOLD → ว่าง
  // HOLD ปล่อยให้ว่างเพื่อไม่ให้กล่องค้างตลอดไป (งานพักรอตัดสิน)
]);

export interface BusyQItemProduct {
  sku: string;
  product_name?: string;
  barcode?: string;
  qty: number;
  qty_picked?: number;
  status?: string;
  location?: string;
}

export interface BusyQInfo {
  document_id: string;
  document_no: string;
  document_type?: "WORK_ORDER" | "BILL";
  customer?: string;
  outbound_status?: string;
  items?: BusyQItemProduct[];
}

/**
 * รหัสกล่อง Q ที่กำลังติดงานอยู่ทั้งระบบ (ทั้งใบงาน Q และบิล Express ที่มีการแบ่ง Q)
 * ใช้เป็น source of truth เดียวให้ทั้งการสร้างใบงาน Q และการแบ่ง Q ตอนนำเข้าบิล
 */
export async function getBusyQCodes(repo: IStockRepository): Promise<Map<string, BusyQInfo>> {
  const busy = new Map<string, BusyQInfo>();
  const [woDocs, billDocs] = await Promise.all([
    listWorkOrderDocuments(repo),
    listBillDocuments(repo),
  ]);

  for (const doc of woDocs) {
    const note = parseBillNote(doc);
    if (!note || note.source !== "WORK_ORDER" || !Array.isArray(note.q_boxes)) continue;
    if (!WO_BUSY_STATUSES.has(note.outbound_status)) continue;
    for (const q of note.q_boxes) {
      if (q.status === "DONE") continue; // กล่องหยิบเสร็จแล้ว = ว่าง
      if (!busy.has(q.q_code)) {
        busy.set(q.q_code, {
          document_id: doc.document_id,
          document_no: doc.document_no,
          document_type: "WORK_ORDER",
          customer: note.customer,
          outbound_status: note.outbound_status,
          items: (q.items || []).map((it) => ({
            sku: it.sku,
            product_name: it.product_name,
            barcode: it.barcode,
            qty: it.qty_required,
            qty_picked: it.qty_picked,
            status: it.status,
            location: it.location_id,
          })),
        });
      }
    }
  }

  for (const doc of billDocs) {
    const note = parseBillNote(doc);
    if (!note || !Array.isArray(note.q_assignments) || note.q_assignments.length === 0) continue;
    if (!BILL_BUSY_STATUSES.has(note.outbound_status)) continue;
    for (const q of note.q_assignments) {
      if (!busy.has(q.q_code)) {
        const itemsMap = new Map<string, typeof note.items[0]>();
        for (const it of note.items || []) {
          itemsMap.set(it.sku, it);
        }
        const items: BusyQItemProduct[] = (q.items || []).map((qItem) => {
          const detail = itemsMap.get(qItem.sku);
          return {
            sku: qItem.sku,
            product_name: detail?.product_name,
            barcode: detail?.barcode,
            qty: qItem.qty,
            qty_picked: detail?.qty_picked,
            status: detail?.status,
            location: detail?.location_hint || detail?.location_id,
          };
        });

        busy.set(q.q_code, {
          document_id: doc.document_id,
          document_no: doc.document_no,
          document_type: "BILL",
          customer: note.customer,
          outbound_status: note.outbound_status,
          items,
        });
      }
    }
  }

  return busy;
}

/** หารหัสกล่อง Q ถัดไปที่ว่าง (Q1, Q2, … เรียงขึ้น ข้ามตัวที่ติดงาน) */
export function nextFreeQCode(busy: Map<string, BusyQInfo>): string {
  for (let n = 1; n <= 999; n++) {
    const code = `Q${n}`;
    if (!busy.has(code)) return code;
  }
  throw new Error("รหัสกล่อง Q เต็ม (Q1–Q999) — กรุณาปิดงานเก่าก่อน");
}

/** แปลงค่ารายการสูงสุดต่อกล่องจาก request → ตัวเลขที่ปลอดภัย */
export function parseMaxItemsPerQ(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_ITEMS_PER_Q;
  return Math.min(n, MAX_ITEMS_PER_Q_LIMIT);
}

/**
 * แบ่งรายการของ "บิลเดียว" ลงกล่อง Q — รายการเรียงติดกันตามลำดับเดิม
 * (บิลเดียวกันอยู่ด้วยกันเสมอ แบ่งต่อเมื่อเกินจำนวนสูงสุดต่อกล่อง)
 * รหัสที่จัดไปแล้วจะถูก mark ว่า busy ใน map ทันที — เรียกต่อ ๆ กันหลายบิลจะไม่ชนกัน
 */
export function planBillQAssignments(
  items: Array<{ sku: string; qty: number }>,
  busy: Map<string, BusyQInfo>,
  maxPerQ: number
): BillQAssignment[] {
  const assignments: BillQAssignment[] = [];
  let current: BillQAssignment | null = null;

  for (const it of items) {
    if (!current || current.items.length >= maxPerQ) {
      current = { q_code: nextFreeQCode(busy), items: [] };
      assignments.push(current);
      busy.set(current.q_code, { document_id: "(new)", document_no: "(กำลังจัดสรร)" });
    }
    current.items.push({ sku: it.sku, qty: it.qty });
  }
  return assignments;
}
