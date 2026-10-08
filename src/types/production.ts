// ประเภทข้อมูลระบบสั่งผลิตและรายงานผลผลิต (v2) — ใช้ร่วมกันระหว่าง API และหน้า UI
// หนึ่งงาน = หนึ่งใบสั่งผลิต = สินค้า 1 ชนิด × โต๊ะผลิต 1 โต๊ะ (ติดตามผลได้ชัดเจน)

export type ProductionJobStatus = "DRAFT" | "WAITING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type ProductionPriority = "NORMAL" | "URGENT" | "CRITICAL";

/** รายงานผล: บางส่วน (คงสถานะกำลังผลิต) หรือจบงาน */
export type ProductionReportKind = "PARTIAL" | "FINAL";

/** ชนิดแถวในแท็บรายงาน: รายงานผลจริง หรือ รายการปรับปรุงยอดโดย ADMIN */
export type ProductionRowKind = "REPORT" | "ADJUSTMENT";

export interface ProductionJob {
  job_id: string;
  job_no: string;
  /** วันที่ผลิต (YYYY-MM-DD) */
  production_date: string;
  status: ProductionJobStatus;
  /** โต๊ะผลิต 1–5 */
  table_no: number;
  priority: ProductionPriority;
  product_id: string;
  sku: string;
  product_name: string;
  unit: string;
  /** จำนวนสินค้าดีที่ต้องการ — ไม่รวมของเสีย */
  target_qty: number;
  note: string;
  /** ตำแหน่งจัดเก็บตอนรับเข้าโกดัง 2 (ไม่บังคับ) */
  location: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  submitted_at: string;
  started_by_name: string;
  started_at: string;
  completed_at: string;
  cancelled_at: string;
  cancelled_by_name: string;
  cancel_reason: string;
  /** เหตุผลตอนจบงาน (บังคับเมื่อจบไม่ครบเป้า/ผลิตเกินเป้า) */
  close_reason: string;
  reopen_reason: string;
  reopen_count: number;
  updated_at: string;

  // ---- ยอดคำนวณจากรายงาน (ไม่ได้เก็บในชีต) ----
  /** บาร์โค้ดสินค้า — join จากทะเบียนสินค้าหลักตอนอ่าน (ไม่เก็บในแท็บงานผลิต) */
  barcode: string;
  /** ผลิตดีสะสม = ผลรวม good_qty จากรายงาน+ปรับปรุงทั้งหมด */
  produced_good: number;
  /** ของเสียสะสม */
  defect_total: number;
  /** จำนวนที่ยังขาด = max(0, เป้าหมาย − ผลิตดีสะสม) */
  remaining_qty: number;
  /** จำนวนผลิตเกิน = max(0, ผลิตดีสะสม − เป้าหมาย) */
  over_qty: number;
  report_count: number;
}

export interface ProductionReport {
  report_id: string;
  job_no: string;
  /** ลำดับรายงานต่องานเดียวกัน */
  report_no: number;
  kind: ProductionRowKind;
  report_kind: ProductionReportKind | "";
  /** ยอดรอบนี้ (REPORT) หรือยอดปรับ เป็น +/- (ADJUSTMENT) */
  good_qty: number;
  defect_qty: number;
  defect_cause: string;
  reason: string;
  note: string;
  photo_url: string;
  reported_by: string;
  reported_by_name: string;
  reported_at: string;
  cumulative_good: number;
  cumulative_defect: number;
  idempotency_key: string;
}

export interface ProductionHistoryEntry {
  history_id: string;
  job_no: string;
  action: string;
  actor_id: string;
  actor_name: string;
  at: string;
  reason: string;
  /** JSON รายละเอียดการเปลี่ยนแปลง (ก่อน–หลัง) */
  detail: string;
}

export interface ProductionNotification {
  notif_id: string;
  target_role: "ADMIN" | "APPROVER";
  job_no: string;
  message: string;
  created_at: string;
  created_by_name: string;
  /** user_id ของผู้ที่อ่านแล้ว */
  read_by: string[];
}

export const PRODUCTION_JOB_STATUS_LABELS: Record<ProductionJobStatus, string> = {
  DRAFT: "ฉบับร่าง",
  WAITING: "รอผลิต",
  IN_PROGRESS: "กำลังผลิต",
  COMPLETED: "จบงาน",
  CANCELLED: "ยกเลิก",
};

export const PRODUCTION_PRIORITY_LABELS: Record<ProductionPriority, string> = {
  NORMAL: "ปกติ",
  URGENT: "ด่วน",
  CRITICAL: "ด่วนมาก",
};

export const PRODUCTION_TABLE_COUNT = 5;
export const PRODUCTION_TABLES = Array.from({ length: PRODUCTION_TABLE_COUNT }, (_, i) => i + 1);

// ---- โครงสร้างคอลัมน์แท็บชีต (index = ตำแหน่งคอลัมน์ ห้ามแทรก/ลบ/สลับ) ----

/** ProductionJobs — หนึ่งแถวต่อหนึ่งงาน */
export const PRODUCTION_JOBS_SHEET_HEADERS = [
  "job_id",
  "เลขใบสั่งผลิต",
  "วันที่ผลิต",
  "สถานะ",
  "โต๊ะ",
  "ความสำคัญ",
  "product_id",
  "รหัสสินค้า",
  "ชื่อสินค้า",
  "หน่วย",
  "เป้าหมาย",
  "หมายเหตุ",
  "ตำแหน่งเก็บ",
  "ผู้สร้าง",
  "ชื่อผู้สร้าง",
  "สร้างเมื่อ",
  "ส่งงานเมื่อ",
  "ผู้เริ่มผลิต",
  "เริ่มเมื่อ",
  "จบเมื่อ",
  "ยกเลิกเมื่อ",
  "ชื่อผู้ยกเลิก",
  "เหตุผลยกเลิก",
  "เหตุผลจบงาน",
  "เหตุผลเปิดใหม่",
  "จำนวนครั้งเปิดใหม่",
  "อัปเดตเมื่อ",
] as const;

/** ProductionReports — append-only */
export const PRODUCTION_REPORTS_SHEET_HEADERS = [
  "report_id",
  "เลขใบสั่งผลิต",
  "รอบที่",
  "ชนิด",
  "ประเภทรายงาน",
  "ผลิตดี",
  "ของเสีย",
  "สาเหตุของเสีย",
  "เหตุผล",
  "หมายเหตุ",
  "ลิงก์รูปภาพ",
  "ผู้รายงาน",
  "ชื่อผู้รายงาน",
  "รายงานเมื่อ",
  "ดีสะสม",
  "เสียสะสม",
  "idempotency_key",
] as const;

/** ProductionHistory — append-only ทุกการเปลี่ยนแปลง */
export const PRODUCTION_HISTORY_SHEET_HEADERS = [
  "history_id",
  "เลขใบสั่งผลิต",
  "การกระทำ",
  "ผู้ดำเนินการ",
  "ชื่อผู้ดำเนินการ",
  "เมื่อ",
  "เหตุผล",
  "รายละเอียด (JSON)",
] as const;

/** ProductionNotifications — แจ้งเตือนในระบบ + สถานะอ่าน */
export const PRODUCTION_NOTIFS_SHEET_HEADERS = [
  "notif_id",
  "ถึงบทบาท",
  "เลขใบสั่งผลิต",
  "ข้อความ",
  "สร้างเมื่อ",
  "ผู้แจ้ง",
  "อ่านแล้วโดย (JSON)",
] as const;
