jest.mock("@/lib/google-sheets/client", () => {
  let sheets: Record<string, string[][]> = {};
  const clone = (rows: string[][]) => rows.map((r) => [...r]);

  return {
    SHEETS: {
      DOCUMENTS: "DOCUMENTS",
      STOCK_MOVEMENTS: "STOCK_MOVEMENTS",
      STOCK_SUMMARY: "STOCK_SUMMARY",
    },
    getWarehouseSheetName: (whId: string) => `warehouse:${whId}`,
    readSheet: jest.fn(async (name: string) => clone(sheets[name] || [])),
    appendRows: jest.fn(async (name: string, rows: unknown[][]) => {
      sheets[name] = [...(sheets[name] || []), ...rows.map((r) => r.map(String))];
    }),
    updateRow: jest.fn(async (name: string, rowNum: number, row: unknown[]) => {
      const rows = sheets[name] || [];
      rows[rowNum - 2] = row.map(String);
      sheets[name] = rows;
    }),
    deleteRows: jest.fn(async (name: string, rowIndices: number[]) => {
      const rows = sheets[name] || [];
      for (const idx of [...rowIndices].sort((a, b) => b - a)) {
        rows.splice(idx - 1, 1);
      }
      sheets[name] = rows;
    }),
    clearSheetCache: jest.fn(),
    __resetSheets: () => { sheets = {}; },
    __setWarehouseRows: (whId: string, rows: string[][]) => {
      sheets[`warehouse:${whId}`] = clone(rows);
    },
  };
});

import {
  createTransfer,
  completeTransfer,
  cancelTransfer,
  CreateTransferSchema,
} from "@/lib/services/stock/transfer-stock";
import {
  InvalidTransferStateError,
  StockNotFoundError,
  UnauthorizedStockOperationError,
} from "@/lib/services/stock/stock-errors";
import type { IStockRepository } from "@/lib/repositories/interfaces";
import type {
  Warehouse,
  Product,
  Document,
  StockMovement,
  StockSummary,
} from "@/types/models";

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
  product_name: "สินค้าทดสอบ 01",
  category: "อุปกรณ์",
  base_unit: "ชิ้น",
  minimum_stock: 10,
  supplier: "Supplier A",
  description: "",
  active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

