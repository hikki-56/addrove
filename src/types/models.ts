// ============================================================
// Domain Models — Stockify Warehouse Management System
// ============================================================

export type WarehouseId = string;
export type LocationId = string;
export type ProductId = string;
export type DocumentId = string;
export type MovementId = string;
export type UserId = string;
export type StockCountId = string;

// ------ Warehouse ------
export interface Warehouse {
  warehouse_id: WarehouseId;
  warehouse_code: string;
  warehouse_name: string;
  address: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type ShelfId = string;

// ------ Location ------
export interface Location {
  location_id: LocationId;
  warehouse_id: WarehouseId;
  location_code: string;
  location_name?: string;
  shelf_code?: string;
  shelf_name?: string;
  zone?: string;
  aisle?: string;
  rack?: string;
  shelf?: string;
  bin?: string;
  description?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ------ Shelf ------
export interface Shelf {
  shelf_id: ShelfId;
  location_id: LocationId;
  shelf_code: string;
  shelf_name: string;
  shelf_level: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ------ Product ------
export interface Product {
  product_id: ProductId;
  sku: string;
  barcode: string;
  product_name: string;
  category: string;
  base_unit: string;
  minimum_stock: number;
  quantity?: number;
  total_quantity?: number;
  stock_status?: "NORMAL" | "LOW" | "OUT" | "NEGATIVE";
  locations_breakdown?: Array<{
    warehouse_id: string;
    warehouse_name: string;
    location: string;
    quantity: number;
  }>;
  description: string;
  supplier?: string;
  location?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  created_by_name?: string;
}

// ------ Document ------
export type DocumentType =
  | "OPENING"
  | "RECEIVE"
  | "RECEIVE_PLAN"
  | "ISSUE"
  | "MOVE"
  | "TRANSFER"
  | "ADJUST"
  | "REVERSAL"
  | "OUTBOUND_ORDER"
  | "OUTBOUND_BOX"
  | "SHIPMENT"
  | "WORK_ORDER";

export type DocumentStatus = "DRAFT" | "PENDING" | "PROCESSING" | "WAITING_APPROVAL" | "POSTED" | "COMPLETED" | "REJECTED" | "CANCELLED";

export interface Document {
  document_id: DocumentId;
  document_no: string;
  document_type: DocumentType;
  reference_no: string;
  document_date: string;
  status: DocumentStatus;
  note: string;
  created_by: UserId;
  created_by_name?: string;
  created_at: string;
  assigned_to_user_id?: UserId;
  assigned_to_name?: string;
  assigned_by_user_id?: UserId;
}

// ------ StockMovement ------
export type MovementType =
  | "RECEIVE"
  | "ISSUE"
  | "ISSUE_OUT"
  | "MOVE_OUT"
  | "MOVE_IN"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "ADJUST"
  | "OPENING"
  | "REVERSAL";

export interface StockMovement {
  movement_id: MovementId;
  document_id: DocumentId;
  product_id: ProductId;
  warehouse_id: WarehouseId;
  location_id: LocationId;
  qty_change: number; // positive = in, negative = out
  movement_type: MovementType;
  idempotency_key: string;
  created_by: UserId;
  created_at: string;
}

// ------ StockSummary ------
export interface StockSummary {
  product_id: ProductId;
  warehouse_id: WarehouseId;
  location_id: LocationId;
  quantity: number;
  last_updated: string;
}

// ------ StockCount ------
export type StockCountStatus =
  | "PENDING"
  | "COUNTED"
  | "APPROVED"
  | "REJECTED";

export interface StockCount {
  count_id: StockCountId;
  count_no: string;
  product_id: ProductId;
  warehouse_id: WarehouseId;
  location_id: LocationId;
  system_qty: number;
  counted_qty: number | null;
  difference: number | null;
  status: StockCountStatus;
  counted_by: UserId | null;
  counted_at: string | null;
  approved_by: UserId | null;
  approved_at: string | null;
}

// ------ User ------
export type UserRole = "ADMIN" | "MANAGER" | "APPROVER" | "WAREHOUSE_STAFF" | "PACKER" | "STAFF" | "VIEWER";

export interface User {
  user_id: UserId;
  full_name: string;
  email: string;
  password_hash: string;
  pin_hash: string;          // bcrypt hash of 4-digit PIN for QR login (empty = not set)
  role: UserRole;
  warehouse_access: string; // JSON array of warehouse_ids, or "*" for all
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ------ Derived / View Types ------
export interface StockBalance {
  product_id: ProductId;
  sku: string;
  product_name: string;
  base_unit: string;
  minimum_stock: number;
  total_quantity: number;
  status: "NORMAL" | "LOW" | "OUT" | "NEGATIVE";
  by_warehouse: {
    warehouse_id: WarehouseId;
    warehouse_name: string;
    quantity: number;
    by_location: {
      location_id: LocationId;
      location_code: string;
      quantity: number;
    }[];
  }[];
}

export interface MovementWithDetails extends StockMovement {
  document_no: string;
  document_type: DocumentType;
  product_name: string;
  sku: string;
  warehouse_name: string;
  location_code: string;
  created_by_name: string;
}

export interface WarehouseDistribution {
  warehouse_id: string;
  warehouse_name: string;
  quantity: number;
}

export interface DashboardChartPoint {
  date: string;
  received: number;
  issued: number;
  produced: number;
}

export type TodayActivityType =
  | "RECEIVE"
  | "ISSUE"
  | "TRANSFER"
  | "PRODUCTION"
  | "ADJUST";

export interface TodayActivity {
  id: string;
  actor_id: string;
  actor_name: string;
  action_type: TodayActivityType;
  action_label: string;
  document_id?: string;
  document_no?: string;
  product_name?: string;
  quantity: number;
  unit: string;
  warehouse_name?: string;
  created_at: string;
}

export interface DashboardStats {
  total_sku: number;
  // ผลรวมคอลัมน์ "จำนวนคงเหลือ" จากชีตรายโกดังทั้ง 6 แท็บ (หน่วย: ชิ้น)
  // คนละความหมายกับ total_sku ที่เป็นจำนวนรหัสสินค้าไม่ซ้ำ
  total_remaining_quantity: number;
  total_quantity: number;
  low_stock_count: number;
  out_of_stock_count: number;
  received_today: number;
  received_document_count_today: number;
  issued_today: number;
  issued_document_count_today: number;
  produced_today: number;
  production_order_count_today: number;
  warehouse_distribution: WarehouseDistribution[];
  today_activities: TodayActivity[];
  pending_approval_count: number;
  recent_movements: MovementWithDetails[];
  chart_data: DashboardChartPoint[];
}

// ------ LoginLog ------
export interface LoginLog {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: UserRole;
  login_method: "PASSWORD" | "QR_CODE";
  login_at: string;
  ip_address?: string;
  user_agent?: string;
}

// ------ BOM (Bill of Materials) ------
export interface BomItem {
  bom_id: string;
  fg_sku: string;
  fg_barcode: string;
  fg_name: string;
  fg_unit: string;
  base_qty: number;
  rm_sku: string;
  rm_barcode: string;
  rm_name: string;
  rm_wh: string;
  is_primary?: number; // 1 = ตัวหลัก, 0 = ตัวรอง
  rm_qty_required: number;
  rm_unit: string;
  waste_percentage: number;
  note: string;
  active: boolean;
  updated_at: string;
}

export interface BomFormula {
  bom_id: string;
  fg_sku: string;
  fg_barcode: string;
  fg_name: string;
  fg_unit: string;
  base_qty: number;
  active: boolean;
  updated_at: string;
  items: Array<{
    rm_sku: string;
    rm_barcode: string;
    rm_name: string;
    rm_wh: string;
    is_primary?: number; // 1 = ตัวหลัก, 0 = ตัวรอง
    rm_qty_required: number;
    rm_unit: string;
    waste_percentage: number;
    note: string;
  }>;
}

// ============================================================
// Outbound (ส่งของออก): บิลจาก Express → หยิบ → แพ็กกล่อง → ขึ้นรถ
// ทุก entity เป็น record ในแท็บ Documents (type OUTBOUND_ORDER /
// OUTBOUND_BOX / SHIPMENT) — ข้อมูลละเอียดอยู่ใน note (JSON)
// ============================================================

// ---- สถานะของบิล (state machine คุมโดย API เท่านั้น) ----
export type OutboundBillStatus =
  | "DRAFT"                    // ใบงาน Q ที่ Admin สร้างไว้ยังไม่ส่ง (ยังไม่ตัดสต็อก)
  | "IMPORTED"                 // นำเข้าจากไฟล์แล้ว ยังไม่เปิดงานหยิบ
  | "READY_TO_PICK"            // พร้อมหยิบ (ยังไม่จองสต็อก)
  | "PICKING"                  // กำลังหยิบ (สต็อกถูกจองแล้ว)
  | "PICKED_WAITING_APPROVAL"  // หยิบครบ รอแอดมินอนุมัติบิล (ยืนยันแล้วตัดสต็อก)
  | "READY_TO_PACK"            // อนุมัติแล้ว สต็อกถูกตัด พร้อมแพ็ก
  | "PACKING"                  // กำลังแพ็กใส่กล่อง
  | "PACKED"                   // ของอยู่ในกล่องครบทุกรายการ
  | "ASSIGNED_TO_SHIPMENT"     // ถูกเลือกเข้ารอบรถแล้ว
  | "LOADING"                  // รอบรถกำลังสแกนกล่องขึ้นรถ
  | "SHIPPED"                  // ขึ้นรถครบทุกกล่องและปิดรอบแล้ว
  | "PARTIALLY_SHIPPED"        // ขึ้นรถบางกล่อง ที่เหลือรอ rollover ไปรอบถัดไป
  | "HOLD"                     // มีปัญหาระหว่างทาง รอหัวหน้า/แอดมินสั่งต่อ
  | "SHORTAGE"                 // ของไม่ครบระหว่างหยิบ รอแอดมินตัดสิน
  | "CANCELLED";               // ยกเลิก (ปล่อยการจองสต็อกอัตโนมัติ)

export type OutboundBoxStatus =
  | "OPEN"       // กำลังรับของเข้ากล่องอยู่
  | "CLOSED"     // ปิดกล่องแล้ว (มีบาร์โค้ด พิมพ์สติกเกอร์ได้)
  | "LOADED"     // สแกนขึ้นรถแล้ว
  | "SHIPPED"    // รอบรถปิดแล้ว กล่องนี้ออกจริง
  | "ROLLOVER"   // ปิดรอบโดยกล่องนี้ยังไม่ขึ้นรถ → กลับคิวรอขึ้นรอบถัดไป
  | "CANCELLED"; // ยืนยันไม่ส่งจริง (Manager + เหตุผล)

export type ShipmentStatus =
  | "OPEN"      // สร้างรอบ เลือกบิลแล้ว ยังไม่เริ่มสแกน
  | "LOADING"   // กำลังสแกนกล่องขึ้นรถ
  | "CLOSED"    // ปิดรอบแล้ว (กล่องครบ = SHIPPED / ขาด = ROLLOVER)
  | "CANCELLED";

export type OutboundItemStatus = "PENDING" | "PICKED" | "PROBLEM";

export type OutboundExceptionType =
  | "NOT_FOUND"     // หาไม่เจอ
  | "INSUFFICIENT"  // จำนวนไม่ครบ
  | "DAMAGED"       // สินค้าชำรุด
  | "BAD_BARCODE"   // บาร์โค้ดอ่านไม่ได้
  | "OTHER";        // อื่นๆ

export interface OutboundException {
  type: OutboundExceptionType;
  sku: string;
  reported_qty?: number;   // จำนวนที่หยิบได้จริง (ถ้ามี)
  note?: string;
  reported_by: string;
  reported_by_name?: string;
  reported_at: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution?: "REDUCE_QTY" | "CONTINUE" | "CANCEL";
}

export interface OutboundBillItem {
  sku: string;
  product_id?: string;
  barcode?: string;
  product_name?: string;
  qty_required: number;
  qty_picked: number;
  status: OutboundItemStatus;
  location_hint?: string;   // ตำแหน่งจากไฟล์ Express (ถ้ามี)
  location_id?: string;     // ตำแหน่งจริงที่เลือกหยิบ (จาก stock)
  location_wh?: string;     // คลังเจ้าของตำแหน่งที่หยิบ (อาจต่างจากคลังของบิล เมื่อหยิบข้ามคลัง/สำนักงานใหญ่)
}

export interface OutboundBillNote {
  kind: "outbound_bill";
  outbound_status: OutboundBillStatus;
  express_bill_no: string;
  customer?: string;
  warehouse_id: string;
  source_file?: string;
  imported_at?: string;
  imported_by?: string;
  items: OutboundBillItem[];
  pick_assigned_to?: string;
  pick_assigned_to_name?: string;
  pick_started_at?: string;
  pick_completed_at?: string;
  issue_document_id?: string;
  issue_document_no?: string;
  approved_by?: string;
  approved_at?: string;
  packed_at?: string;
  box_document_ids: string[];
  exceptions: OutboundException[];
  held_from?: OutboundBillStatus; // HOLD → กลับสู่สถานะเดิมเมื่อ resume
  hold_reason?: string;
  cancel_reason?: string;
  /** วันที่ส่งยอดบิลนี้เข้าแท็บ เบิกสินค้าเข้าExpress (กันส่งซ้ำข้ามรอบรถ) */
  express_synced_at?: string;
  /** ที่มาของบิล: ไฟล์ Express (default) หรือ ใบงานกล่อง Q ที่ Admin สร้าง */
  source?: "EXPRESS" | "WORK_ORDER";
  /** ใบงานกล่อง Q — รายการแยกตามกล่อง (items ด้านบนคือยอดรวมทุกกล่องเพื่อให้ขั้นแพ็ก/ขึ้นรถใช้ของเดิมได้) */
  q_boxes?: WorkOrderQBox[];
  /** การแบ่งกล่อง Q ของบิล Express (จัดให้อัตโนมัติตอนนำเข้า — ใช้อ้างอิงตอนจัดของ ไม่เปลี่ยนขั้นตอนการหยิบ) */
  q_assignments?: BillQAssignment[];
  /** ใคร/เมื่อไร่ที่กดส่งใบงาน Q (พร้อมตัดสต็อก) */
  sent_by?: string;
  sent_at?: string;
}

// ---- ใบงานกล่อง Q (WORK_ORDER) ----
// Admin กำหนดล่วงหน้าว่าแต่ละกล่อง Q (ป้ายถาวร เช่น Q1, Q2) ต้องมีสินค้าอะไร
// พนักงานเพียงสแกนกล่อง Q → หยิบตามรายการ → สแกนสินค้ายืนยันทีละชิ้น
export type WorkOrderQBoxStatus = "PENDING" | "PICKING" | "DONE";

export interface WorkOrderQItem {
  sku: string;
  product_id?: string;
  barcode?: string;
  product_name?: string;
  qty_required: number;
  qty_picked: number;
  status: OutboundItemStatus;
  location_id?: string; // ตำแหน่งจัดเก็บ (stamp ตอนส่งใบงาน)
  location_wh?: string; // คลังเจ้าของตำแหน่ง (อาจต่างจากคลังของใบงาน เมื่อหยิบข้ามคลัง/สำนักงานใหญ่)
}

export interface WorkOrderQBox {
  q_code: string; // รหัสกล่องถาวร เช่น Q1 (ห้ามซ้ำข้ามใบงานที่ยังไม่จบ)
  status: WorkOrderQBoxStatus;
  items: WorkOrderQItem[];
  picked_by?: string;
  picked_by_name?: string;
  started_at?: string;
  completed_at?: string;
}

/** การแบ่งกล่อง Q ของบิล Express — รายการของบิลถูกจัดกลุ่มลงกล่อง Q ล่วงหน้า */
export interface BillQAssignment {
  q_code: string;
  items: Array<{ sku: string; qty: number }>;
  status?: WorkOrderQBoxStatus;
  picked_by?: string;
  picked_by_name?: string;
  started_at?: string;
  completed_at?: string;
}

export interface OutboundBoxNote {
  kind: "outbound_box";
  box_status: OutboundBoxStatus;
  bill_document_id: string;
  bill_document_no: string;
  box_no: number;             // ลำดับกล่องในบิล (1, 2, 3, ...)
  items: Array<{ sku: string; product_id?: string; qty: number }>;
  sticker_printed_at?: string;
  shipment_id?: string;
  shipment_no?: string;
  loaded_at?: string;
  loaded_by?: string;
  rollover_count?: number;
  cancel_reason?: string;
  cancelled_by?: string;
  cancelled_at?: string;
}

export interface ShipmentSkipConfirmation {
  box_id: string;
  box_no: string;
  bill_no: string;
  action: "ROLLOVER" | "CANCELLED";
  reason: string;
  confirmed_by: string;
  confirmed_by_name?: string;
  confirmed_at: string;
}

export interface ShipmentNote {
  kind: "shipment";
  shipment_status: ShipmentStatus;
  truck_plate: string;
  destination?: string;
  bill_document_ids: string[];
  expected_box_ids: string[];
  loaded_box_ids: string[];
  created_by?: string;
  created_by_name?: string;
  created_at?: string;
  closed_at?: string;
  closed_by?: string;
  closed_by_name?: string;
  skip_confirmations: ShipmentSkipConfirmation[];
  cancel_reason?: string;
  /** วันที่ส่งยอดรอบนี้เข้าแท็บ เบิกสินค้าเข้าExpress */
  express_synced_at?: string;
}

