// ประเภทข้อมูลระบบการผลิต — ใช้ร่วมกันระหว่าง API และหน้า UI
// (เดิมถูกประกาศซ้ำใน orders/route.ts และ history/page.tsx)

export type ProductionOrderStatus = "COMPLETED" | "IN_PROGRESS" | "PENDING" | "CANCELLED";

export interface ProductionMaterialItem {
  rm_sku: string;
  rm_barcode?: string;
  rm_name: string;
  rm_wh: string;
  rm_qty_required: number;
  rm_unit: string;
  waste_percentage?: number;
  note?: string;
}

export interface ProductionOrderItem {
  fg_sku: string;
  fg_barcode: string;
  fg_name: string;
  fg_unit: string;
  /** โต๊ะผลิตที่รับผิดชอบรายการนี้ (1–5) */
  table_no?: number;
  /** จำนวนที่สั่งผลิตตามใบผลิต */
  quantity: number;
  /** สะสมของดีที่ตรวจรับแล้ว (จากทุกรอบการตรวจ) */
  produced_qty?: number;
  /** สะสมของเสีย (จากทุกรอบการตรวจ) */
  defect_qty?: number;
  image?: string;
  target_warehouse_id: string;
  target_warehouse_name: string;
  materials: ProductionMaterialItem[];
}

/** ผลตรวจของสินค้าหนึ่งรายการในรอบการตรวจ */
export interface InspectionItemResult {
  fg_sku: string;
  fg_name: string;
  good_qty: number;
  defect_qty: number;
  warehouse_id: string;
  warehouse_name: string;
  location: string;
}

/** วัตถุดิบที่รายงานว่าใช้จริง/เสียจริงในรอบการตรวจหนึ่งรอบ */
export interface InspectionMaterialResult {
  rm_sku: string;
  rm_name: string;
  used_qty: number;
  wasted_qty: number;
}

/** สถานะรอบการตรวจ: ส่งแล้วรอคนตรวจ → อนุมัติ (ตัดสต็อกแล้ว) หรือ ถูกตีกลับให้แก้ไข */
export type InspectionRoundStatus = "SUBMITTED" | "APPROVED" | "RETURNED";

/** รอบการตรวจการผลิตหนึ่งรอบของใบผลิต */
export interface InspectionRound {
  round_no: number;
  inspected_at: string;
  inspected_by: string;
  inspected_by_name: string;
  note?: string;
  items: InspectionItemResult[];
  status?: InspectionRoundStatus;
  reviewed_by_name?: string;
  reviewed_at?: string;
  review_note?: string;
  /** ผู้รายงานขอปิดใบผลิตหลังรอบนี้ */
  close_order?: boolean;
  /** วัตถุดิบที่ผู้รายงานระบุว่าใช้จริง/เสียจริงในรอบนี้ (ไม่ส่งมา = ให้ระบบคำนวณจาก BOM ตอนยืนยัน) */
  materials?: InspectionMaterialResult[];
  /** ปลายทางเศษวัตถุดิบที่ผู้รายงานเสนอ (ใช้เมื่อปิดใบ) */
  leftover_destination?: { warehouse_id: string; warehouse_name?: string; location: string } | null;
}

/** สรุปวัตถุดิบรวมต่อใบผลิต (แผน vs ใช้จริง) */
export interface OrderMaterialSummary {
  rm_sku: string;
  rm_name: string;
  rm_unit: string;
  planned_qty: number;
  used_qty: number;
  /** วัตถุดิบที่เสียจริง (แยกจากใช้จริง) */
  wasted_qty?: number;
  leftover_qty: number;
}

export interface ProductionOrderRecord {
  id: string;
  order_no: string;
  document_id: string;
  reference_no?: string;
  status: ProductionOrderStatus;
  items: ProductionOrderItem[];
  total_fg_qty: number;
  total_materials_count: number;
  created_by: string;
  created_by_name: string;
  created_at: string;
  document_date: string;
  note?: string;
  /** ประวัติรอบการตรวจ (ระบบใบผลิตใหม่เท่านั้น) */
  inspections?: InspectionRound[];
  /** สรุปวัตถุดิบแบบรวมต่อใบ (ระบบใบผลิตใหม่เท่านั้น) */
  materials_summary?: OrderMaterialSummary[];
  /** ปลายทางเศษวัตถุดิบคงเหลือ กรอกตอนปิดใบผลิต */
  leftover_destination?: { warehouse_id: string; warehouse_name?: string; location: string } | null;
}

