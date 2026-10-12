// สร้าง request body ของการสร้าง/แก้ไขงานจากค่าฟอร์ม — จำนวนส่งเป็น number เสมอ (ไม่ส่ง "" ให้เซิร์ฟเวอร์)
// และ PATCH ส่งเฉพาะช่องที่ "แก้ได้ในสถานะนั้น" และ "เปลี่ยนจริง" เท่านั้น
//
// เหตุผล: เซิร์ฟเวอร์ปฏิเสธงานกำลังผลิตทันทีถ้ามีช่องอื่นนอกจาก target_qty/note ส่งมา (แม้ค่าเท่าเดิม)
// และตาม api-contract §2.4 งานรอผลิตจะปฏิเสธ location ด้วย (CHANGED) — เดิม UI ส่งทุกช่องทุกครั้ง
import type { ProductionJob, ProductionJobStatus, ProductionPriority } from "@/types/production";
import { parseQtyInput } from "./quantity";

/** ค่าที่ฟอร์มเพิ่ม/แก้ไขงานส่งออกมา (ตรงกับ AddJobFormValue) */
export interface JobFormInput {
  production_date: string;
  table_no: number;
  product_id: string;
  target_qty: string;
  priority: ProductionPriority;
  note: string;
  location: string;
  reason: string;
}

export type EditableJobField = "production_date" | "product_id" | "table_no" | "target_qty" | "priority" | "note" | "location";

/** ช่องที่แก้ได้ตามสถานะ (api-contract §2.4 / §4.2) */
export const EDITABLE_FIELDS_BY_STATUS: Record<ProductionJobStatus, readonly EditableJobField[]> = {
  DRAFT: ["production_date", "product_id", "table_no", "target_qty", "priority", "note", "location"],
  WAITING: ["product_id", "table_no", "target_qty", "priority", "note"],
  IN_PROGRESS: ["target_qty", "note"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canEditField(status: ProductionJobStatus | undefined, field: EditableJobField): boolean {
  if (!status) return true; // โหมดสร้างใหม่
  return EDITABLE_FIELDS_BY_STATUS[status]?.includes(field) ?? false;
}

/** จำนวนจากช่องกรอก → number หรือ undefined (ว่าง/ผิดรูปแบบ = ไม่ส่งช่องนี้) */
export function qtyOrUndefined(text: string | number | null | undefined): number | undefined {
  if (typeof text === "number") return Number.isFinite(text) ? text : undefined;
  const r = parseQtyInput(text ?? "", { allowEmpty: false });
  return r.ok ? r.value : undefined;
}

/** body ของ POST /api/production/jobs (หนึ่งงาน) */
export function buildCreateJobInput(value: JobFormInput) {
  const body: Record<string, unknown> = {
    production_date: value.production_date,
    table_no: value.table_no,
    product_id: value.product_id,
    priority: value.priority,
    note: value.note.trim(),
    location: value.location.trim(),
  };
  const target = qtyOrUndefined(value.target_qty);
  if (target !== undefined) body.target_qty = target;
  return body;
}

/** body ของ PATCH /api/production/jobs/{job_no} — updated_at + ช่องที่แก้ได้และเปลี่ยนจริง (+ reason) */
export function buildJobPatch(job: ProductionJob, value: JobFormInput): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_at: job.updated_at };
  const allowed = EDITABLE_FIELDS_BY_STATUS[job.status] ?? [];
  const next: Record<EditableJobField, unknown> = {
    production_date: value.production_date,
    product_id: value.product_id,
    table_no: value.table_no,
    target_qty: qtyOrUndefined(value.target_qty),
    priority: value.priority,
    note: value.note.trim(),
    location: value.location.trim(),
  };
  const current: Record<EditableJobField, unknown> = {
    production_date: job.production_date,
    product_id: job.product_id,
    table_no: job.table_no,
    target_qty: job.target_qty,
    priority: job.priority,
    note: (job.note || "").trim(),
    location: (job.location || "").trim(),
  };
  for (const field of allowed) {
    const v = next[field];
    if (v === undefined || (v === "" && (field === "production_date" || field === "product_id"))) continue;
    if (v !== current[field]) patch[field] = v;
  }
  const reason = value.reason.trim();
  if (reason && (job.status === "WAITING" || job.status === "IN_PROGRESS")) patch.reason = reason;
  return patch;
}
