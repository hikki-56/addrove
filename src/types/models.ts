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
  | "ISSUE"
  | "MOVE"
  | "TRANSFER"
  | "ADJUST"
  | "REVERSAL";

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
export type UserRole = "ADMIN" | "MANAGER" | "APPROVER" | "WAREHOUSE_STAFF" | "STAFF" | "VIEWER";

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
