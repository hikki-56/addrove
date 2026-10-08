import type {
  IAuditRepository,
  IDashboardRepository,
  IDocumentRepository,
  IIdempotencyRepository,
  ILocationRepository,
  IOperationJournalRepository,
  IProductRepository,
  IShelfRepository,
  IStockCountRepository,
  IStockMovementRepository,
  IStockSummaryRepository,
  IUserRepository,
  IWarehouseRepository,
  IWarehouseSyncRepository,
  ProductSyncInfo,
} from "../interfaces";
import type { AuditLogEntry } from "../interfaces/audit.repository.interface";
import type { IdempotencyRecord } from "../interfaces/idempotency.repository.interface";
import type { OperationRecord } from "../interfaces/operation-journal.repository.interface";
import type {
  CreateLocationInput,
  CreateProductInput,
  CreateShelfInput,
  CreateStockCountInput,
  CreateWarehouseInput,
  MovementFilterInput,
  UpdateLocationInput,
  UpdateProductInput,
  UpdateShelfInput,
} from "@/types/api";
import type {
  DashboardStats,
  Document,
  Location,
  MovementWithDetails,
  Product,
  Shelf,
  StockCount,
  StockMovement,
  StockSummary,
  User,
  Warehouse,
} from "@/types/models";

function postgresRepositoryNotImplemented(methodName: string): never {
  throw new Error(
    `Postgres repository method "${methodName}" is scaffolded but not implemented yet. Keep STORAGE_DRIVER=sheets until the concrete Supabase repositories are ready.`
  );
}

export class PostgresWarehouseRepository implements IWarehouseRepository {
  async findAll(): Promise<Warehouse[]> {
    return postgresRepositoryNotImplemented("warehouses.findAll");
  }

  async findById(id: string): Promise<Warehouse | null> {
    return postgresRepositoryNotImplemented("warehouses.findById");
  }

  async findByCode(code: string): Promise<Warehouse | null> {
    return postgresRepositoryNotImplemented("warehouses.findByCode");
  }

  async create(input: CreateWarehouseInput): Promise<Warehouse> {
    return postgresRepositoryNotImplemented("warehouses.create");
  }
}

export class PostgresLocationRepository implements ILocationRepository {
  async findAll(warehouseId?: string): Promise<Location[]> {
    return postgresRepositoryNotImplemented("locations.findAll");
  }

  async findById(id: string): Promise<Location | null> {
    return postgresRepositoryNotImplemented("locations.findById");
  }

  async findByCode(code: string): Promise<Location | null> {
    return postgresRepositoryNotImplemented("locations.findByCode");
  }

  async create(input: CreateLocationInput): Promise<Location> {
    return postgresRepositoryNotImplemented("locations.create");
  }

  async update(id: string, input: UpdateLocationInput): Promise<Location | null> {
    return postgresRepositoryNotImplemented("locations.update");
  }
}

export class PostgresShelfRepository implements IShelfRepository {
  async findAll(locationId?: string): Promise<Shelf[]> {
    return postgresRepositoryNotImplemented("shelves.findAll");
  }

  async findById(id: string): Promise<Shelf | null> {
    return postgresRepositoryNotImplemented("shelves.findById");
  }

  async findByCode(code: string): Promise<Shelf | null> {
    return postgresRepositoryNotImplemented("shelves.findByCode");
  }

  async create(input: CreateShelfInput): Promise<Shelf> {
    return postgresRepositoryNotImplemented("shelves.create");
  }

  async update(id: string, input: UpdateShelfInput): Promise<Shelf | null> {
    return postgresRepositoryNotImplemented("shelves.update");
  }
}

export class PostgresProductRepository implements IProductRepository {
  async findAll(opts?: { activeOnly?: boolean }): Promise<Product[]> {
    return postgresRepositoryNotImplemented("products.findAll");
  }

  async findById(id: string): Promise<Product | null> {
    return postgresRepositoryNotImplemented("products.findById");
  }

  async findBySku(sku: string): Promise<Product | null> {
    return postgresRepositoryNotImplemented("products.findBySku");
  }

