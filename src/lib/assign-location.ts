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

/** แบ่งจำนวนแถวเป็นย้ายจาก "ไม่ระบุ" + เพิ่มส่วนเกิน (ADJUST) */
export function splitAssignQty(qty: number, available: number): { move: number; adjust: number } {
  const avail = Math.max(0, available);
  const move = Math.min(qty, avail);
  return { move, adjust: qty - move };
}

/** ตรวจแถวก่อนบันทึก — คืนข้อความผิดพลาด (ว่าง = ผ่าน). อนุญาตให้รวมเกินยอด "ไม่ระบุ" */
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
