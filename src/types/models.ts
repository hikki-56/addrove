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

// ------ Location ------
export interface Location {
  location_id: LocationId;
  warehouse_id: WarehouseId;
  zone: string;
  aisle: string;
  rack: string;
  shelf: string;
  bin: string;
  location_code: string; // W001-ZA-A02-R03-S04-B01
  description: string;
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
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ------ Document ------
export type DocumentType =
  | "OPENING"
  | "RECEIVE"
  | "ISSUE"
  | "MOVE"
  | "TRANSFER"
  | "ADJUST"
  | "REVERSAL";

export type DocumentStatus = "DRAFT" | "POSTED" | "CANCELLED";

export interface Document {
  document_id: DocumentId;
  document_no: string;
  document_type: DocumentType;
  reference_no: string;
  document_date: string;
  status: DocumentStatus;
  note: string;
  created_by: UserId;
  created_at: string;
}

// ------ StockMovement ------
export type MovementType =
  | "RECEIVE"
  | "ISSUE"
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
export type UserRole = "ADMIN" | "WAREHOUSE_STAFF" | "VIEWER";

export interface User {
  user_id: UserId;
  full_name: string;
  email: string;
  password_hash: string;
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

export interface DashboardStats {
  total_sku: number;
  total_quantity: number;
  low_stock_count: number;
  out_of_stock_count: number;
  received_today: number;
  issued_today: number;
  recent_movements: MovementWithDetails[];
  chart_data: {
    date: string;
    received: number;
    issued: number;
  }[];
}
