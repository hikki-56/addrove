// Zod schemas ระบบสั่งผลิตและรายงานผลผลิต — ข้อความ error ภาษาไทยทุก constraint
import { z } from "zod";
import { PRODUCTION_TABLES } from "@/types/production";

/** จำนวน ≥ 0 รับทศนิยมได้ไม่เกิน 2 ตำแหน่ง (ตามหน่วยสินค้า ยังไม่มีรายการหน่วยจำนวนเต็ม-only) */
const qty = z.coerce
  .number({ message: "กรุณากรอกจำนวนเป็นตัวเลข" })
  .min(0, "จำนวนห้ามติดลบ")
  .refine((v) => Math.round(v * 100) === v * 100, "รับทศนิยมได้ไม่เกิน 2 ตำแหน่ง");

const tableNo = z.coerce
  .number({ message: "กรุณาเลือกโต๊ะผลิต" })
  .int("โต๊ะผลิตต้องเป็นจำนวนเต็ม")
  .refine((v) => PRODUCTION_TABLES.includes(v), "โต๊ะผลิตต้องอยู่ระหว่าง 1–5");

export const createProductionJobSchema = z.object({
  production_date: z
    .string({ message: "กรุณาระบุวันที่ผลิต" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ผลิตต้องอยู่ในรูปแบบ YYYY-MM-DD"),
  table_no: tableNo,
  product_id: z.string({ message: "กรุณาเลือกสินค้า" }).trim().min(1, "กรุณาเลือกสินค้า"),
  target_qty: qty.refine((v) => v > 0, "จำนวนเป้าหมายต้องมากกว่า 0"),
  priority: z.enum(["NORMAL", "URGENT", "CRITICAL"]).default("NORMAL"),
  note: z.string().trim().max(500, "หมายเหตุยาวเกินไป (สูงสุด 500 ตัวอักษร)").optional().default(""),
  location: z.string().trim().max(50, "ตำแหน่งเก็บยาวเกินไป").optional().default(""),
});

export const createProductionJobsSchema = z.object({
  jobs: z.array(createProductionJobSchema).min(1, "กรุณาระบุรายการงานอย่างน้อย 1 งาน"),
});

export const updateProductionJobSchema = z.object({
  /** optimistic concurrency — ต้องตรงกับ updated_at ปัจจุบันของงาน */
  updated_at: z.string({ message: "ข้อมูลงานไม่เป็นปัจจุบัน กรุณารีเฟรชแล้วลองใหม่" }),
  production_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ผลิตต้องอยู่ในรูปแบบ YYYY-MM-DD")
    .optional(),
  table_no: tableNo.optional(),
  product_id: z.string().trim().min(1, "กรุณาเลือกสินค้า").optional(),
  target_qty: qty.refine((v) => v > 0, "จำนวนเป้าหมายต้องมากกว่า 0").optional(),
  priority: z.enum(["NORMAL", "URGENT", "CRITICAL"]).optional(),
  note: z.string().trim().max(500, "หมายเหตุยาวเกินไป (สูงสุด 500 ตัวอักษร)").optional(),
  location: z.string().trim().max(50, "ตำแหน่งเก็บยาวเกินไป").optional(),
  /** บังคับเมื่อแก้งานที่ส่งแล้ว/เริ่มผลิตแล้ว */
  reason: z.string().trim().max(500, "เหตุผลยาวเกินไป (สูงสุด 500 ตัวอักษร)").optional().default(""),
});

export const submitProductionJobsSchema = z.object({
  job_nos: z.array(z.string().trim().min(1)).min(1, "กรุณาเลือกงานที่ต้องการส่งอย่างน้อย 1 งาน"),
});

export const reportProductionSchema = z.object({
  good_qty: qty,
  defect_qty: qty,
  defect_cause: z.string().trim().max(500).optional().default(""),
  note: z.string().trim().max(500).optional().default(""),
  photo_url: z.string().trim().max(1000).optional().default(""),
  report_kind: z.enum(["PARTIAL", "FINAL"], { message: "กรุณาเลือกรายงานบางส่วนหรือจบงาน" }),
  /** บังคับเมื่อจบงานแล้วยอดไม่ครบเป้า หรือผลิตดีเกินเป้า */
  close_reason: z.string().trim().max(500).optional().default(""),
  idempotency_key: z.string().trim().min(8, "idempotency key ไม่ถูกต้อง").max(100),
});

export const adjustProductionSchema = z.object({
  /** ยอดสะสมใหม่ที่ต้องการแก้เป็น (ไม่ใช่ delta) — ระบบคำนวณส่วนต่างเอง */
  new_good_qty: qty,
  new_defect_qty: qty,
  reason: z.string().trim().min(1, "กรุณาระบุเหตุผลการปรับปรุงยอด").max(500, "เหตุผลยาวเกินไป"),
  idempotency_key: z.string().trim().min(8, "idempotency key ไม่ถูกต้อง").max(100),
});

export const cancelProductionJobSchema = z.object({
  reason: z.string().trim().min(1, "กรุณาระบุเหตุผลการยกเลิก").max(500, "เหตุผลยาวเกินไป"),
});

export const reopenProductionJobSchema = z.object({
  reason: z.string().trim().min(1, "กรุณาระบุเหตุผลการเปิดงานผลิตต่อ").max(500, "เหตุผลยาวเกินไป"),
});

export type CreateProductionJobInput = z.infer<typeof createProductionJobSchema>;
export type UpdateProductionJobInput = z.infer<typeof updateProductionJobSchema>;
export type ReportProductionInput = z.infer<typeof reportProductionSchema>;
export type AdjustProductionInput = z.infer<typeof adjustProductionSchema>;
