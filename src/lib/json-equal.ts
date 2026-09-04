/**
 * เทียบค่าสองตัวที่ parse มาจาก JSON ว่าเหมือนกันทุกค่าหรือไม่
 * ใช้เป็น guard ใน setState ระหว่าง polling — เมื่อข้อมูลจาก API ไม่เปลี่ยน
 * ให้คง state เดิม (reference เดิม) เพื่อข้ามการคำนวณ useMemo และ re-render ทั้งหน้า
 */
export function isSameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