class MockStockRepo implements IStockRepository {
  public movementsList: StockMovement[] = [];
  public usedKeys = new Set<string>();
  public documentsList: Document[] = [];
  public summaryList: StockSummary[] = [];

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
      const created: StockMovement[] = items.map((item, idx) => {
        if (item.idempotency_key) {
          if (this.usedKeys.has(item.idempotency_key)) {
            throw new Error(`Duplicate key ${item.idempotency_key}`);
          }
          this.usedKeys.add(item.idempotency_key);
        }
        const mov: StockMovement = {
          movement_id: `mov-${Date.now()}-${idx}`,
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
      for (const ch of changes) {
        const item = this.summaryList.find(
          (s) => s.product_id === ch.productId && s.warehouse_id === ch.warehouseId && s.location_id === ch.locationId
        );
        if (item) {
          item.quantity += ch.delta;
        } else {
          this.summaryList.push({
            summary_id: `sum-${Date.now()}`,
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

  stockCounts = {} as any;
  users = {} as any;
  dashboard = {} as any;
}

describe("transferStock Use Cases & Authorization Rules", () => {
  let repo: MockStockRepo;

  beforeEach(() => {
    repo = new MockStockRepo();
  });

  test("1. Source staff can create transfer from source warehouse", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 15,
      moved_by: "สมชาย",
      document_date: "2026-08-08",
      idempotency_key: "idem-trf-1",
    });

    const doc = await createTransfer(
      { repo },
      {
        ...input,
        user_id: "staff-1",
        role: "WAREHOUSE_STAFF",
        warehouse_access: '["wh-1"]',
      }
    );

    expect(doc).toBeDefined();
    expect(doc.document_type).toBe("TRANSFER");
    expect(repo.movementsList.length).toBe(2);
    expect(repo.movementsList.find((m) => m.movement_type === "TRANSFER_OUT")?.qty_change).toBe(-15);
    expect(repo.movementsList.find((m) => m.movement_type === "TRANSFER_IN")?.qty_change).toBe(15);
  });

  test("2. Source staff cannot complete at destination (fails with 403 / UnauthorizedStockOperationError)", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "สมชาย",
      document_date: "2026-08-08",
      idempotency_key: "idem-trf-src-comp",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "staff-1" });

    // Source staff only has access to wh-1, not destination wh-2
    await expect(
      completeTransfer(
        { repo },
        doc.document_id,
        "loc-A1",
        "staff-1",
        "WAREHOUSE_STAFF",
        '["wh-1"]'
      )
    ).rejects.toThrow(UnauthorizedStockOperationError);

    // Document status must not be modified
    const currentDoc = await repo.documents.findById(doc.document_id);
    expect(currentDoc?.status).toBe("POSTED");
  });

  test("3. Destination staff can complete transfer", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "สมชาย",
      document_date: "2026-08-08",
      idempotency_key: "idem-trf-dest-comp",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "staff-1" });

    // Destination staff has access to wh-2
    const completedDoc = await completeTransfer(
      { repo },
      doc.document_id,
      "loc-A1",
      "staff-2",
      "WAREHOUSE_STAFF",
      '["wh-2"]'
    );

    expect(completedDoc.status).toBe("COMPLETED");
  });

  test("4. Destination staff cannot cancel transfer (fails with 403 / UnauthorizedStockOperationError)", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "สมชาย",
      document_date: "2026-08-08",
      idempotency_key: "idem-trf-dest-cancel",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "staff-1" });

    // Destination staff only has access to wh-2, but cancel requires source warehouse (wh-1)
    await expect(
      cancelTransfer(
        { repo },
        doc.document_id,
        "Cancel attempt",
        "staff-2",
        "WAREHOUSE_STAFF",
        '["wh-2"]'
      )
    ).rejects.toThrow(UnauthorizedStockOperationError);

    // Document status must not be modified to CANCELLED
    const currentDoc = await repo.documents.findById(doc.document_id);
    expect(currentDoc?.status).toBe("POSTED");
  });

  test("5. Source staff can cancel transfer", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "สมชาย",
      document_date: "2026-08-08",
      idempotency_key: "idem-trf-src-cancel",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "staff-1" });

    // Source staff has access to wh-1
    const cancelledDoc = await cancelTransfer(
      { repo },
      doc.document_id,
      "Cancel valid",
      "staff-1",
      "WAREHOUSE_STAFF",
      '["wh-1"]'
    );

    expect(cancelledDoc.status).toBe("CANCELLED");
  });

  test("6. Admin can perform all transfer operations across warehouses", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "Admin",
      document_date: "2026-08-08",
      idempotency_key: "idem-trf-admin-all",
    });

    const doc = await createTransfer(
      { repo },
      { ...input, user_id: "admin-1", role: "ADMIN" }
    );
    expect(doc).toBeDefined();

    const completedDoc = await completeTransfer(
      { repo },
      doc.document_id,
      "loc-A1",
      "admin-1",
      "ADMIN"
    );
    expect(completedDoc.status).toBe("COMPLETED");
  });

  test("7. Malformed transfer note must fail closed and NOT mark document completed", async () => {
    // Create a document with malformed note
    const badDoc = await repo.documents.create({
      document_type: "TRANSFER",
      reference_no: "REF-MALFORMED",
      document_date: "2026-08-08",
      status: "POSTED",
      note: "malformed non-json note string",
      created_by: "user-1",
    });

    await expect(
      completeTransfer(
        { repo },
        badDoc.document_id,
        "loc-A1",
        "staff-2",
        "WAREHOUSE_STAFF",
        '["wh-2"]'
      )
    ).rejects.toThrow(InvalidTransferStateError);

    // Document status must not be updated to COMPLETED
    const freshDoc = await repo.documents.findById(badDoc.document_id);
    expect(freshDoc?.status).toBe("POSTED");
  });

  test("8. Unauthorized request does not create movement or change stock", async () => {
    const initialMovementCount = repo.movementsList.length;

    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 5,
      moved_by: "สมชาย",
      document_date: "2026-08-08",
      idempotency_key: "idem-trf-unauth-check",
    });

    // User has access only to wh-2, trying to transfer from wh-1
    await expect(
      createTransfer(
        { repo },
        {
          ...input,
          user_id: "staff-wh2-only",
          role: "WAREHOUSE_STAFF",
          warehouse_access: '["wh-2"]',
        }
      )
    ).rejects.toThrow(UnauthorizedStockOperationError);

    // Movements list must remain completely untouched
    expect(repo.movementsList.length).toBe(initialMovementCount);
  });
});

