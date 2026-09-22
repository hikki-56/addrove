// ตัวช่วยกลางสำหรับกลุ่มฟีเจอร์ "เข้า Express" (รับ/เบิก/ย้าย สินค้าเข้า Express)
// ใช้ร่วมกันทั้งฝั่ง API routes และหน้าเว็บ — ห้าม import โมดูลที่ผูก server หรือ client

export type ExpressSyncStatusValue = "PENDING" | "IMPORTED";

export const EXPRESS_STATUS_TEXT: Record<ExpressSyncStatusValue, string> = {
  IMPORTED: "นำเข้า Express แล้ว",
  PENDING: "รอนำเข้า Express",
};

/**
 * คีย์ระดับ "รายการ" (เลขที่เอกสาร + SKU) ของสถานะ Express
 * สถานะต้องคุมระดับรายการเท่านั้น — เดิมคุมระดับเอกสารทำให้เอกสาร 1 ใบหลาย SKU
 * กด "นำเข้าแล้ว" ทีละรายการไม่ได้ และสถานะเก่าของเลขเอกสารเดียวกันรั่วไปทับรายการใหม่
 */
export function cleanExpressCode(str?: string | null): string {
  if (!str) return "";
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/^prod-/, "")
    .replace(/[\s\-_#]/g, "");
}

export function expressItemKey(
  docNo: string | null | undefined,
  sku: string | null | undefined
): string {
  return `${cleanExpressCode(docNo)}|${cleanExpressCode(sku)}`;
}

/**
 * แยกเลขเอกสารที่ต่อกันหลายตัว เช่น "ISS-20260901-000001, ISS-20260901-000002"
 * (outbound approve เขียน issue_document_no รวมหลายเลข) — ใช้ match แถวชีตและหาเอกสารทุกตัว
 */
export function splitDocNumbers(docNo: string | null | undefined): string[] {
  return String(docNo || "")
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** รวมทุก variant ของเลขเอกสารที่ใช้หาแถว/เอกสารได้ (ตัวเอง + ชิ้นที่ต่อกันด้วยจุลภาค) */
export function docNoVariants(docNo: string | null | undefined): string[] {
  const raw = String(docNo || "").trim();
  if (!raw) return [];
  const variants = new Set<string>([raw]);
  splitDocNumbers(raw).forEach((part) => variants.add(part));
  return Array.from(variants);
}

/**
 * แปลงข้อความสถานะในชีตเป็น PENDING/IMPORTED
 * "รอนำเข้า" ต้องชนะเสมอ (เช็คก่อนคำว่า "แล้ว") — เดิมเช็ค "แล้ว" ก่อน
 * ทำให้ข้อความใด ๆ ที่มี "แล้ว" ปนอยู่ถูกตีความเป็นนำเข้าแล้วทั้งหมด
 */
export function parseExpressStatusText(text: string | null | undefined): ExpressSyncStatusValue | null {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("รอนำเข้า") || t.includes("รอเข้า") || t.includes("pending")) return "PENDING";
  if (t.includes("นำเข้า") || t.includes("แล้ว") || t.includes("imported") || t.includes("สำเร็จ")) return "IMPORTED";
  return null;
}

/** ค่าสถานะจาก body/note ให้อยู่ในสองค่ามาตรฐานเสมอ */
export function normalizeExpressStatusValue(value: unknown): ExpressSyncStatusValue {
  return parseExpressStatusText(typeof value === "string" ? value : "") === "IMPORTED"
    ? "IMPORTED"
    : "PENDING";
}

/** สถานะระดับเอกสาร = IMPORTED เฉพาะเมื่อทุกรายการ IMPORTED (ใช้เป็น aggregate ใน note เท่านั้น) */
export function aggregateDocStatus(statuses: ExpressSyncStatusValue[]): ExpressSyncStatusValue {
  if (statuses.length === 0) return "PENDING";
  return statuses.every((s) => s === "IMPORTED") ? "IMPORTED" : "PENDING";
}

/**
 * วันที่ (YYYY-MM-DD) ตามเวลาประเทศไทย — ทุกจุดที่เขียน "วันที่เอกสาร" ลงชีตต้องใช้ตัวนี้
 * เดิมใช้ new Date().toISOString() (UTC) ทำให้รายการช่วง 00:00–06:59 น. ของไทยตกเป็นวันก่อนหน้า
 * แล้วหลุดกรอง "วันนี้" ของหน้าเว็บ (ซึ่งคำนวณจาก local time)
 */
export function todayBangkokIsoDate(now: Date = new Date()): string {
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return bangkok.toISOString().slice(0, 10);
}

/**
 * ค่าที่จะเขียนลง Google Sheets ต้องไม่ขึ้นต้ว้อักขระสูตร (= + - @)
 * ชีตเขียนด้วย USER_ENTERED — ค่าที่ขึ้นต้น "=" จะถูกตีความเป็นสูตร
 */
export function sanitizeSheetValue(value: unknown): string {
  const s = String(value ?? "").trim();
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

/** ตรวจว่าคอลัมน์แรกของแถวเป็นวันที่จริง (layout B) — กัน SKU ที่มี "/" หรือ "-" โดนตีความเป็นวันที่ */
export function looksLikeSheetDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s);
}
