import { z } from "zod";
import type { DocumentType, UserRole } from "./models";

// ============================================================
// Zod Schemas — Request / Response Validation
// ============================================================

// ------ Common ------
export const IdParamSchema = z.object({ id: z.string().min(1) });

// ------ User ------
export const CreateUserSchema = z.object({
  email: z.string().min(1, "กรุณากรอกอีเมล"),
  username: z.string().optional(),
  password: z.string().min(6, "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"),
  pin: z.string().regex(/^\d{4}$/, "PIN ต้องเป็นตัวเลข 4 หลัก").optional().or(z.literal("")),
  full_name: z.string().min(1, "กรุณากรอกชื่อ-นามสกุล").max(100),
  role: z.enum(["ADMIN", "MANAGER", "APPROVER", "WAREHOUSE_STAFF", "STAFF", "VIEWER"]).default("STAFF"),
  warehouse_access: z.string().optional().default(""),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  email: z.string().min(1).optional(),
  username: z.string().optional(),
  password: z.string().min(6, "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร").optional(),
  pin: z.string().regex(/^\d{4}$/, "PIN ต้องเป็นตัวเลข 4 หลัก").optional().or(z.literal("")),
  full_name: z.string().min(1, "กรุณากรอกชื่อ-นามสกุล").max(100).optional(),
  role: z.enum(["ADMIN", "MANAGER", "APPROVER", "WAREHOUSE_STAFF", "STAFF", "VIEWER"]).optional(),
  warehouse_access: z.string().optional(),
  active: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

// ------ Warehouse ------
export const CreateWarehouseSchema = z.object({
  warehouse_code: z.string().min(1, "กรุณากรอกรหัสโกดัง").max(20),
  warehouse_name: z.string().min(1, "กรุณากรอกชื่อโกดัง").max(100),
  address: z.string().max(500).optional().default(""),
});
export type CreateWarehouseInput = z.infer<typeof CreateWarehouseSchema>;

// ------ Location ------
export const CreateLocationSchema = z.object({
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  location_code: z.string().min(1, "กรุณากรอกรหัสตำแหน่ง").optional(),
  location_name: z.string().optional().default(""),
  zone: z.string().optional().default(""),
  aisle: z.string().optional().default(""),
  rack: z.string().optional().default(""),
  shelf: z.string().optional().default(""),
  bin: z.string().optional().default(""),
  description: z.string().max(255).optional().default(""),
});
export type CreateLocationInput = z.infer<typeof CreateLocationSchema>;

export const UpdateLocationSchema = CreateLocationSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateLocationInput = z.infer<typeof UpdateLocationSchema>;

// ------ Shelf ------
export const CreateShelfSchema = z.object({
  location_id: z.string().min(1, "กรุณาเลือกตำแหน่ง"),
  shelf_code: z.string().min(1, "กรุณากรอกรหัสชั้น").max(20),
  shelf_name: z.string().min(1, "กรุณากรอกชื่อชั้น").max(100),
  shelf_level: z.string().optional().default("1"),
});
export type CreateShelfInput = z.infer<typeof CreateShelfSchema>;

export const UpdateShelfSchema = CreateShelfSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateShelfInput = z.infer<typeof UpdateShelfSchema>;

// ------ Product ------
export const CreateProductSchema = z.object({
  sku: z.string().min(1, "กรุณากรอก SKU").max(50),
  barcode: z.string().max(50).optional().default(""),
  product_name: z.string().min(1, "กรุณากรอกชื่อสินค้า").max(200),
  category: z.string().min(1, "กรุณากรอกหมวดหมู่").max(100),
  supplier: z.string().max(200).optional().default(""),
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง").optional(),
  base_unit: z.string().min(1, "กรุณากรอกหน่วยนับ").max(20).optional().default("ชิ้น"),
  minimum_stock: z
    .number()
    .min(0, "จำนวนขั้นต่ำต้องไม่ติดลบ")
    .optional()
    .default(0),
  initial_quantity: z
    .number()
    .min(0, "จำนวนสินค้าเริ่มต้นต้องไม่ติดลบ")
    .optional()
    .default(0),
  description: z.string().max(500).optional().default(""),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = CreateProductSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

// ------ Movement: Receive ------
export const LocationAllocationSchema = z.object({
  location_id: z.string().default(""),
  qty: z.number().default(1),
});
export type LocationAllocation = z.infer<typeof LocationAllocationSchema>;

export const ReceiveLineSchema = z.object({
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  location_id: z.string().default("loc-14A1"),
  primary_qty: z.number().optional(),
  extra_locations: z.array(z.string()).optional().default([]),
  extra_qtys: z.array(z.number()).optional().default([]),
  location_allocations: z.array(LocationAllocationSchema).optional().default([]),
  qty: z.number().positive("จำนวนต้องมากกว่า 0"),
  boxes: z.number().default(1),
  barcode: z.string().default(""),
});
export type ReceiveLineInput = z.infer<typeof ReceiveLineSchema>;

export const ReceiveDocumentSchema = z.object({
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  reference_no: z.string().max(100).default(""),
  document_date: z.string().min(1, "กรุณาเลือกวันที่"),
  note: z.string().max(500).default(""),
  idempotency_key: z.string().min(1),
  lines: z.array(ReceiveLineSchema).min(1, "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ"),
});
export type ReceiveDocumentInput = z.infer<typeof ReceiveDocumentSchema>;

// Alias for domain service
export const ReceiveStockSchema = ReceiveDocumentSchema;
export type ReceiveStockInput = z.infer<typeof ReceiveStockSchema>;

// ------ Movement: Issue ------
export const IssueLineSchema = z.object({
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  location_id: z.string().min(1, "กรุณาเลือกตำแหน่ง"),
  qty: z.number().positive("จำนวนต้องมากกว่า 0"),
});
export type IssueLineInput = z.infer<typeof IssueLineSchema>;

export const IssueDocumentSchema = z.object({
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  reference_no: z.string().max(100).default(""),
  document_date: z.string().min(1, "กรุณาเลือกวันที่"),
  note: z.string().max(500).default(""),
  idempotency_key: z.string().min(1),
  lines: z.array(IssueLineSchema).min(1, "กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ"),
});
export type IssueDocumentInput = z.infer<typeof IssueDocumentSchema>;

// Alias for domain service
export const IssueStockSchema = IssueDocumentSchema;
export type IssueStockInput = IssueDocumentInput;

// ------ Movement: Move (same warehouse, different location) ------
export const MoveDocumentSchema = z.object({
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  from_location_id: z.string().default(""),
  to_location_id: z.string().min(1, "กรุณาเลือกตำแหน่งปลายทาง"),
  qty: z.number().positive("จำนวนต้องมากกว่า 0"),
  reference_no: z.string().max(100).default(""),
  document_date: z.string().min(1, "กรุณาเลือกวันที่"),
  note: z.string().max(500).default(""),
  idempotency_key: z.string().min(1),
});
export type MoveDocumentInput = z.infer<typeof MoveDocumentSchema>;

// Alias for domain service
export const MoveStockSchema = MoveDocumentSchema;
export type MoveStockInput = MoveDocumentInput;

// ------ Movement: Transfer (cross-warehouse) ------
export const TransferDocumentSchema = z.object({
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  from_warehouse_id: z.string().min(1, "กรุณาเลือกโกดังต้นทาง"),
  from_location_id: z.string().optional().default(""),
  to_warehouse_id: z.string().min(1, "กรุณาเลือกโกดังปลายทาง"),
  to_location_id: z.string().optional().default(""),
  qty: z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  moved_by: z.string().optional().transform((val) => (val && val.trim() ? val.trim() : "พนักงาน")),
  assigned_to_user_id: z.string().optional(),
  assigned_to_name: z.string().optional(),
  created_by: z.string().optional(),
  created_by_name: z.string().optional(),
  reference_no: z.string().max(100).optional().default(""),
  document_date: z.string().optional().transform((val) => (val && val.trim() ? val.trim() : new Date().toISOString().slice(0, 10))),
  note: z.string().max(500).optional().default(""),
  idempotency_key: z.string().optional().transform((val) => (val && val.trim() ? val.trim() : `idem-trf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)),
});
export type TransferDocumentInput = z.infer<typeof TransferDocumentSchema>;

// Alias for domain service
export const CreateTransferSchema = TransferDocumentSchema;
export type CreateTransferInput = TransferDocumentInput;

export const TransferAllocationSchema = z.object({
  location_id: z.string().min(1),
  qty: z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
});
export type TransferAllocation = z.infer<typeof TransferAllocationSchema>;

export const SubmitTransferSchema = z.object({
  from_location_id: z.string().optional(),
  to_location_id: z.string().optional(),
  completed_location_id: z.string().optional(),
  source_allocations: z.array(TransferAllocationSchema).optional(),
});
export type SubmitTransferInput = z.infer<typeof SubmitTransferSchema>;

export const ApproveTransferSchema = z.object({
  from_location_id: z.string().optional(),
  to_location_id: z.string().optional(),
  source_allocations: z.array(TransferAllocationSchema).optional(),
  note: z.string().optional(),
});
export type ApproveTransferInput = z.infer<typeof ApproveTransferSchema>;

export const CompleteTransferSchema = z.object({
  from_location_id: z.string().optional(),
  to_location_id: z.string().optional(),
  completed_location_id: z.string().optional(),
  completed_location_name: z.string().optional(),
  completed_by: z.string().optional(),
  source_allocations: z.array(TransferAllocationSchema).optional(),
});
export type CompleteTransferInput = z.infer<typeof CompleteTransferSchema>;

export const CancelTransferSchema = z.object({
  note: z.string().optional().default("ยกเลิกโดยผู้ใช้"),
});
export type CancelTransferInput = z.infer<typeof CancelTransferSchema>;

// ------ Movement: Reversal ------
export const ReversalDocumentSchema = z.object({
  original_document_id: z.string().min(1, "กรุณาระบุเอกสารที่ต้องการกลับยอด"),
  note: z.string().max(500).optional().default(""),
  idempotency_key: z.string().min(1),
});
export type ReversalDocumentInput = z.infer<typeof ReversalDocumentSchema>;

// Alias for domain service
export const ReverseStockSchema = ReversalDocumentSchema;
export type ReverseStockInput = ReversalDocumentInput;

// ------ StockCount ------
export const CreateStockCountSchema = z.object({
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  location_id: z.string().min(1, "กรุณาเลือกตำแหน่ง"),
  counted_qty: z.number().min(0, "จำนวนต้องไม่ติดลบ"),
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
  document_type: z.string().optional(),
  warehouse_id: z.string().optional(),
  location_id: z.string().optional(),
  created_by: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});
export type MovementFilterInput = z.infer<typeof MovementFilterSchema>;

// ------ Shelf QR Token Generation ------
export const GenerateShelfQrSchema = z.object({
  location_id: z.string().min(1, "กรุณาเลือกตำแหน่ง"),
  shelf_code: z.string().min(1, "กรุณากรอกรหัสชั้นวาง").max(20),
  shelf_name: z.string().min(1, "กรุณากรอกชื่อชั้นวาง").max(100),
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
});
export type GenerateShelfQrInput = z.infer<typeof GenerateShelfQrSchema>;

// ------ Shelf QR Verification & Assignment ------
export const VerifyShelfQrSchema = z.object({
  token: z.string().min(1, "กรุณาระบุ QR token"),
  product_id: z.string().min(1, "กรุณาเลือกสินค้าที่ต้องการผูก"),
  shelf_code: z.string().optional(),
  shelf_name: z.string().optional(),
  location_id: z.string().optional(),
  warehouse_id: z.string().optional(),
});
export type VerifyShelfQrInput = z.infer<typeof VerifyShelfQrSchema>;
