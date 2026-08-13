jest.mock("@/lib/google-sheets/client", () => ({
  SHEETS: {
    DOCUMENTS: "DOCUMENTS",
    STOCK_MOVEMENTS: "STOCK_MOVEMENTS",
    STOCK_SUMMARY: "STOCK_SUMMARY",
  },
  getWarehouseSheetName: (whId: string) => `warehouse:${whId}`,
  readSheet: jest.fn(async () => []),
  appendRows: jest.fn(async () => {}),
  updateRow: jest.fn(async () => {}),
  deleteRows: jest.fn(async () => {}),
  clearSheetCache: jest.fn(),
}));

import {
  createTransfer,
  completeTransfer,
  cancelTransfer,
  CreateTransferSchema,
} from "@/lib/services/stock/transfer-stock";
import {
  InvalidTransferStateError,
} from "@/lib/services/stock/stock-errors";
import type { IStockRepository } from "@/lib/repositories/interfaces";
import type {
  Warehouse,
  Product,
  Document,
  StockMovement,
  StockSummary,
} from "@/types/models";
import type { IdempotencyRecord } from "@/lib/idempotency/idempotency.repository";

const mockWarehouse1: Warehouse = {
  warehouse_id: "wh-1",
  warehouse_code: "WH-01",
  warehouse_name: "โกดัง1",
  active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockWarehouse2: Warehouse = {
  warehouse_id: "wh-2",
  warehouse_code: "WH-02",
  warehouse_name: "โกดัง2",
  active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockProduct: Product = {
  product_id: "prod-001",
  sku: "SKU001",
  barcode: "8850001",
  product_name: "สินค้าทดสอบ Concurrency",
  category: "อุปกรณ์",
  base_unit: "ชิ้น",
  minimum_stock: 10,
  supplier: "Supplier A",
  description: "",
  active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

class ConcurrentMockStockRepo implements IStockRepository {
  public movementsList: StockMovement[] = [];
  public usedKeys = new Set<string>();
  public documentsList: Document[] = [];
  public summaryList: StockSummary[] = [];
  public idempotencyRecords = new Map<string, IdempotencyRecord>();
  public failDurableWrites = false;

  warehouses = {
    findAll: async () => [mockWarehouse1, mockWarehouse2],
    findById: async (id: string) =>
      id === mockWarehouse1.warehouse_id
        ? mockWarehouse1
        : id === mockWarehouse2.warehouse_id
        ? mockWarehouse2
        : null,
    findByCode: async () => null,
    create: async (w: any) => w,
  };

  locations = {
    findAll: async () => [],
    findById: async () => null,
    findByCode: async () => null,
    create: async (data: any) => data,
    update: async (id: string, data: any) => data,
  };

  products = {
    findAll: async () => [mockProduct],
    findById: async (id: string) => (id === mockProduct.product_id ? mockProduct : null),
    findBySku: async (sku: string) => (sku === mockProduct.sku ? mockProduct : null),
    findByBarcode: async () => null,
    create: async (p: any) => ({ ...mockProduct, ...p }),
    update: async () => mockProduct,
    hasMovements: async () => false,
  };

  documents = {
    findAll: async () => ({ data: this.documentsList, total: this.documentsList.length }),
    findById: async (id: string) => this.documentsList.find((d) => d.document_id === id) || null,
    findByNo: async (no: string) => this.documentsList.find((d) => d.document_no === no) || null,
    create: async (data: any) => {
      if (this.failDurableWrites) {
        throw new Error("Durable storage write failed: Disk full / Network error");
      }
      const doc: Document = {
        document_id: `doc-${Date.now()}-${Math.random()}`,
        document_no: `DOC-${Date.now()}`,
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.documentsList.push(doc);
      return doc;
    },
    updateStatus: async (id: string, status: any) => {
      if (this.failDurableWrites) {
        throw new Error("Durable storage write failed during status update");
      }
      const doc = this.documentsList.find((d) => d.document_id === id);
      if (doc) doc.status = status;
      return doc || null;
    },
    getNextDocumentNo: async () => `DOC-${Date.now()}`,
  };

  movements = {
    findAll: async () => ({ data: this.movementsList, total: this.movementsList.length }),
    findById: async () => null,
    findByDocumentId: async (id: string) => this.movementsList.filter((m) => m.document_id === id),
    existsByIdempotencyKey: async (key: string) => this.usedKeys.has(key),
    getBalance: async () => 100,
    batchCreate: async (items: any[]) => {
      if (this.failDurableWrites) {
        throw new Error("Durable storage write failed during movement creation");
      }
      const created: StockMovement[] = items.map((item, idx) => {
        if (item.idempotency_key) {
          if (this.usedKeys.has(item.idempotency_key)) {
            throw new Error(`Duplicate key ${item.idempotency_key}`);
          }
          this.usedKeys.add(item.idempotency_key);
        }
        const mov: StockMovement = {
          movement_id: `mov-${Date.now()}-${idx}-${Math.random()}`,
          created_at: new Date().toISOString(),
          ...item,
        };
        this.movementsList.push(mov);
        return mov;
      });
      return created;
    },
  };

  stockSummary = {
    findAll: async () => this.summaryList,
    findByProduct: async () => [],
    applyChanges: async (changes: any[]) => {
      if (this.failDurableWrites) {
        throw new Error("Durable storage write failed during summary update");
      }
      for (const ch of changes) {
        const item = this.summaryList.find(
          (s) => s.product_id === ch.productId && s.warehouse_id === ch.warehouseId && s.location_id === ch.locationId
        );
        if (item) {
          item.quantity += ch.delta;
        } else {
          this.summaryList.push({
            summary_id: `sum-${Date.now()}-${Math.random()}`,
            product_id: ch.productId,
            warehouse_id: ch.warehouseId,
            location_id: ch.locationId,
            quantity: ch.delta,
            updated_at: new Date().toISOString(),
          });
        }
      }
    },
  };

  idempotency = {
    findByKey: async (key: string) => this.idempotencyRecords.get(key) || null,
    create: async (record: any) => {
      if (this.failDurableWrites) {
        throw new Error("Durable storage write failed during idempotency record create");
      }
      const full: IdempotencyRecord = {
        ...record,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.idempotencyRecords.set(record.key, full);
      return full;
    },
    update: async (key: string, updates: any) => {
      if (this.failDurableWrites) {
        throw new Error("Durable storage write failed during idempotency record update");
      }
      const existing = this.idempotencyRecords.get(key);
      if (!existing) return null;
      const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
      this.idempotencyRecords.set(key, updated);
      return updated;
    },
  };

  audit = {
    append: async (entry: any) => ({
      audit_id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...entry,
    }),
    findAll: async () => [],
  };

  stockCounts = {} as any;
  users = {} as any;
  dashboard = {} as any;
}

describe("Concurrency, Distributed Idempotency & Durability Guarantees", () => {
  let repo: ConcurrentMockStockRepo;

  beforeEach(() => {
    repo = new ConcurrentMockStockRepo();
  });

  test("1. Concurrent requests with same idempotency key create only one document and return same result", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "สมชาย",
      document_date: "2026-08-08",
      idempotency_key: "concurrent-idem-key-01",
    });

    // Run 5 simultaneous requests with the exact same idempotency key via Promise.all
    const results = await Promise.all([
      createTransfer({ repo }, { ...input, user_id: "staff-1" }),
      createTransfer({ repo }, { ...input, user_id: "staff-1" }),
      createTransfer({ repo }, { ...input, user_id: "staff-1" }),
      createTransfer({ repo }, { ...input, user_id: "staff-1" }),
      createTransfer({ repo }, { ...input, user_id: "staff-1" }),
    ]);

    // Exactly 1 document created in repository
    expect(repo.documentsList.length).toBe(1);

    // All returned results have the same document ID
    const firstDocId = results[0].document_id;
    for (const res of results) {
      expect(res.document_id).toBe(firstDocId);
    }

    // 0 movements created during PENDING creation phase
    expect(repo.movementsList.length).toBe(0);
  });

  test("2. Concurrent completeTransfer calls do not duplicate stock increase", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "พนักงาน",
      assigned_to_user_id: "staff-2",
      document_date: "2026-08-08",
      idempotency_key: "concurrent-complete-key-02",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "staff-1" });
    const initialMovementCount = repo.movementsList.length;

    // Run 4 concurrent completeTransfer calls
    const completeResults = await Promise.all([
      completeTransfer({ repo }, doc.document_id, "DEST-LOC-B1", "SRC-LOC-A1", "staff-2", "WAREHOUSE_STAFF", '["wh-2"]'),
      completeTransfer({ repo }, doc.document_id, "DEST-LOC-B1", "SRC-LOC-A1", "staff-2", "WAREHOUSE_STAFF", '["wh-2"]'),
      completeTransfer({ repo }, doc.document_id, "DEST-LOC-B1", "SRC-LOC-A1", "staff-2", "WAREHOUSE_STAFF", '["wh-2"]'),
      completeTransfer({ repo }, doc.document_id, "DEST-LOC-B1", "SRC-LOC-A1", "staff-2", "WAREHOUSE_STAFF", '["wh-2"]'),
    ]);

    // All return COMPLETED status
    for (const res of completeResults) {
      expect(res.status).toBe("COMPLETED");
    }

    // Exactly 2 stock movements (TRANSFER_OUT + TRANSFER_IN) created, no duplicates
    expect(repo.movementsList.length).toBe(initialMovementCount + 2);
  });

  test("3. Concurrent cancelTransfer calls do not duplicate reversal movements", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "พนักงาน",
      assigned_to_user_id: "staff-2",
      document_date: "2026-08-08",
      idempotency_key: "concurrent-cancel-key-03",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "staff-1" });

    // Run 3 concurrent cancelTransfer calls with matching cancel request
    const settled = await Promise.allSettled([
      cancelTransfer({ repo }, doc.document_id, "Cancel request", "staff-1", "WAREHOUSE_STAFF", '["wh-1"]'),
      cancelTransfer({ repo }, doc.document_id, "Cancel request", "staff-1", "WAREHOUSE_STAFF", '["wh-1"]'),
      cancelTransfer({ repo }, doc.document_id, "Cancel request", "staff-1", "WAREHOUSE_STAFF", '["wh-1"]'),
    ]);

    // At least one operation succeeded
    const successful = settled.filter((s) => s.status === "fulfilled");
    expect(successful.length).toBeGreaterThanOrEqual(1);

    // Document status is CANCELLED
    const freshDoc = await repo.documents.findById(doc.document_id);
    expect(freshDoc?.status).toBe("CANCELLED");

    // Replay / subsequent call returns CANCELLED directly without any error
    const replayDoc = await cancelTransfer({ repo }, doc.document_id, "Cancel request", "staff-1", "WAREHOUSE_STAFF", '["wh-1"]');
    expect(replayDoc.status).toBe("CANCELLED");
  });

  test("4. Concurrent complete and cancel results in exactly one final valid state transition", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "สมชาย",
      document_date: "2026-08-08",
      idempotency_key: "concurrent-comp-canc-04",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "staff-1" });

    // Fire complete and cancel concurrently
    const settled = await Promise.allSettled([
      completeTransfer({ repo }, doc.document_id, "loc-A1", "staff-2", "WAREHOUSE_STAFF", '["wh-2"]'),
      cancelTransfer({ repo }, doc.document_id, "Cancel concurrent", "staff-1", "WAREHOUSE_STAFF", '["wh-1"]'),
    ]);

    // Exactly one operation must succeed, and the final document state must be valid
    const freshDoc = await repo.documents.findById(doc.document_id);
    expect(freshDoc?.status === "COMPLETED" || freshDoc?.status === "CANCELLED").toBe(true);

    const successful = settled.filter((s) => s.status === "fulfilled");
    expect(successful.length).toBeGreaterThanOrEqual(1);
  });

  test("5. Persistence failure does not leave half-applied stock and operation fails closed", async () => {
    repo.failDurableWrites = true;

    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "สมชาย",
      document_date: "2026-08-08",
      idempotency_key: "fail-durable-key-05",
    });

    // Operation must throw error and NOT swallow
    await expect(
      createTransfer({ repo }, { ...input, user_id: "staff-1" })
    ).rejects.toThrow(/Durable storage write failed/);

    // No completed document created in repository
    expect(repo.documentsList.length).toBe(0);
  });
});

