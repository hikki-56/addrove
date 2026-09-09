// ============================================================
// Unit Tests — count-up animation (src/hooks/use-count-up.ts)
// เลขหลักการ์ด KPI ต้องแสดงค่าปลายทางตรงกับ target เสมอหลังโหลดเสร็จ
// ทดสอบผ่าน pure function ที่ hook ใช้เขียนค่าลง DOM
// ============================================================
import { countUpDisplayValue } from "@/hooks/use-count-up";

describe("countUpDisplayValue — ค่าที่แสดงระหว่าง/หลัง count-up", () => {
  it("progress = 1 → ค่าปลายทางเท่ากับ target พอดี (ไม่ค้างที่ 0)", () => {
    expect(countUpDisplayValue(1234, 1)).toBe(1234);
    expect(countUpDisplayValue(0, 1)).toBe(0);
    expect(countUpDisplayValue(999999, 1)).toBe(999999);
  });

  it("progress = 0 → เริ่มที่ 0", () => {
    expect(countUpDisplayValue(500, 0)).toBe(0);
  });

  it("progress เกิน 1 หรือติดลบ → clamp ก่อนคำนวณ", () => {
    expect(countUpDisplayValue(500, 2)).toBe(500);
    expect(countUpDisplayValue(500, -1)).toBe(0);
    expect(countUpDisplayValue(500, Number.NaN)).toBe(0);
  });

  it("ค่าเพิ่มขึ้นต่อเนื่อง (monotonic) ตาม progress", () => {
    let previous = countUpDisplayValue(1000, 0);
    for (let i = 1; i <= 20; i++) {
      const current = countUpDisplayValue(1000, i / 20);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
    expect(previous).toBe(1000);
  });

  it("target ติดลบ — ค่าปลายทางยังตรงตามจริง", () => {
    expect(countUpDisplayValue(-15, 1)).toBe(-15);
    expect(countUpDisplayValue(-15, 0)).toBe(0);
  });

  it("target ทศนิยมปัดเป็นจำนวนเต็มตอนแสดงผล", () => {
    expect(countUpDisplayValue(12.6, 1)).toBe(13);
    expect(countUpDisplayValue(12.4, 1)).toBe(12);
  });
});