/** รายการของเสียจากแท็บ "สินค้าเสีย" */
export interface WasteRecord {
  waste_id: string;
  order_no: string;
  round_no: number;
  document_date: string;
  fg_sku: string;
  fg_name: string;
  qty: number;
  note: string;
  recorded_by_name: string;
  created_at: string;
}

/** Payload ต่อรายการที่ส่งมากับการยืนยันผลผลิตหนึ่งรอบ */
export interface InspectItemPayload {
  fg_sku: string;
  good_qty: number;
  defect_qty: number;
  warehouse_id?: string;
  location?: string;
}

/** Payload วัตถุดิบที่ใช้จริง/เสียจริงต่อรอบ (ไม่ส่ง = ระบบคำนวณจาก BOM) */
export interface InspectMaterialPayload {
  rm_sku: string;
  used_qty: number;
  wasted_qty?: number;
}

// ---- โครงสร้างคอลัมน์ของแท็บชีตใหม่ (index = ตำแหน่งคอลัมน์) ----
// ใช้เป็นสัญญาเดียวกันทั้งฝั่งเขียน (API) และฝั่งอ่าน เพื่อกัน index ไม่ตรงกัน

/** แท็บ "ใบผลิต" — หนึ่งแถวต่อใบ × รายการสินค้า */
export const PRODUCTION_ORDER_SHEET_HEADERS = [
  "เลขที่ใบผลิต",
  "document_id",
  "วันที่สั่งผลิต",
  "สถานะ",
  "รหัสสินค้า",
  "ชื่อสินค้า",
  "หน่วย",
  "ที่สั่งผลิต",
  "ผลิตได้จริง",
  "ของเสีย",
  "ผู้สั่งผลิต",
  "สร้างเมื่อ",
  "หมายเหตุ",
  "เศษวัตถุดิบไปโกดัง",
  "เศษวัตถุดิบตำแหน่ง",
  "โต๊ะผลิต",
] as const;

/** แท็บ "ใบผลิต_วัตถุดิบ" — หนึ่งแถวต่อใบ × วัตถุดิบ (รวมยอดทั้งใบ) */
export const PRODUCTION_MATERIAL_SHEET_HEADERS = [
  "เลขที่ใบผลิต",
  "รหัสวัตถุดิบ",
  "ชื่อวัตถุดิบ",
  "หน่วย",
  "ตามแผน",
  "ใช้จริง",
  "คงเหลือตามแผน",
  "อัปเดตเมื่อ",
  "เสียจริง",
] as const;

/** แท็บ "ตรวจการผลิต" — บันทึกต่อรอบ × รายการสินค้า (append-only) */
export const PRODUCTION_INSPECTION_SHEET_HEADERS = [
  "เลขที่ใบผลิต",
  "รอบที่",
  "วันที่ส่งผลตรวจ",
  "รหัสสินค้า",
  "ของดี",
  "ของเสีย",
  "ปลายทางโกดัง",
  "ตำแหน่ง",
  "ผู้รายงาน",
  "หมายเหตุผู้รายงาน",
  "สถานะรอบ",
  "ผู้ยืนยัน",
  "ยืนยันเมื่อ",
  "หมายเหตุผู้ตรวจ",
  "ขอปิดใบผลิต",
  "เศษวัตถุดิบไปโกดัง",
  "เศษวัตถุดิบตำแหน่ง",
  "วัตถุดิบใช้จริง/เสียจริง (JSON)",
] as const;

/** แท็บ "สินค้าเสีย" — append-only */
export const WASTE_SHEET_HEADERS = [
  "waste_id",
  "เลขที่ใบผลิต",
  "รอบที่",
  "วันที่",
  "รหัสสินค้า",
  "ชื่อสินค้า",
  "จำนวน",
  "หมายเหตุ",
  "ผู้บันทึก",
  "บันทึกเมื่อ",
] as const;
