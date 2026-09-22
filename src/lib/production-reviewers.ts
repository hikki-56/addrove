// รายชื่อ "คนตรวจ" ที่เป็นคนยืนยันผลตรวจการผลิตและตัดสต็อก
// จับคู่ด้วย local-part ของอีเมล / อีเมลเต็ม / ชื่อ-นามสกุล (lowercase) เหมือนกลไก RESTRICTED_ADMIN_MENUS
// เพิ่มคน = เติมชื่อในลิสต์นี้ได้เลย

export const PRODUCTION_REVIEWER_MATCH_NAMES = ["แก้", "kae", "milk", "มิลค์"];

export function isProductionReviewer(
  user?: { email?: string | null; name?: string | null } | null
): boolean {
  if (!user) return false;
  const email = (user.email || "").trim().toLowerCase();
  const name = (user.name || "").trim().toLowerCase();
  const localPart = email ? email.split("@")[0] : "";
  return PRODUCTION_REVIEWER_MATCH_NAMES.some(
    (n) => n === localPart || n === email || n === name
  );
}
