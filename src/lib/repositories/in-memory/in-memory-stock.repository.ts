import {
  IStockRepository,
  IWarehouseRepository,
  ILocationRepository,
  IShelfRepository,
  IProductRepository,
  IDocumentRepository,
  IStockMovementRepository,
  IStockSummaryRepository,
  IStockCountRepository,
  IUserRepository,
  IDashboardRepository,
  IIdempotencyRepository,
  IAuditRepository,
  IOperationJournalRepository,
  IWarehouseSyncRepository,
  ProductSyncInfo,
} from "../interfaces";
import type {
  Warehouse,
  Location,
  Shelf,
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
  CreateShelfInput,
  UpdateShelfInput,
  CreateProductInput,
  UpdateProductInput,
  CreateStockCountInput,
  MovementFilterInput,
} from "@/types/api";
import type { IdempotencyRecord } from "../interfaces/idempotency.repository.interface";
import type { AuditLogEntry } from "../interfaces/audit.repository.interface";
import type { OperationRecord } from "../interfaces/operation-journal.repository.interface";

export class InMemoryWarehouseRepository implements IWarehouseRepository {
  private warehouses: Warehouse[] = [
    {
      warehouse_id: "wh-1",
      warehouse_code: "WH-01",
      warehouse_name: "โกดัง1",
      address: "Main Warehouse",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      warehouse_id: "wh-2",
      warehouse_code: "WH-02",
      warehouse_name: "โกดัง2",
      address: "Secondary Warehouse",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  async findAll(): Promise<Warehouse[]> {
    return [...this.warehouses];
  }

  async findById(id: string): Promise<Warehouse | null> {
    return this.warehouses.find((w) => w.warehouse_id === id) || null;
  }

  async findByCode(code: string): Promise<Warehouse | null> {
    return this.warehouses.find((w) => w.warehouse_code === code) || null;
  }

  async create(input: CreateWarehouseInput): Promise<Warehouse> {
    const wh: Warehouse = {
      warehouse_id: `wh-${Date.now()}`,
      warehouse_code: input.warehouse_code,
      warehouse_name: input.warehouse_name,
      address: input.address || "",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.warehouses.push(wh);
    return wh;
  }
}

export class InMemoryLocationRepository implements ILocationRepository {
  private locations: Location[] = [
    {
      location_id: "loc-A",
      warehouse_id: "wh-1",
      location_code: "loc-A",
      location_name: "Zone A",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      location_id: "loc-B",
      warehouse_id: "wh-1",
      location_code: "loc-B",
      location_name: "Zone B",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  async findAll(warehouseId?: string): Promise<Location[]> {
    if (warehouseId) {
      return this.locations.filter((l) => l.warehouse_id === warehouseId);
    }
    return [...this.locations];
  }

  async findById(id: string): Promise<Location | null> {
    return this.locations.find((l) => l.location_id === id) || null;
  }

  async findByCode(code: string): Promise<Location | null> {
    return this.locations.find((l) => l.location_code === code) || null;
  }

  async create(input: CreateLocationInput): Promise<Location> {
    const loc: Location = {
      location_id: `loc-${Date.now()}`,
      warehouse_id: input.warehouse_id,
      location_code: input.location_code || `loc-${Date.now()}`,
      location_name: input.location_name || "",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.locations.push(loc);
    return loc;
  }

  async update(id: string, input: UpdateLocationInput): Promise<Location | null> {
    const idx = this.locations.findIndex((l) => l.location_id === id);
    if (idx === -1) return null;
    this.locations[idx] = {
      ...this.locations[idx],
      ...input,
      updated_at: new Date().toISOString(),
    };
    return this.locations[idx];
  }
}

export class InMemoryShelfRepository implements IShelfRepository {
  private shelves: Shelf[] = [];

  async findAll(locationId?: string): Promise<Shelf[]> {
    if (locationId) return this.shelves.filter((s) => s.location_id === locationId);
    return [...this.shelves];
  }

  async findById(id: string): Promise<Shelf | null> {
    return this.shelves.find((s) => s.shelf_id === id) || null;
  }

  async findByCode(code: string): Promise<Shelf | null> {
    return this.shelves.find((s) => s.shelf_code === code) || null;
  }

  async create(input: CreateShelfInput): Promise<Shelf> {
    const shelf: Shelf = {
      shelf_id: `sh-${Date.now()}`,
      location_id: input.location_id,
      shelf_code: input.shelf_code,
      shelf_name: input.shelf_name,
      shelf_level: input.shelf_level || "1",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.shelves.push(shelf);
    return shelf;
  }

  async update(id: string, input: UpdateShelfInput): Promise<Shelf | null> {
    const idx = this.shelves.findIndex((s) => s.shelf_id === id);
    if (idx === -1) return null;
    this.shelves[idx] = {
      ...this.shelves[idx],
      ...input,
      updated_at: new Date().toISOString(),
    };
    return this.shelves[idx];
  }
}

export class InMemoryProductRepository implements IProductRepository {
  private products: Product[] = [
    {
      product_id: "prod-1",
      sku: "SKU001",
      barcode: "SKU001",
      product_name: "สินค้าทดสอบ 1",
      category: "ทั่วไป",
      base_unit: "ชิ้น",
      minimum_stock: 10,
      description: "",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  async findAll(opts?: { activeOnly?: boolean }): Promise<Product[]> {
    if (opts?.activeOnly) return this.products.filter((p) => p.active);
    return [...this.products];
  }

  async findById(id: string): Promise<Product | null> {
    return this.products.find((p) => p.product_id === id) || null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    const norm = sku.trim().toLowerCase();
    return this.products.find((p) => p.sku.toLowerCase() === norm) || null;
  }

  async findByBarcode(barcode: string): Promise<Product | null> {
    return this.products.find((p) => p.barcode === barcode) || null;
  }

  async create(input: CreateProductInput): Promise<Product> {
    const p: Product = {
      product_id: `prod-${Date.now()}`,
      sku: input.sku,
      barcode: input.barcode || input.sku,
      product_name: input.product_name,
      category: input.category,
      supplier: input.supplier || "",
      base_unit: input.base_unit || "ชิ้น",
      minimum_stock: input.minimum_stock || 0,
      description: input.description || "",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.products.push(p);
    return p;
  }

  async update(id: string, input: UpdateProductInput): Promise<Product | null> {
    const idx = this.products.findIndex((p) => p.product_id === id);
    if (idx === -1) return null;
    this.products[idx] = {
      ...this.products[idx],
      ...input,
      updated_at: new Date().toISOString(),
    };
    return this.products[idx];
  }

  async hasMovements(): Promise<boolean> {
    return false;
  }
}

export class InMemoryDocumentRepository implements IDocumentRepository {
  public documents: Document[] = [];

  async findAll(filters?: MovementFilterInput): Promise<{ data: Document[]; total: number }> {
    let result = [...this.documents];
    if (filters?.document_type) {
      result = result.filter((d) => d.document_type === filters.document_type);
    }
    return { data: result, total: result.length };
  }

  async findById(id: string): Promise<Document | null> {
    return this.documents.find((d) => d.document_id === id) || null;
  }

  async findByNo(no: string): Promise<Document | null> {
    return this.documents.find((d) => d.document_no === no) || null;
  }

  async create(doc: Omit<Document, "document_id" | "document_no" | "created_at">): Promise<Document> {
    const fullDoc: Document = {
      ...doc,
      document_id: `doc-${Date.now()}-${Math.random()}`,
      document_no: `DOC-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    this.documents.push(fullDoc);
    return fullDoc;
  }

  async updateStatus(id: string, status: Document["status"]): Promise<void> {
    const d = await this.findById(id);
    if (d) d.status = status;
  }

  async updateNote(id: string, note: string): Promise<void> {
    const d = await this.findById(id);
    if (d) d.note = note;
  }

  async updateDoc(id: string, updates: Partial<Document>): Promise<void> {
    const d = await this.findById(id);
    if (d) Object.assign(d, updates);
  }

  async generateDocumentNo(type: Document["document_type"]): Promise<string> {
    return `${type}-${Date.now()}`;
  }
}

export class InMemoryStockMovementRepository implements IStockMovementRepository {
  public movements: StockMovement[] = [];

  async findByDocumentId(documentId: string): Promise<StockMovement[]> {
    return this.movements.filter((m) => m.document_id === documentId);
  }

  async findAll(): Promise<{ data: MovementWithDetails[]; total: number }> {
    return { data: this.movements as unknown as MovementWithDetails[], total: this.movements.length };
  }

  async getBalance(productId: string, warehouseId: string, locationId: string): Promise<number> {
    const normWh = (id: string) => id?.replace(/^wh-0*/, "wh-") || id;
    return this.movements
      .filter(
        (m) =>
          m.product_id === productId &&
          normWh(m.warehouse_id) === normWh(warehouseId) &&
          m.location_id === locationId
      )
      .reduce((sum, m) => sum + m.qty_change, 0);
  }

  async getWarehouseBalance(productId: string, warehouseId: string): Promise<number> {
    const normWh = (id: string) => id?.replace(/^wh-0*/, "wh-") || id;
    return this.movements
      .filter((m) => m.product_id === productId && normWh(m.warehouse_id) === normWh(warehouseId))
      .reduce((sum, m) => sum + m.qty_change, 0);
  }

  async existsByIdempotencyKey(key: string): Promise<boolean> {
    return this.movements.some((m) => m.idempotency_key === key);
  }

  async batchCreate(
    movements: Omit<StockMovement, "movement_id" | "created_at">[]
  ): Promise<StockMovement[]> {
    const created: StockMovement[] = movements.map((m) => ({
      ...m,
      movement_id: `mov-${Date.now()}-${Math.random()}`,
      created_at: new Date().toISOString(),
    }));
    this.movements.push(...created);
    return created;
  }
}

export class InMemoryStockSummaryRepository implements IStockSummaryRepository {
  private summaries: StockSummary[] = [];

  async findAll(warehouseId?: string): Promise<StockSummary[]> {
    if (warehouseId) return this.summaries.filter((s) => s.warehouse_id === warehouseId);
    return [...this.summaries];
  }

  async findByProductAndLocation(
    productId: string,
    warehouseId: string,
    locationId: string
  ): Promise<StockSummary | null> {
    return (
      this.summaries.find(
        (s) =>
          s.product_id === productId &&
          s.warehouse_id === warehouseId &&
          s.location_id === locationId
      ) || null
    );
  }

  async applyChanges(
    changes: { productId: string; warehouseId: string; locationId: string; delta: number }[]
  ): Promise<void> {
    for (const c of changes) {
      const found = await this.findByProductAndLocation(c.productId, c.warehouseId, c.locationId);
      if (found) {
        found.quantity += c.delta;
      } else {
        this.summaries.push({
          product_id: c.productId,
          warehouse_id: c.warehouseId,
          location_id: c.locationId,
          quantity: c.delta,
          last_updated: new Date().toISOString(),
        });
      }
    }
  }

  async rebuild(): Promise<void> {}
}

export class InMemoryStockCountRepository implements IStockCountRepository {
  private counts: StockCount[] = [];

  async findAll(warehouseId?: string): Promise<StockCount[]> {
    if (warehouseId) return this.counts.filter((c) => c.warehouse_id === warehouseId);
    return [...this.counts];
  }

  async findById(id: string): Promise<StockCount | null> {
    return this.counts.find((c) => c.count_id === id) || null;
  }

  async create(
    input: CreateStockCountInput & { system_qty: number; count_no: string }
  ): Promise<StockCount> {
    const count: StockCount = {
      count_id: `cnt-${Date.now()}`,
      count_no: input.count_no,
      warehouse_id: input.warehouse_id,
      location_id: input.location_id,
      product_id: input.product_id,
      counted_qty: input.counted_qty,
      system_qty: input.system_qty,
      difference: input.counted_qty - input.system_qty,
      status: "COUNTED",
      counted_by: null,
      counted_at: new Date().toISOString(),
      approved_by: null,
      approved_at: null,
    };
    this.counts.push(count);
    return count;
  }

  async update(id: string, updates: Partial<StockCount>): Promise<StockCount | null> {
    const idx = this.counts.findIndex((c) => c.count_id === id);
    if (idx === -1) return null;
    this.counts[idx] = { ...this.counts[idx], ...updates };
    return this.counts[idx];
  }
}

export class InMemoryUserRepository implements IUserRepository {
  private users: User[] = [
    {
      user_id: "user-1",
      email: "admin@stockify.com",
      full_name: "System Admin",
      role: "ADMIN",
      password_hash: "$2b$10$nWbX/qEeku7sYRSxVHk.1.3dn8lBIq.lay0OdvegNNmG3T7mjnvHa",
      pin_hash: "",
      warehouse_access: '["*"]',
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  async findAll(): Promise<User[]> {
    return [...this.users];
  }

  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.user_id === id) || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const clean = email.trim().toLowerCase();
    return this.users.find((u) => u.email.toLowerCase() === clean || u.user_id.toLowerCase() === clean) || null;
  }

  async create(user: Omit<User, "user_id" | "created_at" | "updated_at">): Promise<User> {
    const u: User = {
      ...user,
      user_id: `usr-${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.users.push(u);
    return u;
  }

  async update(id: string, updates: Partial<User>): Promise<User | null> {
    const idx = this.users.findIndex((u) => u.user_id === id);
    if (idx === -1) return null;
    this.users[idx] = { ...this.users[idx], ...updates, updated_at: new Date().toISOString() };
    return this.users[idx];
  }
}

export class InMemoryDashboardRepository implements IDashboardRepository {
  async getStats(): Promise<DashboardStats> {
    return {
      total_sku: 1,
      total_quantity: 100,
      low_stock_count: 0,
      out_of_stock_count: 0,
      received_today: 0,
      issued_today: 0,
      recent_movements: [],
      chart_data: [],
    };
  }
}

export class InMemoryIdempotencyRepository implements IIdempotencyRepository {
  private records = new Map<string, IdempotencyRecord>();

  async findByKey(key: string): Promise<IdempotencyRecord | null> {
    return this.records.get(key) || null;
  }

  async create(
    record: Omit<IdempotencyRecord, "created_at" | "updated_at">
  ): Promise<IdempotencyRecord> {
    const now = new Date().toISOString();
    const full: IdempotencyRecord = {
      ...record,
      created_at: now,
      updated_at: now,
    };
    this.records.set(record.key, full);
    return full;
  }

  async update(
    key: string,
    updates: Partial<Pick<IdempotencyRecord, "status" | "response_payload" | "error_message">>
  ): Promise<IdempotencyRecord | null> {
    const existing = this.records.get(key);
    if (!existing) return null;
    const updated: IdempotencyRecord = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.records.set(key, updated);
    return updated;
  }
}

export class InMemoryAuditRepository implements IAuditRepository {
  public logs: AuditLogEntry[] = [];

  async append(entry: Omit<AuditLogEntry, "audit_id" | "timestamp">): Promise<AuditLogEntry> {
    const full: AuditLogEntry = {
      audit_id: `aud-${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.logs.push(full);
    return full;
  }

  async findAll(filters?: {
    actor_id?: string;
    warehouse_id?: string;
    action?: string;
  }): Promise<AuditLogEntry[]> {
    let result = [...this.logs];
    if (filters?.actor_id) result = result.filter((l) => l.actor_id === filters.actor_id);
    if (filters?.warehouse_id) result = result.filter((l) => l.warehouse_id === filters.warehouse_id);
    if (filters?.action) result = result.filter((l) => l.action === filters.action);
    return result;
  }
}

export class InMemoryOperationJournalRepository implements IOperationJournalRepository {
  public operations = new Map<string, OperationRecord>();

  async findById(operationId: string): Promise<OperationRecord | null> {
    return this.operations.get(operationId) || null;
  }

  async findByIdempotencyKey(key: string): Promise<OperationRecord | null> {
    for (const op of this.operations.values()) {
      if (op.idempotency_key === key) return op;
    }
    return null;
  }

  async create(
    record: Omit<OperationRecord, "created_at" | "updated_at">
  ): Promise<OperationRecord> {
    const now = new Date().toISOString();
    const full: OperationRecord = {
      ...record,
      created_at: now,
      updated_at: now,
    };
    this.operations.set(full.operation_id, full);
    return full;
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
    const existing = this.operations.get(operationId);
    if (!existing) return null;
    const updated: OperationRecord = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.operations.set(operationId, updated);
    return updated;
  }

  async findPendingRecovery(): Promise<OperationRecord[]> {
    return Array.from(this.operations.values()).filter(
      (op) => op.status === "MANUAL_REVIEW" || op.status === "RECOVERABLE" || op.status === "COMPENSATING"
    );
  }
}

export class InMemoryWarehouseSyncRepository implements IWarehouseSyncRepository {
  async syncDeduct(): Promise<ProductSyncInfo | null> {
    return null;
  }
  async syncAdd(): Promise<void> {}
  async syncMove(): Promise<void> {}
}

export class InMemoryStockRepository implements IStockRepository {
  warehouses = new InMemoryWarehouseRepository();
  locations = new InMemoryLocationRepository();
  shelves = new InMemoryShelfRepository();
  products = new InMemoryProductRepository();
  documents = new InMemoryDocumentRepository();
  movements = new InMemoryStockMovementRepository();
  stockSummary = new InMemoryStockSummaryRepository();
  stockCounts = new InMemoryStockCountRepository();
  users = new InMemoryUserRepository();
  dashboard = new InMemoryDashboardRepository();
  idempotency = new InMemoryIdempotencyRepository();
  audit = new InMemoryAuditRepository();
  journal = new InMemoryOperationJournalRepository();
  warehouseSync = new InMemoryWarehouseSyncRepository();
}
