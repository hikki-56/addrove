/**
 *  Unit tests สำหรับ express-status-utils — กติกาสถานะระดับ "รายการ" ของกลุ่มเมนู Express
 *  (รับ/เบิก/ย้ายสินค้าเข้า Express)
 */
import {
  cleanExpressCode,
  expressItemKey,
  docNoVariants,
  splitDocNumbers,
  parseExpressStatusText,
  normalizeExpressStatusValue,
  aggregateDocStatus,
  todayBangkokIsoDate,
  sanitizeSheetValue,
  looksLikeSheetDate,
} from "@/lib/express-status-utils";

describe("express-status-utils", () => {
  describe("cleanExpressCode / expressItemKey", () => {
    it("normalize ค่าเหมือนกันจากหลายรูปแบบให้เป็นคีย์เดียว", () => {
      expect(cleanExpressCode(" PROD-AB 123 ")).toBe(cleanExpressCode("ab123"));
      expect(cleanExpressCode("AB_123#")).toBe(cleanExpressCode("ab123"));
      expect(cleanExpressCode(undefined)).toBe("");
    });

    it("คีย์รายการแยก SKU ในเอกสารเดียวกันออกจากกัน", () => {
      const keyA = expressItemKey("RCV-20260921-000001", "SKU-A");
      const keyB = expressItemKey("RCV-20260921-000001", "SKU-B");
      expect(keyA).not.toBe(keyB);
      // normalize ทั้งเลขเอกสารและ SKU — ค่าจากชีต/จาก UI ต้องได้คีย์เดียวกัน
      expect(expressItemKey("rcv20260921000001", "prod-sku-a")).toBe(keyA);
    });
  });

  describe("splitDocNumbers / docNoVariants", () => {
    it("แยกเลขเอกสารที่ต่อกันด้วยจุลภาค (outbound approve เขียนรวมหลายเลข)", () => {
      const parts = splitDocNumbers("ISS-20260901-000001, ISS-20260901-000002");
      expect(parts).toEqual(["ISS-20260901-000001", "ISS-20260901-000002"]);
    });

    it("variants รวมตัวเต็มและทุกชิ้น โดยชิ้นซ้ำไม่ถูกเก็บสองครั้ง", () => {
      const variants = docNoVariants("ISS-1, ISS-1");
      expect(variants).toEqual(["ISS-1, ISS-1", "ISS-1"]);
      expect(docNoVariants("")).toEqual([]);
    });
  });

  describe("parseExpressStatusText — 'รอนำเข้า' ต้องชนะเสมอ", () => {
    it("ข้อความรอนำเข้าเป็น PENDING แม้มีคำอื่นปน", () => {
      expect(parseExpressStatusText("รอนำเข้า Express")).toBe("PENDING");
      expect(parseExpressStatusText("PENDING")).toBe("PENDING");
      // เดิมเช็ค "แล้ว" ก่อน ทำให้ข้อความแบบนี้ถูกตีความเป็น IMPORTED
      expect(parseExpressStatusText("รอนำเข้า (แก้ไขแล้ว)")).toBe("PENDING");
    });

    it("ข้อความนำเข้าแล้วเป็น IMPORTED", () => {
      expect(parseExpressStatusText("นำเข้า Express แล้ว")).toBe("IMPORTED");
      expect(parseExpressStatusText("IMPORTED")).toBe("IMPORTED");
      expect(parseExpressStatusText("สำเร็จ")).toBe("IMPORTED");
    });

    it("ว่าง/ไม่รู้จัก → null (ให้ fallback ตัดสินต่อ)", () => {
      expect(parseExpressStatusText("")).toBeNull();
      expect(parseExpressStatusText("   ")).toBeNull();
      expect(parseExpressStatusText("hello")).toBeNull();
    });

    it("normalizeExpressStatusValue บังคับเหลือสองค่า", () => {
      expect(normalizeExpressStatusValue("IMPORTED")).toBe("IMPORTED");
      expect(normalizeExpressStatusValue("นำเข้า Express แล้ว")).toBe("IMPORTED");
      expect(normalizeExpressStatusValue("รอนำเข้า Express")).toBe("PENDING");
      expect(normalizeExpressStatusValue(null)).toBe("PENDING");
      expect(normalizeExpressStatusValue(42)).toBe("PENDING");
    });
  });

  describe("aggregateDocStatus", () => {
    it("IMPORTED เฉพาะเมื่อครบทุกรายการ", () => {
      expect(aggregateDocStatus(["IMPORTED", "IMPORTED"])).toBe("IMPORTED");
      expect(aggregateDocStatus(["IMPORTED", "PENDING"])).toBe("PENDING");
      expect(aggregateDocStatus([])).toBe("PENDING");
    });
  });

  describe("todayBangkokIsoDate", () => {
    it("วันที่ตามเวลาไทย ไม่ใช่ UTC — รายการก่อน 07:00 น. ต้องไม่ตกเป็นวันก่อนหน้า", () => {
      // 2026-09-21 01:00 น. กรุงเทพ = 2026-09-20 18:00 UTC
      expect(todayBangkokIsoDate(new Date("2026-09-20T18:00:00Z"))).toBe("2026-09-21");
      // 2026-09-21 06:59 น. กรุงเทพ = 2026-09-20 23:59 UTC
      expect(todayBangkokIsoDate(new Date("2026-09-20T23:59:00Z"))).toBe("2026-09-21");
      // 2026-09-21 07:00 น. กรุงเทพ = 2026-09-21 00:00 UTC
      expect(todayBangkokIsoDate(new Date("2026-09-21T00:00:00Z"))).toBe("2026-09-21");
    });
  });

  describe("sanitizeSheetValue — กัน formula injection (USER_ENTERED)", () => {
    it("ค่าขึ้นต้น = + - @ ต้องถูกหนีด้วย '", () => {
      expect(sanitizeSheetValue("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
      expect(sanitizeSheetValue("+1")).toBe("'+1");
      expect(sanitizeSheetValue("-5")).toBe("'-5");
      expect(sanitizeSheetValue("@cmd")).toBe("'@cmd");
    });

    it("ค่าปกติผ่านตรง ๆ (รวมตัวเลขลบที่อยู่กลางข้อความ)", () => {
      expect(sanitizeSheetValue("SKU-A")).toBe("SKU-A");
      expect(sanitizeSheetValue(" 123 ")).toBe("123");
      expect(sanitizeSheetValue("A-1")).toBe("A-1");
      expect(sanitizeSheetValue(undefined)).toBe("");
    });
  });

  describe("looksLikeSheetDate — แยก layout วันที่จาก SKU", () => {
    it("รับวันที่จริง", () => {
      expect(looksLikeSheetDate("2026-09-21")).toBe(true);
      expect(looksLikeSheetDate("2026-09-21T10:00:00Z")).toBe(true);
      expect(looksLikeSheetDate("21/9/2026")).toBe(true);
      expect(looksLikeSheetDate("9/21/26")).toBe(true);
    });

    it("ปฏิเสธ SKU หน้าตาคล้ายวันที่ — เดิม heuristic "/" หรือ "-" ทำให้อ่านเลื่อนทั้งแถว", () => {
      expect(looksLikeSheetDate("AB/123")).toBe(false);
      expect(looksLikeSheetDate("AB-123T")).toBe(false);
      expect(looksLikeSheetDate("RCV-2026")).toBe(false);
      expect(looksLikeSheetDate("SKU")).toBe(false);
    });
  });
});
