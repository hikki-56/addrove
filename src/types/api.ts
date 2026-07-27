import { z } from "zod";
import type { DocumentType, UserRole } from "./models";

// ============================================================
// Zod Schemas — Request / Response Validation
// ============================================================

// ------ Common ------
export const IdParamSchema = z.object({ id: z.string().min(1) });

// ------ Warehouse ------
export const CreateWarehouseSchema = z.object({
  warehouse_code: z.string().min(1, "กรุณากรอกรหัสโกดัง").max(20),
  warehouse_name: z.string().min(1, "กรุณากรอกชื่อโกดัง").max(100),
  address: z.string().max(500).default(""),
});
export type CreateWarehouseInput = z.infer<typeof CreateWarehouseSchema>;

// ------ Location ------
export const CreateLocationSchema = z.object({
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  zone: z.string().min(1, "กรุณากรอกโซน").max(10),
  aisle: z.string().min(1, "กรุณากรอกทางเดิน").max(10),
  rack: z.string().min(1, "กรุณากรอกชั้นวาง").max(10),
  shelf: z.string().min(1, "กรุณากรอกชั้นย่อย").max(10),
  bin: z.string().min(1, "กรุณากรอกช่อง").max(10),
  description: z.string().max(255).default(""),
});
export type CreateLocationInput = z.infer<typeof CreateLocationSchema>;

export const UpdateLocationSchema = CreateLocationSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateLocationInput = z.infer<typeof UpdateLocationSchema>;

// ------ Product ------
export const CreateProductSchema = z.object({
  sku: z.string().min(1, "กรุณากรอก SKU").max(50),
  barcode: z.string().min(1, "กรุณากรอก Barcode").max(50),
  product_name: z.string().min(1, "กรุณากรอกชื่อสินค้า").max(200),
  category: z.string().min(1, "กรุณากรอกหมวดหมู่").max(100),
  base_unit: z.string().min(1, "กรุณากรอกหน่วยนับ").max(20),
  minimum_stock: z
    .number({ invalid_type_error: "จำนวนขั้นต่ำต้องเป็นตัวเลข" })
    .min(0, "จำนวนขั้นต่ำต้องไม่ติดลบ")
    .default(0),
  description: z.string().max(500).default(""),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = CreateProductSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

// ------ Movement: Receive ------
export const ReceiveLineSchema = z.object({
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  location_id: z.string().min(1, "กรุณาเลือกตำแหน่ง"),
  qty: z
    .number({ invalid_type_error: "จำนวนต้องเป็นตัวเลข" })
    .positive("จำนวนต้องมากกว่า 0"),
});

export const ReceiveDocumentSchema = z.object({
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  reference_no: z.string().max(100).default(""),
  document_date: z.string().min(1, "กรุณาเลือกวันที่"),
  note: z.string().max(500).default(""),
  idempotency_key: z.string().min(1),
  lines: z
    .array(ReceiveLineSchema)
    .min(1, "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ"),
});
export type ReceiveDocumentInput = z.infer<typeof ReceiveDocumentSchema>;

// ------ Movement: Issue ------
export const IssueLineSchema = z.object({
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  location_id: z.string().min(1, "กรุณาเลือกตำแหน่ง"),
  qty: z
    .number({ invalid_type_error: "จำนวนต้องเป็นตัวเลข" })
    .positive("จำนวนต้องมากกว่า 0"),
});

export const IssueDocumentSchema = z.object({
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  reference_no: z.string().max(100).default(""),
  document_date: z.string().min(1, "กรุณาเลือกวันที่"),
  note: z.string().max(500).default(""),
  idempotency_key: z.string().min(1),
  lines: z
    .array(IssueLineSchema)
    .min(1, "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ"),
});
export type IssueDocumentInput = z.infer<typeof IssueDocumentSchema>;

// ------ Movement: Move (same warehouse, different location) ------
export const MoveDocumentSchema = z.object({
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  from_location_id: z.string().min(1, "กรุณาเลือกตำแหน่งต้นทาง"),
  to_location_id: z.string().min(1, "กรุณาเลือกตำแหน่งปลายทาง"),
  qty: z
    .number({ invalid_type_error: "จำนวนต้องเป็นตัวเลข" })
    .positive("จำนวนต้องมากกว่า 0"),
  reference_no: z.string().max(100).default(""),
  document_date: z.string().min(1, "กรุณาเลือกวันที่"),
  note: z.string().max(500).default(""),
  idempotency_key: z.string().min(1),
});
export type MoveDocumentInput = z.infer<typeof MoveDocumentSchema>;

// ------ Movement: Transfer (cross-warehouse) ------
export const TransferDocumentSchema = z.object({
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  from_warehouse_id: z.string().min(1, "กรุณาเลือกโกดังต้นทาง"),
  from_location_id: z.string().min(1, "กรุณาเลือกตำแหน่งต้นทาง"),
  to_warehouse_id: z.string().min(1, "กรุณาเลือกโกดังปลายทาง"),
  to_location_id: z.string().min(1, "กรุณาเลือกตำแหน่งปลายทาง"),
  qty: z
    .number({ invalid_type_error: "จำนวนต้องเป็นตัวเลข" })
    .positive("จำนวนต้องมากกว่า 0"),
  reference_no: z.string().max(100).default(""),
  document_date: z.string().min(1, "กรุณาเลือกวันที่"),
  note: z.string().max(500).default(""),
  idempotency_key: z.string().min(1),
});
export type TransferDocumentInput = z.infer<typeof TransferDocumentSchema>;

// ------ Movement: Reversal ------
export const ReversalDocumentSchema = z.object({
  original_document_id: z.string().min(1, "กรุณาระบุเอกสารที่ต้องการกลับยอด"),
  note: z.string().min(1, "กรุณาระบุเหตุผลการกลับยอด").max(500),
  idempotency_key: z.string().min(1),
});
export type ReversalDocumentInput = z.infer<typeof ReversalDocumentSchema>;

// ------ StockCount ------
export const CreateStockCountSchema = z.object({
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  location_id: z.string().min(1, "กรุณาเลือกตำแหน่ง"),
  counted_qty: z
    .number({ invalid_type_error: "จำนวนต้องเป็นตัวเลข" })
    .min(0, "จำนวนต้องไม่ติดลบ"),
});
export type CreateStockCountInput = z.infer<typeof CreateStockCountSchema>;

export const ApproveStockCountSchema = z.object({
  count_id: z.string().min(1),
});
export type ApproveStockCountInput = z.infer<typeof ApproveStockCountSchema>;

// ------ API Response ------
export interface ApiSuccess<T = unknown> {
  success: true;
  message: string;
  data: T;
}

export interface ApiError {
  success: false;
  message: string;
  errors?: { field?: string; message: string }[];
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ------ Filters ------
export const MovementFilterSchema = z.object({
  document_no: z.string().optional(),
  sku: z.string().optional(),
  product_name: z.string().optional(),
  document_type: z.string().optional() as z.ZodOptional<
    z.ZodEnum<[DocumentType, ...DocumentType[]]>
  >,
  warehouse_id: z.string().optional(),
  location_id: z.string().optional(),
  created_by: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type MovementFilterInput = z.infer<typeof MovementFilterSchema>;

export const UserRoles: UserRole[] = ["ADMIN", "WAREHOUSE_STAFF", "VIEWER"];
