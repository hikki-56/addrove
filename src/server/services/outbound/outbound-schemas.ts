import { z } from "zod";

/** การจับคู่คอลัมน์ไฟล์ Express → ฟิลด์ของบิล (อ้างอิงด้วยชื่อหัวตา) */
export const OutboundColumnMappingSchema = z.object({
  bill_no: z.string().min(1, "ต้องเลือกคอลัมน์เลขที่บิล"),
  sku: z.string().min(1, "ต้องเลือกคอลัมน์รหัสสินค้า"),
  qty: z.string().min(1, "ต้องเลือกคอลัมน์จำนวน"),
  product_name: z.string().optional(),
  location: z.string().optional(),
  customer: z.string().optional(),
  date: z.string().optional(),
});
export type OutboundColumnMapping = z.infer<typeof OutboundColumnMappingSchema>;

export const ImportAnalyzeSchema = z.object({
  mode: z.literal("analyze"),
  file: z.instanceof(File),
});

export const ImportPreviewSchema = z.object({
  mode: z.literal("preview"),
  sheet: z.string().min(1),
  header_row: z.number().int().min(1).max(50),
  mapping: OutboundColumnMappingSchema,
});

export const ImportCommitSchema = z.object({
  mode: z.literal("commit"),
  sheet: z.string().min(1),
  header_row: z.number().int().min(1).max(50),
  mapping: OutboundColumnMappingSchema,
  warehouse_id: z.string().min(1, "ต้องเลือกคลังต้นทาง"),
  skip_unmatched: z.boolean().default(false),
});

export const BillPatchActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("activate"), // IMPORTED → READY_TO_PICK
  }),
  z.object({
    action: z.literal("hold"), // พักงาน (เก็บสถานะเดิมไว้ resume)
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("resume"), // HOLD → สถานะเดิมที่ถูกพักไว้
  }),
  z.object({
    action: z.literal("cancel"), // ยกเลิก (ปล่อยการจองสต็อก)
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("resolve-shortage"), // แอดมินตัดสินของไม่ครบหลัง SHORTAGE/HOLD
    outcome: z.enum(["CONTINUE", "REDUCE_QTY", "CANCEL"]),
    reason: z.string().optional(),
  }),
]);

export const PickActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"), // READY_TO_PICK → PICKING (+ RESERVE)
  }),
  z.object({
    action: z.literal("confirm-item"),
    sku: z.string().min(1),
    qty: z.number().int().min(1),
    location_id: z.string().optional(),
    idempotency_key: z.string().min(8).optional(),
  }),
  z.object({
    action: z.literal("report-problem"),
    sku: z.string().min(1),
    problem: z.enum(["NOT_FOUND", "INSUFFICIENT", "DAMAGED", "BAD_BARCODE", "OTHER"]),
    picked_qty: z.number().int().min(0).optional(),
    note: z.string().optional(),
  }),
  z.object({
    action: z.literal("complete"), // PICKING → PICKED_WAITING_APPROVAL (+ ISSUE doc)
    idempotency_key: z.string().min(8).optional(),
  }),
]);

export const BoxActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }), // READY_TO_PACK → PACKING + เปิดกล่องใหม่
  z.object({
    action: z.literal("scan-item"),
    sku: z.string().min(1),
    qty: z.number().int().min(1),
    idempotency_key: z.string().min(8).optional(),
  }),
  z.object({
    action: z.literal("close"), // ปิดกล่องปัจจุบัน (พิมพ์สติกเกอร์ได้)
    idempotency_key: z.string().min(8).optional(),
  }),
  z.object({
    action: z.literal("cancel-open"), // ยกเลิกกล่องเปล่าที่ยังเปิดอยู่
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("mark-sticker-printed"),
    box_id: z.string().min(1),
  }),
]);

export const ShipmentCreateSchema = z.object({
  truck_plate: z.string().min(1, "กรุณากรอกทะเบียนรถ"),
  destination: z.string().optional(),
  bill_ids: z.array(z.string()).min(1, "ต้องเลือกบิลอย่างน้อย 1 บิล"),
});

export const ShipmentActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("scan"), // สแกนกล่องขึ้นรถ
    box_code: z.string().min(1),
    idempotency_key: z.string().min(8).optional(),
  }),
  z.object({
    action: z.literal("unload"), // ยกเลิกการขึ้นรถของกล่อง (สแกนผิด)
    box_code: z.string().min(1),
  }),
  z.object({
    action: z.literal("close"), // ปิดรอบ — ต้องครบ หรือมีการยืนยันทุกกล่องที่ขาด
    confirmations: z
      .array(
        z.object({
          box_id: z.string().min(1),
          outcome: z.enum(["ROLLOVER", "CANCELLED"]),
          reason: z.string().min(1, "ต้องระบุเหตุผล"),
        })
      )
      .default([]),
    idempotency_key: z.string().min(8).optional(),
  }),
  z.object({
    action: z.literal("cancel"), // ยกเลิกรอบก่อนออกรถ
    reason: z.string().optional(),
  }),
]);

export const ApprovePickSchema = z.object({
  outcome: z.enum(["APPROVE", "REJECT"]).default("APPROVE"),
  reject_to: z.enum(["REPICK", "CANCEL"]).optional(),
  reason: z.string().optional(),
});
