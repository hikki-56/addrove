// ตรวจ/แปลงจำนวนของระบบผลิต — ทศนิยมไม่เกิน 2 ตำแหน่ง (กติกาเดียวกับ schema ฝั่งเซิร์ฟเวอร์)
// ใช้การนับตำแหน่งทศนิยมจากข้อความแทน `Math.round(v*100) === v*100`
// (สูตรเดิมผิดกับเลขทศนิยมฐานสองหลายตัว เช่น 2.3*100 = 229.99999999999997, 1.15, 0.29, 4.35)
// หมายเหตุ: กติกาจำนวนเต็ม/ทศนิยมตามหน่วยสินค้ายังไม่มีใน API — รอ contract (phase ถัดไป)

export const MAX_QTY_DECIMALS = 2;

/** รูปแบบตัวเลขที่ผู้ใช้พิมพ์ได้: 12 · 12.5 · 12. · .5 (ไม่รับ ติดลบ / e-notation / คอมมา / ช่องว่างกลางเลข) */
const QTY_TEXT_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** จำนวนตำแหน่งทศนิยมของตัวเลข (นับจาก repr แบบสั้นที่สุดของ JS — รองรับรูป 1e-7 / 1.5e-8) */
export function countDecimals(value: number | string): number {
  const text = typeof value === "number" ? String(value) : value.trim();
  const m = /^[+-]?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m) return Number.NaN;
  const fraction = (m[2] || "").replace(/0+$/, "");
  const exp = m[3] ? parseInt(m[3], 10) : 0;
  return Math.max(0, fraction.length - exp);
}

/** true เมื่อมีทศนิยมไม่เกิน `places` ตำแหน่ง (เลขไม่ finite/ข้อความไม่ใช่ตัวเลข → false) */
export function hasAtMostDecimals(value: number | string, places: number = MAX_QTY_DECIMALS): boolean {
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  const d = countDecimals(value);
  return Number.isFinite(d) && d <= places;
}

export const QTY_MESSAGES = {
  notNumber: "กรุณากรอกจำนวนเป็นตัวเลข (ไม่ติดลบ ไม่ใส่คอมมา)",
  tooManyDecimals: `จำนวนรับทศนิยมได้ไม่เกิน ${MAX_QTY_DECIMALS} ตำแหน่ง`,
  mustBePositive: "จำนวนต้องมากกว่า 0",
  required: "กรุณากรอกจำนวน",
} as const;

export type QtyParseResult =
  | { ok: true; value: number; empty: boolean }
  | { ok: false; error: string; empty: boolean };

export interface ParseQtyOptions {
  /** ช่องว่าง = 0 (ค่าเริ่มต้น true) · false = ต้องกรอก */
  allowEmpty?: boolean;
  /** รับ 0 ได้ (ค่าเริ่มต้น true) · false = ต้องมากกว่า 0 */
  allowZero?: boolean;
}

/** แปลงข้อความจากช่องกรอกเป็นจำนวน — ไม่ปัดเศษเงียบ ๆ; ผิดกติกาคืน error ภาษาไทย */
export function parseQtyInput(text: string, options: ParseQtyOptions = {}): QtyParseResult {
  const { allowEmpty = true, allowZero = true } = options;
  const t = (text ?? "").trim();
  if (t === "") {
    return allowEmpty ? { ok: true, value: 0, empty: true } : { ok: false, error: QTY_MESSAGES.required, empty: true };
  }
  if (!QTY_TEXT_RE.test(t)) return { ok: false, error: QTY_MESSAGES.notNumber, empty: false };
  if (!hasAtMostDecimals(t)) return { ok: false, error: QTY_MESSAGES.tooManyDecimals, empty: false };
  const value = Number(t);
  if (!Number.isFinite(value)) return { ok: false, error: QTY_MESSAGES.notNumber, empty: false };
  if (!allowZero && value <= 0) return { ok: false, error: QTY_MESSAGES.mustBePositive, empty: false };
  return { ok: true, value, empty: false };
}

/** ปัดผลบวก/ลบของจำนวนที่ผ่านการตรวจแล้วให้เหลือ 2 ตำแหน่ง (กันเศษ floating point เช่น 0.1+0.2) */
export function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