  async findByBarcode(barcode: string): Promise<Product | null> {
    return postgresRepositoryNotImplemented("products.findByBarcode");
  }

  async create(input: CreateProductInput): Promise<Product> {
    return postgresRepositoryNotImplemented("products.create");
  }

  async update(id: string, input: UpdateProductInput): Promise<Product | null> {
    return postgresRepositoryNotImplemented("products.update");
  }

  async hasMovements(id: string): Promise<boolean> {
    return postgresRepositoryNotImplemented("products.hasMovements");
  }
}

export class PostgresDocumentRepository implements IDocumentRepository {
  async findAll(filters?: MovementFilterInput): Promise<{ data: Document[]; total: number }> {
    return postgresRepositoryNotImplemented("documents.findAll");
  }

  async findById(id: string, options?: { forceFresh?: boolean }): Promise<Document | null> {
    return postgresRepositoryNotImplemented("documents.findById");
  }

  async findByNo(no: string, options?: { forceFresh?: boolean }): Promise<Document | null> {
    return postgresRepositoryNotImplemented("documents.findByNo");
  }

  async create(doc: Omit<Document, "document_id" | "document_no" | "created_at">): Promise<Document> {
    return postgresRepositoryNotImplemented("documents.create");
  }

  async updateStatus(id: string, status: Document["status"]): Promise<void> {
    return postgresRepositoryNotImplemented("documents.updateStatus");
  }

  async updateNote(id: string, note: string): Promise<void> {
    return postgresRepositoryNotImplemented("documents.updateNote");
  }

  async updateDoc(id: string, updates: Partial<Document>): Promise<void> {
    return postgresRepositoryNotImplemented("documents.updateDoc");
  }

  async generateDocumentNo(type: Document["document_type"]): Promise<string> {
    return postgresRepositoryNotImplemented("documents.generateDocumentNo");
  }
}

export class PostgresStockMovementRepository implements IStockMovementRepository {
  async findByDocumentId(documentId: string): Promise<StockMovement[]> {
    return postgresRepositoryNotImplemented("movements.findByDocumentId");
  }

  async findAll(filters?: MovementFilterInput): Promise<{ data: MovementWithDetails[]; total: number }> {
    return postgresRepositoryNotImplemented("movements.findAll");
  }

  async getBalance(productId: string, warehouseId: string, locationId: string): Promise<number> {
    return postgresRepositoryNotImplemented("movements.getBalance");
  }

  async getWarehouseBalance(productId: string, warehouseId: string): Promise<number> {
    return postgresRepositoryNotImplemented("movements.getWarehouseBalance");
  }

  async existsByIdempotencyKey(key: string): Promise<boolean> {
    return postgresRepositoryNotImplemented("movements.existsByIdempotencyKey");
  }

  async batchCreate(
    movements: Omit<StockMovement, "movement_id" | "created_at">[]
  ): Promise<StockMovement[]> {
    return postgresRepositoryNotImplemented("movements.batchCreate");
  }
}

export class PostgresStockSummaryRepository implements IStockSummaryRepository {
  async findAll(warehouseId?: string): Promise<StockSummary[]> {
    return postgresRepositoryNotImplemented("stockSummary.findAll");
  }

  async findByProductAndLocation(
    productId: string,
    warehouseId: string,
    locationId: string
  ): Promise<StockSummary | null> {
    return postgresRepositoryNotImplemented("stockSummary.findByProductAndLocation");
  }

  async applyChanges(
    changes: { productId: string; warehouseId: string; locationId: string; delta: number }[]
  ): Promise<void> {
    return postgresRepositoryNotImplemented("stockSummary.applyChanges");
  }

  async rebuild(): Promise<void> {
    return postgresRepositoryNotImplemented("stockSummary.rebuild");
  }
}

export class PostgresStockCountRepository implements IStockCountRepository {
  async findAll(warehouseId?: string): Promise<StockCount[]> {
    return postgresRepositoryNotImplemented("stockCounts.findAll");
  }

  async findById(id: string): Promise<StockCount | null> {
    return postgresRepositoryNotImplemented("stockCounts.findById");
  }

