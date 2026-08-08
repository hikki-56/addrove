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

import { receiveStock, ReceiveStockSchema } from "@/lib/services/stock/receive-stock";
import { StockConflictError, StockNotFoundError } from "@/lib/services/stock/stock-errors";
import type { IStockRepository } from "@/lib/repositories/interfaces";
import type {
  Warehouse,
  Location,
  Product,
  Document,
  StockMovement,
  StockSummary,
} from "@/types/models";

const mockWarehouse: Warehouse = {
  warehouse_id: "wh-1",
  warehouse_code: "WH-01",
  warehouse_name: "โกดัง1",
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
    findAll: async () => [mockWarehouse],
    findById: async (id: string) => (id === mockWarehouse.warehouse_id ? mockWarehouse : null),
    findByCode: async () => null,
    create: async () => mockWarehouse,
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
    getBalance: async () => 0,
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

describe("receiveStock Use Case", () => {
  let repo: MockStockRepo;

  beforeEach(() => {
    repo = new MockStockRepo();
  });

  test("should successfully receive stock and create movements", async () => {
    const input = ReceiveStockSchema.parse({
      warehouse_id: "wh-1",
      document_date: "2026-08-08",
      reference_no: "RCV-001",
      note: "รับสินค้าทดสอบ",
      idempotency_key: "idem-rcv-1",
      lines: [
        { product_id: "prod-001", qty: 50, location_id: "loc-14A1" },
      ],
    });

    const doc = await receiveStock({ repo }, { ...input, user_id: "user-1" });
    expect(doc).toBeDefined();
    expect(doc.document_type).toBe("RECEIVE");
    expect(doc.status).toBe("PENDING");
  });

  test("should throw StockConflictError if idempotency key is duplicate", async () => {
    repo.usedKeys.add("idem-duplicate");

    const input = ReceiveStockSchema.parse({
      warehouse_id: "wh-1",
      document_date: "2026-08-08",
      idempotency_key: "idem-duplicate",
      lines: [{ product_id: "prod-001", qty: 10 }],
    });

    await expect(receiveStock({ repo }, { ...input, user_id: "user-1" })).rejects.toThrow(
      StockConflictError
    );
  });

  test("should throw StockNotFoundError if warehouse does not exist", async () => {
    const input = ReceiveStockSchema.parse({
      warehouse_id: "wh-unknown",
      document_date: "2026-08-08",
      idempotency_key: "idem-unknown-wh",
      lines: [{ product_id: "prod-001", qty: 10 }],
    });

    await expect(receiveStock({ repo }, { ...input, user_id: "user-1" })).rejects.toThrow(
      StockNotFoundError
    );
  });
});
