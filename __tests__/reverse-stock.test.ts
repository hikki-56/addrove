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

import { reverseStock, ReverseStockSchema } from "@/lib/services/stock/reverse-stock";
import {
  StockAlreadyReversedError,
  StockNotFoundError,
  InsufficientStockError,
} from "@/lib/services/stock/stock-errors";
import type { IStockRepository } from "@/lib/repositories/interfaces";
import type {
  Warehouse,
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

describe("reverseStock Use Case", () => {
  let repo: MockStockRepo;

  beforeEach(() => {
    repo = new MockStockRepo();
  });

  test("should successfully reverse a POSTED document", async () => {
    const originalDoc: Document = {
      document_id: "doc-orig-1",
      document_no: "RCV-001",
      document_type: "RECEIVE",
      document_date: "2026-08-08",
      status: "POSTED",
      created_by: "user-1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    repo.documentsList.push(originalDoc);

    const origMovement: StockMovement = {
      movement_id: "mov-orig-1",
      document_id: originalDoc.document_id,
      product_id: "prod-001",
      warehouse_id: "wh-1",
      location_id: "loc-A",
      qty_change: 25,
      movement_type: "RECEIVE_IN",
      created_by: "user-1",
      created_at: new Date().toISOString(),
    };
    repo.movementsList.push(origMovement);

    const input = ReverseStockSchema.parse({
      original_document_id: originalDoc.document_id,
      note: "ยกเลิกรายการรับ",
      idempotency_key: "idem-rev-1",
    });

    const revDoc = await reverseStock({ repo }, { ...input, user_id: "user-1" });
    expect(revDoc).toBeDefined();
    expect(revDoc.document_type).toBe("REVERSAL");
    expect(revDoc.reference_no).toBe(originalDoc.document_no);

    const revMov = repo.movementsList.find((m) => m.document_id === revDoc.document_id);
    expect(revMov).toBeDefined();
    expect(revMov?.qty_change).toBe(-25);
    expect(revMov?.movement_type).toBe("REVERSAL");
  });

  test("should throw StockAlreadyReversedError if document was already reversed", async () => {
    const originalDoc: Document = {
      document_id: "doc-orig-2",
      document_no: "RCV-002",
      document_type: "RECEIVE",
      document_date: "2026-08-08",
      status: "POSTED",
      created_by: "user-1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    repo.documentsList.push(originalDoc);

    // Existing reversal
    repo.documentsList.push({
      document_id: "doc-rev-prev",
      document_no: "REV-001",
      document_type: "REVERSAL",
      reference_no: originalDoc.document_no,
      document_date: "2026-08-08",
      status: "POSTED",
      created_by: "user-1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const input = ReverseStockSchema.parse({
      original_document_id: originalDoc.document_id,
      idempotency_key: "idem-rev-dup",
    });

    await expect(reverseStock({ repo }, { ...input, user_id: "user-1" })).rejects.toThrow(
      StockAlreadyReversedError
    );
  });

  test("should throw StockNotFoundError if original document does not exist", async () => {
    const input = ReverseStockSchema.parse({
      original_document_id: "doc-non-existent",
      idempotency_key: "idem-rev-none",
    });

    await expect(reverseStock({ repo }, { ...input, user_id: "user-1" })).rejects.toThrow(
      StockNotFoundError
    );
  });
});
