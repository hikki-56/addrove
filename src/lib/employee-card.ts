/**
 * บัตรบาร์โค้ดประจำตัวพนักงาน (สำหรับเข้าระบบหน้างาน)
 * รูปแบบ: EMP-<user_id>  เช่น  EMP-USR-07
 *
 * หลักความปลอดภัย: บาร์โค้ดบัตรเป็น "ตัวระบุตัวตน" (เหมือนชื่อผู้ใช้)
 * ไม่ใช่ความลับ — การเข้าระบบยังต้องใส่ PIN 4 หลักเสมอ (ผ่าน rate-limit
 * 5 ครั้ง/5 นาทีเหมือนช่องทางอื่น) สแกนบัตรเพียงอย่างเดียวเข้าระบบไม่ได้
 */

export const EMPLOYEE_CARD_PREFIX = "EMP-";

/** สร้างรหัสบัตรจาก user_id (ตัวพิมพ์ใหญ่ สำหรับพิมพ์บาร์โค้ด) */
export function employeeCardCode(userId: string): string {
  return `${EMPLOYEE_CARD_PREFIX}${String(userId || "").trim().toUpperCase()}`;
}

/**
 * แยก user_id จากสิ่งที่สแกนได้
 *  - "EMP-USR-07" (บัตร) → USR-07
 *  - "USR-07" (user_id ตรงๆ — ต้องขึ้นต้น USR- ตามธรรมเนียมของระบบเท่านั้น)
 * คืน null ถ้าไม่ใช่รูปแบบบัตร (กันเอา QR token / บาร์โค้ดกล่อง BX- / เลขเอกสารมาใช้)
 */
export function parseEmployeeCardCode(scanned: string): string | null {
  const raw = String(scanned || "").trim().toUpperCase();
  if (!raw) return null;

  if (raw.startsWith(EMPLOYEE_CARD_PREFIX)) {
    const userId = raw.slice(EMPLOYEE_CARD_PREFIX.length);
    if (!/^[A-Z0-9_-]{3,40}$/.test(userId)) return null;
    return userId;
  }

  // แบบไม่มี prefix: ยอมรับเฉพาะที่หน้าตาเป็น user_id ของระบบ (USR-…)
  if (/^USR-[A-Z0-9_-]{1,38}$/.test(raw)) return raw;
  return null;
}