  async create(input: CreateStockCountInput & { system_qty: number; count_no: string }): Promise<StockCount> {
    return postgresRepositoryNotImplemented("stockCounts.create");
  }

  async update(id: string, updates: Partial<StockCount>): Promise<StockCount | null> {
    return postgresRepositoryNotImplemented("stockCounts.update");
  }
}

export class PostgresUserRepository implements IUserRepository {
  async findAll(): Promise<User[]> {
    return postgresRepositoryNotImplemented("users.findAll");
  }

  async findById(id: string): Promise<User | null> {
    return postgresRepositoryNotImplemented("users.findById");
  }

  async findByEmail(email: string): Promise<User | null> {
    return postgresRepositoryNotImplemented("users.findByEmail");
  }

  async create(user: Omit<User, "user_id" | "created_at" | "updated_at">): Promise<User> {
    return postgresRepositoryNotImplemented("users.create");
  }

  async update(id: string, updates: Partial<User>): Promise<User | null> {
    return postgresRepositoryNotImplemented("users.update");
  }
}

export class PostgresDashboardRepository implements IDashboardRepository {
  async getStats(warehouseId?: string, days?: number): Promise<DashboardStats> {
    return postgresRepositoryNotImplemented("dashboard.getStats");
  }
}

export class PostgresIdempotencyRepository implements IIdempotencyRepository {
  async findByKey(key: string): Promise<IdempotencyRecord | null> {
    return postgresRepositoryNotImplemented("idempotency.findByKey");
  }

  async create(record: Omit<IdempotencyRecord, "created_at" | "updated_at">): Promise<IdempotencyRecord> {
    return postgresRepositoryNotImplemented("idempotency.create");
  }

  async update(
    key: string,
    updates: Partial<Pick<IdempotencyRecord, "status" | "response_payload" | "error_message" | "payload_hash">>
  ): Promise<IdempotencyRecord | null> {
    return postgresRepositoryNotImplemented("idempotency.update");
  }
}

export class PostgresAuditRepository implements IAuditRepository {
  async append(entry: Omit<AuditLogEntry, "audit_id" | "timestamp">): Promise<AuditLogEntry> {
    return postgresRepositoryNotImplemented("audit.append");
  }

  async findAll(filters?: {
    actor_id?: string;
    warehouse_id?: string;
    action?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    return postgresRepositoryNotImplemented("audit.findAll");
  }
}

export class PostgresOperationJournalRepository implements IOperationJournalRepository {
  async findById(operationId: string): Promise<OperationRecord | null> {
    return postgresRepositoryNotImplemented("journal.findById");
  }

  async findByIdempotencyKey(key: string): Promise<OperationRecord | null> {
    return postgresRepositoryNotImplemented("journal.findByIdempotencyKey");
  }

  async create(record: Omit<OperationRecord, "created_at" | "updated_at">): Promise<OperationRecord> {
    return postgresRepositoryNotImplemented("journal.create");
  }

  async update(
    operationId: string,
    updates: Partial<
      Pick<
        OperationRecord,
        "steps" | "completed_steps" | "status" | "retry_count" | "last_error"
      >
    >
  ): Promise<OperationRecord | null> {
    return postgresRepositoryNotImplemented("journal.update");
  }

  async findPendingRecovery(): Promise<OperationRecord[]> {
    return postgresRepositoryNotImplemented("journal.findPendingRecovery");
  }
}

export class PostgresWarehouseSyncRepository implements IWarehouseSyncRepository {
  async syncDeduct(
    warehouseId: string,
    productId: string,
    qty: number,
    locationId?: string
  ): Promise<ProductSyncInfo | null> {
    return postgresRepositoryNotImplemented("warehouseSync.syncDeduct");
  }

  async syncAdd(
    warehouseId: string,
    product: ProductSyncInfo,
    qty: number,
    locationId?: string
  ): Promise<void> {
    return postgresRepositoryNotImplemented("warehouseSync.syncAdd");
  }

  async syncMove(
    warehouseId: string,
    productId: string,
    qty: number,
    fromLocationId?: string,
    toLocationId?: string
  ): Promise<void> {
    return postgresRepositoryNotImplemented("warehouseSync.syncMove");
  }
}
