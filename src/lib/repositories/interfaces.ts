import type {
  Warehouse,
  Location,
  Product,
  Document,
  StockMovement,
  StockSummary,
  StockCount,
  User,
  MovementWithDetails,
  DashboardStats,
} from "@/types/models";
import type {
  CreateWarehouseInput,
  CreateLocationInput,
  UpdateLocationInput,
  CreateProductInput,
  UpdateProductInput,
  ReceiveDocumentInput,
  IssueDocumentInput,
  MoveDocumentInput,
  TransferDocumentInput,
  ReversalDocumentInput,
  CreateStockCountInput,
  MovementFilterInput,
} from "@/types/api";

// ============================================================
// IStockRepository — Interface for all data operations
// Swap Google Sheets → PostgreSQL/Supabase without touching Service Layer
// ============================================================

export interface IWarehouseRepository {
  findAll(): Promise<Warehouse[]>;
  findById(id: string): Promise<Warehouse | null>;
  findByCode(code: string): Promise<Warehouse | null>;
  create(input: CreateWarehouseInput): Promise<Warehouse>;
}

export interface ILocationRepository {
  findAll(warehouseId?: string): Promise<Location[]>;
  findById(id: string): Promise<Location | null>;
  findByCode(code: string): Promise<Location | null>;
  create(input: CreateLocationInput): Promise<Location>;
  update(id: string, input: UpdateLocationInput): Promise<Location | null>;
}

export interface IProductRepository {
  findAll(opts?: { activeOnly?: boolean }): Promise<Product[]>;
  findById(id: string): Promise<Product | null>;
  findBySku(sku: string): Promise<Product | null>;
  findByBarcode(barcode: string): Promise<Product | null>;
  create(input: CreateProductInput): Promise<Product>;
  update(id: string, input: UpdateProductInput): Promise<Product | null>;
  hasMovements(id: string): Promise<boolean>;
}

export interface IDocumentRepository {
  findAll(filters: MovementFilterInput): Promise<{ data: Document[]; total: number }>;
  findById(id: string): Promise<Document | null>;
  findByNo(no: string): Promise<Document | null>;
  create(doc: Omit<Document, "document_id" | "document_no" | "created_at">): Promise<Document>;
  updateStatus(id: string, status: Document["status"]): Promise<void>;
  generateDocumentNo(type: Document["document_type"]): Promise<string>;
}

export interface IStockMovementRepository {
  findByDocumentId(documentId: string): Promise<StockMovement[]>;
  findAll(filters: MovementFilterInput): Promise<{ data: MovementWithDetails[]; total: number }>;
  getBalance(
    productId: string,
    warehouseId: string,
    locationId: string
  ): Promise<number>;
  getWarehouseBalance(
    productId: string,
    warehouseId: string
  ): Promise<number>;
  existsByIdempotencyKey(key: string): Promise<boolean>;
  batchCreate(movements: Omit<StockMovement, "movement_id" | "created_at">[]): Promise<StockMovement[]>;
}

export interface IStockSummaryRepository {
  findAll(warehouseId?: string): Promise<StockSummary[]>;
  findByProductAndLocation(
    productId: string,
    warehouseId: string,
    locationId: string
  ): Promise<StockSummary | null>;
  applyChanges(
    changes: { productId: string; warehouseId: string; locationId: string; delta: number }[]
  ): Promise<void>;
  rebuild(): Promise<void>;
}

export interface IStockCountRepository {
  findAll(warehouseId?: string): Promise<StockCount[]>;
  findById(id: string): Promise<StockCount | null>;
  create(input: CreateStockCountInput & { system_qty: number; count_no: string }): Promise<StockCount>;
  update(id: string, updates: Partial<StockCount>): Promise<StockCount | null>;
}

export interface IUserRepository {
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(user: Omit<User, "user_id" | "created_at" | "updated_at">): Promise<User>;
  update(id: string, updates: Partial<User>): Promise<User | null>;
}

export interface IDashboardRepository {
  getStats(warehouseId?: string, days?: number): Promise<DashboardStats>;
}

// Aggregate interface
export interface IStockRepository {
  warehouses: IWarehouseRepository;
  locations: ILocationRepository;
  products: IProductRepository;
  documents: IDocumentRepository;
  movements: IStockMovementRepository;
  stockSummary: IStockSummaryRepository;
  stockCounts: IStockCountRepository;
  users: IUserRepository;
  dashboard: IDashboardRepository;
}

// Business operation types used by Service Layer
export interface ReceiveInput extends ReceiveDocumentInput {
  user_id: string;
}
export interface IssueInput extends IssueDocumentInput {
  user_id: string;
}
export interface MoveInput extends MoveDocumentInput {
  user_id: string;
}
export interface TransferInput extends TransferDocumentInput {
  user_id: string;
}
export interface ReversalInput extends ReversalDocumentInput {
  user_id: string;
}
