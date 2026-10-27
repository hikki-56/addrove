// เมนู "ระบุตำแหน่งสินค้า" — สิทธิ์ใช้ร่วมกันทั้ง client และ server
import type { UserRole } from "@/types/models";

export const ASSIGN_LOCATION_HREF = "/movements/assign-location";
/** แอดมินบัญชีเดียวที่เห็นเมนูนี้ (แอดมินอื่นถูกปฏิเสธ 403) */
export const ASSIGN_LOCATION_ADMIN_EMAIL = "ty@stockify.com";

/** พนักงานทุกบทบาท (ยกเว้น VIEWER) ใช้ได้; ADMIN ใช้ได้เฉพาะ ty@stockify.com */
export function canAssignLocation(role?: UserRole | string | null, email?: string | null): boolean {
  if (!role || role === "VIEWER") return false;
  if (role === "ADMIN") {
    return typeof email === "string" && email.trim().toLowerCase() === ASSIGN_LOCATION_ADMIN_EMAIL;
  }
  return true;
}

export interface AssignRow {
  to_location_id: string;
  qty: number;
}

/** ส่วนต่างที่ต้อง ADJUST เพื่อตั้งยอดตำแหน่ง = จำนวนที่นับ − ยอดปัจจุบัน (0 = ไม่ต้องบันทึก) */
export function assignAdjustDelta(entered: number, current: number): number {
  return entered - current;
}

export interface SnapshotCurrent {
  location_key: string; // location_code upper หรือ location_id
  location_id: string;
  quantity: number;
}

export interface SnapshotTarget {
  location_id: string;
  location_key: string;
  target: number;
  current: number;
  delta: number;
}

/**
 * สแนปช็อตโกดัง: ตำแหน่งที่กรอก = ยอดที่กรอก, ตำแหน่งอื่นของสินค้าในโกดังเดียวกัน (รวมไม่ระบุ) = 0
 */
export function buildAssignSnapshot(
  rows: AssignRow[],
  currents: SnapshotCurrent[]
): SnapshotTarget[] {
  const entered = new Map<string, number>();
  for (const r of rows) {
    const key = r.to_location_id.trim().toUpperCase();
    if (key) entered.set(key, r.qty);
  }
  const byKey = new Map<string, SnapshotCurrent>();
  for (const c of currents) {
    const key = (c.location_key || c.location_id).trim().toUpperCase();
    byKey.set(key, c);
    byKey.set(c.location_id.trim().toUpperCase(), c);
  }
  const out = new Map<string, SnapshotTarget>();
  // ตำแหน่งที่มียอดอยู่แล้ว → ตั้งตามที่กรอก หรือ 0
  for (const c of currents) {
    const key = (c.location_key || "").trim().toUpperCase() || c.location_id.trim().toUpperCase();
    const target = entered.has(key) ? entered.get(key)! : entered.has(c.location_id.trim().toUpperCase()) ? entered.get(c.location_id.trim().toUpperCase())! : 0;
    const delta = assignAdjustDelta(target, c.quantity);
    out.set(c.location_id, { location_id: c.location_id, location_key: key, target, current: c.quantity, delta });
  }
  // ตำแหน่งที่กรอกแต่ยังไม่มีใน summary
  for (const [key, qty] of entered) {
    const existing = byKey.get(key);
    if (existing) continue;
    out.set(key, { location_id: key, location_key: key, target: qty, current: 0, delta: qty });
  }
  return [...out.values()];
}

/** ตรวจแถวก่อนบันทึก — คืนข้อความผิดพลาด (ว่าง = ผ่าน). จำนวน = ยอดที่ตั้งที่ตำแหน่งนั้น */
export function validateAssignRows(rows: AssignRow[]): string[] {
  const errors: string[] = [];
  if (!rows.length) errors.push("กรุณาเพิ่มตำแหน่งอย่างน้อย 1 รายการ");
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const code = r.to_location_id.trim().toUpperCase();
    if (!code) errors.push(`แถวที่ ${i + 1}: กรุณาระบุตำแหน่ง`);
    else if (seen.has(code)) errors.push(`แถวที่ ${i + 1}: ตำแหน่ง ${code} ซ้ำ`);
    seen.add(code);
    if (!Number.isInteger(r.qty) || r.qty <= 0) errors.push(`แถวที่ ${i + 1}: จำนวนต้องเป็นจำนวนเต็มมากกว่า 0`);
  });
  return errors;
}
