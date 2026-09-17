// ============================================================
// ตัดสต็อกชั่วคราว — shared types & constants (โกดัง2 เท่านั้น)
// ============================================================

export const TARGET_WAREHOUSE_ID = "wh-02";
export const TARGET_WAREHOUSE_NAME = "โกดัง2";

/** ทิศทางรายการ: CUT = ตัดออก, ADD = เพิ่มเข้า */
export type CutDirection = "CUT" | "ADD";

/** สินค้าในมุมมองรายโกดัง จาก /api/products?warehouse_id=wh-02 */
export interface WhProduct {
  product_id: string;
  sku: string;
  barcode: string;
  product_name: string;
  category: string;
  base_unit: string;
  quantity: number;
  location?: string;
}

/** ตัวเลือกเหตุผล — ทิศทาง เพิ่ม/ลด อนุมานจากตัวเลือกที่เลือก */
export const REASON_OPTIONS = [
  { value: "เพิ่มเพราะผลิต", label: "เพิ่มเพราะผลิต", direction: "ADD" as CutDirection },
  { value: "ลดเพราะเอาไปผลิต", label: "ลดเพราะเอาไปผลิต", direction: "CUT" as CutDirection },
  { value: "ลดเพราะสินค้าเสียหาย", label: "ลดเพราะสินค้าเสียหาย", direction: "CUT" as CutDirection },
];

export function directionForReason(reason: string): CutDirection {
  return REASON_OPTIONS.find((r) => r.value === reason)?.direction === "ADD" ? "ADD" : "CUT";
}

/** ประวัติการตัดสต็อก จาก /api/temporary-stock-cuts */
export interface TempStockCutRecord {
  id: string;
  cut_no: string;
  document_id: string;
  warehouse_id: string;
  warehouse_name: string;
  sku: string;
  barcode: string;
  product_name: string;
  quantity: number;
  stock_before: number;
  stock_after: number;
  reason: string;
  note: string;
  direction: CutDirection;
  created_by: string;
  created_by_name: string;
  created_at: string;
}

/** รายการในคิวรอตัดสต็อก (ยังไม่ได้ยืนยัน) */
export interface CutQueueItem {
  product: WhProduct;
  quantity: number;
  reason: string;
  note: string;
  direction: CutDirection;
}

/** ค้นหาสินค้าแบบ real-time จากชื่อ / รหัสสินค้า / บาร์โค้ด */
export function matchesProduct(p: WhProduct, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    p.product_name.toLowerCase().includes(q) ||
    p.sku.toLowerCase().includes(q) ||
    (p.barcode || "").toLowerCase().includes(q)
  );
}

export function formatQty(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("th-TH") : n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

/**
 * ชื่อสินค้าในชีตบางแถวขึ้นต้นด้วยเลขรายการเดิมติดกับ "#" เช่น
 * "0002#ถังหล่อลื่น...", "0038 #H-928-5ล้อ...", "0102.CO#..."
 * ตัดส่วนนั้นออกเพื่อแสดงเฉพาะชื่อ (ข้อมูลต้นทางไม่ถูกแก้)
 */
const ITEM_NO_PREFIX = /^\s*\d{1,6}(?:\.[A-Za-z]{1,4})?\s*#\s*/;

export function displayProductName(p: { product_name: string; sku?: string }): string {
  const raw = (p.product_name || "").trim();
  const cleaned = raw.replace(ITEM_NO_PREFIX, "").trim();
  return cleaned || raw || p.sku || "-";
}

export function formatDateTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  return `${date} • ${time}`;
}
