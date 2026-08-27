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
  syncServerTransferNotifications,
  getPendingTransferNotifications,
  getTransferNotifications,
} from "@/lib/transfer-notification-utils";
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
    getBalance: async (productId: string, warehouseId: string, locationId: string) => {
      const locationMovs = this.movementsList.filter(
        (m) => m.product_id === productId && m.warehouse_id === warehouseId && m.location_id === locationId
      );
      if (locationMovs.length > 0) {
        return locationMovs.reduce((sum, m) => sum + m.qty_change, 0);
      }
      const locSummary = this.summaryList.find(
        (s) => s.product_id === productId && s.warehouse_id === warehouseId && s.location_id === locationId
      );
      if (locSummary) return locSummary.quantity;
      return 100;
    },
    getWarehouseBalance: async (productId: string, warehouseId: string) => {
      const whMovs = this.movementsList.filter(
        (m) => m.product_id === productId && m.warehouse_id === warehouseId
      );
      if (whMovs.length > 0) {
        return whMovs.reduce((sum, m) => sum + m.qty_change, 0);
      }
      const whSummaries = this.summaryList.filter(
        (s) => s.product_id === productId && s.warehouse_id === warehouseId
      );
      if (whSummaries.length > 0) {
        return whSummaries.reduce((sum, s) => sum + s.quantity, 0);
      }
      return 100;
    },
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

  public usersList: Array<{ id: string; full_name: string; active?: boolean }> = [
    { id: "staff-2", full_name: "สมศักดิ์ ขยันยิ่ง", active: true },
    { id: "staff-dup-1", full_name: "พนักงานซ้ำ", active: true },
    { id: "staff-dup-2", full_name: "พนักงานซ้ำ", active: true },
  ];

  stockCounts = {} as any;
  users = {
    findAll: async () => this.usersList,
  } as any;
  dashboard = {} as any;
}

describe("transferStock Use Cases & Authorization Rules", () => {
  let repo: MockStockRepo;

  beforeEach(() => {
    repo = new MockStockRepo();
  });

  test("1. Source staff can create transfer from source warehouse in PENDING status without immediate movements", async () => {
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
    expect(doc.status).toBe("PENDING");
    expect(repo.movementsList.length).toBe(0);
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
    expect(doc.status).toBe("PENDING");

    // Source staff only has access to wh-1, not destination wh-2
    await expect(
      completeTransfer(
        { repo },
        doc.document_id,
        "loc-A1",
        "loc-A1",
        "staff-1",
        "WAREHOUSE_STAFF",
        '["wh-1"]'
      )
    ).rejects.toThrow(UnauthorizedStockOperationError);

    // Document status must remain PENDING
    const currentDoc = await repo.documents.findById(doc.document_id);
    expect(currentDoc?.status).toBe("PENDING");
  });

  test("3. Destination staff can complete transfer when assigned to them", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 10,
      moved_by: "พนักงาน",
      assigned_to_user_id: "staff-2",
      document_date: "2026-08-08",
      idempotency_key: "idem-trf-dest-comp",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "staff-1" });
    expect(doc.status).toBe("PENDING");

    // Destination staff has access to wh-2
    const completedDoc = await completeTransfer(
      { repo },
      doc.document_id,
      "loc-A1",
      "loc-A1",
      "staff-2",
      "WAREHOUSE_STAFF",
      '["wh-2"]'
    );

    expect(completedDoc.status).toBe("COMPLETED");
    expect(repo.movementsList.length).toBe(2);
    expect(repo.movementsList.find((m) => m.movement_type === "TRANSFER_OUT")?.qty_change).toBe(-10);
    expect(repo.movementsList.find((m) => m.movement_type === "TRANSFER_IN")?.qty_change).toBe(10);
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
    expect(currentDoc?.status).toBe("PENDING");
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
    expect(doc.status).toBe("PENDING");

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
      status: "PENDING",
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
    expect(freshDoc?.status).toBe("PENDING");
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

  test("9. VIEWER role cannot complete or cancel transfer", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 5,
      moved_by: "สมชาย",
      document_date: "2026-08-08",
      idempotency_key: "idem-viewer-check",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "staff-1", role: "WAREHOUSE_STAFF" });

    await expect(
      completeTransfer({ repo }, doc.document_id, "loc-A1", "loc-A1", "viewer-1", "VIEWER", '["wh-2"]')
    ).rejects.toThrow(UnauthorizedStockOperationError);

    await expect(
      cancelTransfer({ repo }, doc.document_id, "Cancel viewer", "viewer-1", "VIEWER", '["wh-1"]')
    ).rejects.toThrow(UnauthorizedStockOperationError);
  });

  test("10. Multi-location source stock: Create transfer 50,000 when total is 100,000 split across 2 locations", async () => {
    repo.summaryList.push(
      { summary_id: "s1", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L1", quantity: 50000, updated_at: "" },
      { summary_id: "s2", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L2", quantity: 50000, updated_at: "" }
    );

    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 50000,
      moved_by: "พนักงาน",
      assigned_to_user_id: "staff-2",
      document_date: "2026-08-13",
      idempotency_key: "idem-multi-loc-create",
    });

    const doc = await createTransfer(
      { repo },
      { ...input, user_id: "admin-1", role: "ADMIN" }
    );

    expect(doc).toBeDefined();
    expect(doc.status).toBe("PENDING");

    const noteObj = JSON.parse(doc.note);
    expect(noteObj.from_location_id).toBe("");
    expect(noteObj.from_location_id).not.toBe("A1");
  });

  test("11. Complete transfer succeeds when selecting source location L1 with sufficient stock (50,000)", async () => {
    repo.summaryList.push(
      { summary_id: "s1", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L1", quantity: 50000, updated_at: "" },
      { summary_id: "s2", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L2", quantity: 50000, updated_at: "" }
    );

    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 50000,
      moved_by: "พนักงาน",
      assigned_to_user_id: "staff-2",
      document_date: "2026-08-13",
      idempotency_key: "idem-multi-loc-comp-succ",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "admin-1", role: "ADMIN" });

    const completedDoc = await completeTransfer(
      { repo },
      doc.document_id,
      "DEST-LOC-B1",
      "L1",
      "staff-2",
      "WAREHOUSE_STAFF",
      '["wh-2"]'
    );

    expect(completedDoc.status).toBe("COMPLETED");

    const outMov = repo.movementsList.find((m) => m.movement_type === "TRANSFER_OUT");
    const inMov = repo.movementsList.find((m) => m.movement_type === "TRANSFER_IN");

    expect(outMov?.location_id).toBe("L1");
    expect(outMov?.qty_change).toBe(-50000);
    expect(inMov?.location_id).toBe("DEST-LOC-B1");
    expect(inMov?.qty_change).toBe(50000);
  });

  test("12. Complete transfer fails when selecting source location L3 with insufficient stock (10,000)", async () => {
    repo.summaryList.push(
      { summary_id: "s1", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L1", quantity: 50000, updated_at: "" },
      { summary_id: "s3", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L3", quantity: 10000, updated_at: "" }
    );

    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 50000,
      moved_by: "พนักงาน",
      assigned_to_user_id: "staff-2",
      document_date: "2026-08-13",
      idempotency_key: "idem-multi-loc-insuff",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "admin-1", role: "ADMIN" });
    const initialMovCount = repo.movementsList.length;

    await expect(
      completeTransfer(
        { repo },
        doc.document_id,
        "DEST-LOC-B1",
        "L3",
        "staff-2",
        "WAREHOUSE_STAFF",
        '["wh-2"]'
      )
    ).rejects.toThrow(/ไม่พอย้าย|ไม่เพียงพอ/);

    expect(repo.movementsList.length).toBe(initialMovCount);

    const freshDoc = await repo.documents.findById(doc.document_id);
    expect(freshDoc?.status).toBe("PENDING");
  });

  test("13. createTransfer saves complete product snapshot (product_id, sku, barcode, product_name, base_unit) into note JSON", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 5,
      moved_by: "สมชาย",
      document_date: "2026-08-13",
      idempotency_key: "idem-snapshot-test",
    });

    const doc = await createTransfer(
      { repo },
      { ...input, user_id: "admin-1", role: "ADMIN" }
    );

    const meta = JSON.parse(doc.note);
    expect(meta.product_id).toBe("prod-001");
    expect(meta.sku).toBe("SKU001");
    expect(meta.barcode).toBe("8850001");
    expect(meta.product_name).toBe("สินค้าทดสอบ 01");
    expect(meta.base_unit).toBe("ชิ้น");
  });

  test("14. createTransfer fails with StockNotFoundError when product_id is invalid", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "non-existent-product-id",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 5,
      moved_by: "สมชาย",
      document_date: "2026-08-13",
      idempotency_key: "idem-invalid-product",
    });

    await expect(
      createTransfer(
        { repo },
        { ...input, user_id: "admin-1", role: "ADMIN" }
      )
    ).rejects.toThrow(StockNotFoundError);
  });

  test("14b. createTransfer succeeds for a SKU that holds warehouse stock but is absent from the PRODUCTS master sheet", async () => {
    // Regression: warehouse sheets can carry stock for a SKU that was never
    // registered in PRODUCTS. The client sends the sku/barcode/name it read from
    // that same warehouse row, so the transfer must go through on those instead of
    // failing with "ไม่พบข้อมูลสินค้าสำหรับรหัส prod-<sku>". Issue and move already
    // allow this; transfer used to be the only flow that rejected it.
    repo.products.findById = async () => null;
    repo.products.findBySku = async () => null;
    repo.products.findByBarcode = async () => null;

    // Stock lives in the warehouse sheet under the synthesized product_id, mirroring
    // the real case: 8,000 on hand in the source warehouse.
    repo.summaryList.push({
      summary_id: "s-unreg",
      product_id: "prod-0สถล-024",
      warehouse_id: "wh-1",
      location_id: "L1",
      quantity: 8000,
      updated_at: "",
    } as never);

    const input = CreateTransferSchema.parse({
      product_id: "prod-0สถล-024",
      sku: "0สถล-024",
      barcode: "90002892",
      product_name: "2699#JW-สายถักSTL 24นิ้ว",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 400,
      moved_by: "พนักงาน",
      document_date: "2026-08-27",
      idempotency_key: "idem-unregistered-sku",
    });

    const doc = await createTransfer(
      { repo },
      { ...input, user_id: "admin-1", role: "ADMIN" }
    );

    expect(doc.status).toBe("PENDING");
    const note = JSON.parse(doc.note);
    expect(note.sku).toBe("0สถล-024");
    expect(note.barcode).toBe("90002892");
    expect(note.product_name).toBe("2699#JW-สายถักSTL 24นิ้ว");
    expect(note.qty).toBe(400);
  });

  test("14c. createTransfer still rejects an unknown product when the caller sends no sku or barcode", async () => {
    repo.products.findById = async () => null;
    repo.products.findBySku = async () => null;
    repo.products.findByBarcode = async () => null;

    const input = CreateTransferSchema.parse({
      product_id: "prod-ไม่มีจริง-999",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 5,
      moved_by: "สมชาย",
      document_date: "2026-08-27",
      idempotency_key: "idem-no-identifying-data",
    });

    await expect(
      createTransfer({ repo }, { ...input, user_id: "admin-1", role: "ADMIN" })
    ).rejects.toThrow(StockNotFoundError);
  });

  test("15. syncServerTransferNotifications correctly extracts barcode and product details from snapshot", () => {
    const storage: Record<string, string> = {};
    const originalWindow = (global as any).window;
    const originalLocalStorage = (global as any).localStorage;

    (global as any).window = {
      dispatchEvent: () => {},
    };
    (global as any).localStorage = {
      getItem: (k: string) => storage[k] || null,
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
    };

    const serverDocs = [
      {
        document_id: "doc-trf-sync-1",
        document_no: "TRF-2026-001",
        document_type: "TRANSFER",
        status: "PENDING",
        note: JSON.stringify({
          from_warehouse_id: "wh-1",
          to_warehouse_id: "wh-2",
          product_id: "prod-001",
          sku: "SKU-001",
          barcode: "8850000111222",
          product_name: "สินค้าทดสอบ A",
          qty: 10,
          moved_by: "สมชาย",
        }),
        created_at: new Date().toISOString(),
      },
    ];

    syncServerTransferNotifications(serverDocs);

    const notifications = getTransferNotifications();
    const synced = notifications.find((t) => t.doc_no === "TRF-2026-001" || t.id === "doc-trf-sync-1");

    expect(synced).toBeDefined();
    expect(synced?.barcode).toBe("8850000111222");
    expect(synced?.sku).toBe("SKU-001");
    expect(synced?.product_name).toBe("สินค้าทดสอบ A");

    (global as any).window = originalWindow;
    (global as any).localStorage = originalLocalStorage;
  });

  test("16. Staff with matching assigned_to_user_id can complete task", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 5,
      moved_by: "สมศักดิ์ ขยันยิ่ง",
      assigned_to_user_id: "staff-2",
      assigned_to_name: "สมศักดิ์ ขยันยิ่ง",
      document_date: "2026-08-13",
      idempotency_key: "idem-auth-match-user-id",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "admin-1", role: "ADMIN" });

    const completed = await completeTransfer(
      { repo },
      doc.document_id,
      "DEST-LOC-B1",
      "loc-A",
      "staff-2",
      "WAREHOUSE_STAFF",
      '["wh-2"]'
    );

    expect(completed.status).toBe("COMPLETED");
  });

  test("17. Staff with different User ID cannot complete task (throws 403 / UnauthorizedStockOperationError) even if names match", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 5,
      moved_by: "สมศักดิ์ ขยันยิ่ง",
      assigned_to_user_id: "staff-2",
      assigned_to_name: "สมศักดิ์ ขยันยิ่ง",
      document_date: "2026-08-13",
      idempotency_key: "idem-auth-diff-user-id",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "admin-1", role: "ADMIN" });

    // staff-other has the same name "สมศักดิ์ ขยันยิ่ง" but a different ID "staff-other"
    await expect(
      completeTransfer(
        { repo },
        doc.document_id,
        "DEST-LOC-B1",
        "loc-A",
        "staff-other",
        "WAREHOUSE_STAFF",
        '["wh-2"]'
      )
    ).rejects.toThrow(UnauthorizedStockOperationError);
  });

  test("18. Admin can complete any transfer task regardless of assigned_to_user_id", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 5,
      moved_by: "สมศักดิ์ ขยันยิ่ง",
      assigned_to_user_id: "staff-2",
      assigned_to_name: "สมศักดิ์ ขยันยิ่ง",
      document_date: "2026-08-13",
      idempotency_key: "idem-admin-override",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "admin-1", role: "ADMIN" });

    const completed = await completeTransfer(
      { repo },
      doc.document_id,
      "DEST-LOC-B1",
      "loc-A",
      "admin-999",
      "ADMIN"
    );

    expect(completed.status).toBe("COMPLETED");
  });

  test("19. Legacy task without assigned_to_user_id succeeds via exact name match if unique", async () => {
    // Create a legacy document with no assigned_to_user_id
    const legacyDoc = await repo.documents.create({
      document_type: "TRANSFER",
      reference_no: "REF-LEGACY-1",
      document_date: "2026-08-13",
      status: "PENDING",
      note: JSON.stringify({
        from_warehouse_id: "wh-1",
        to_warehouse_id: "wh-2",
        from_location_id: "loc-A",
        to_location_id: "DEST-LOC-B1",
        product_id: "prod-001",
        qty: 5,
        assigned_to_name: "สมศักดิ์ ขยันยิ่ง", // Unique name in mock users repo -> staff-2
      }),
      created_by: "admin-1",
    });

    const completed = await completeTransfer(
      { repo },
      legacyDoc.document_id,
      "DEST-LOC-B1",
      "loc-A",
      "staff-2",
      "WAREHOUSE_STAFF",
      '["wh-2"]'
    );

    expect(completed.status).toBe("COMPLETED");
  });

  test("20. Legacy task with duplicate matching names fails closed with clear error message", async () => {
    const legacyDoc = await repo.documents.create({
      document_type: "TRANSFER",
      reference_no: "REF-LEGACY-DUP",
      document_date: "2026-08-13",
      status: "PENDING",
      note: JSON.stringify({
        from_warehouse_id: "wh-1",
        to_warehouse_id: "wh-2",
        from_location_id: "loc-A",
        to_location_id: "DEST-LOC-B1",
        product_id: "prod-001",
        qty: 5,
        assigned_to_name: "พนักงานซ้ำ", // 2 users in repo match this name -> ambiguous
      }),
      created_by: "admin-1",
    });

    await expect(
      completeTransfer(
        { repo },
        legacyDoc.document_id,
        "DEST-LOC-B1",
        "loc-A",
        "staff-dup-1",
        "WAREHOUSE_STAFF",
        '["wh-2"]'
      )
    ).rejects.toThrow(/พบพนักงานชื่อนี้หลายคน|ให้ Admin มอบหมายงานใหม่/);
  });

  test("21. Complete transfer with multi-source location picking (50,000 from L1 + 10,000 from L2 = 60,000 total) succeeds", async () => {
    repo.summaryList.push(
      { summary_id: "sum-multi-l1", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L1", quantity: 50000, updated_at: "" },
      { summary_id: "sum-multi-l2", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L2", quantity: 50000, updated_at: "" }
    );

    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 60000,
      moved_by: "สมศักดิ์ ขยันยิ่ง",
      assigned_to_user_id: "staff-2",
      assigned_to_name: "สมศักดิ์ ขยันยิ่ง",
      document_date: "2026-08-13",
      idempotency_key: "idem-multi-pick-succ",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "admin-1", role: "ADMIN" });

    const completedDoc = await completeTransfer(
      { repo },
      doc.document_id,
      "DEST-B1",
      "L1",
      "staff-2",
      "WAREHOUSE_STAFF",
      '["wh-2"]',
      [
        { location_id: "L1", qty: 50000 },
        { location_id: "L2", qty: 10000 },
      ]
    );

    expect(completedDoc.status).toBe("COMPLETED");

    const outL1 = repo.movementsList.find((m) => m.movement_type === "TRANSFER_OUT" && m.location_id === "L1");
    const outL2 = repo.movementsList.find((m) => m.movement_type === "TRANSFER_OUT" && m.location_id === "L2");
    const inB1 = repo.movementsList.find((m) => m.movement_type === "TRANSFER_IN" && m.location_id === "DEST-B1");

    expect(outL1?.qty_change).toBe(-50000);
    expect(outL2?.qty_change).toBe(-10000);
    expect(inB1?.qty_change).toBe(60000);
  });

  test("22. Complete transfer with multi-source allocations fails if sum of picked quantities does not match document qty", async () => {
    repo.summaryList.push({
      summary_id: "sum-mismatch-l1",
      product_id: "prod-001",
      warehouse_id: "wh-1",
      location_id: "L1",
      quantity: 60000,
      updated_at: "",
    });

    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 60000,
      moved_by: "สมศักดิ์ ขยันยิ่ง",
      assigned_to_user_id: "staff-2",
      assigned_to_name: "สมศักดิ์ ขยันยิ่ง",
      document_date: "2026-08-13",
      idempotency_key: "idem-multi-pick-mismatch",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "admin-1", role: "ADMIN" });

    await expect(
      completeTransfer(
        { repo },
        doc.document_id,
        "DEST-B1",
        "L1",
        "staff-2",
        "WAREHOUSE_STAFF",
        '["wh-2"]',
        [
          { location_id: "L1", qty: 30000 },
          { location_id: "L2", qty: 20000 }, // sum = 50,000, but doc.qty = 60,000
        ]
      )
    ).rejects.toThrow(/ไม่ตรงกับจำนวนตามใบงาน/);
  });

  test("23. Complete transfer with multi-source allocations fails if any source location has insufficient stock", async () => {
    repo.summaryList.push(
      { summary_id: "sum-insuff-l1", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L1", quantity: 50000, updated_at: "" },
      { summary_id: "sum-insuff-l2", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L2", quantity: 5000, updated_at: "" }, // Only 5,000 available
      { summary_id: "sum-insuff-l3", product_id: "prod-001", warehouse_id: "wh-1", location_id: "L3", quantity: 20000, updated_at: "" } // Total = 75,000
    );

    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 60000,
      moved_by: "สมศักดิ์ ขยันยิ่ง",
      assigned_to_user_id: "staff-2",
      assigned_to_name: "สมศักดิ์ ขยันยิ่ง",
      document_date: "2026-08-13",
      idempotency_key: "idem-multi-pick-insuff-loc",
    });

    const doc = await createTransfer({ repo }, { ...input, user_id: "admin-1", role: "ADMIN" });

    await expect(
      completeTransfer(
        { repo },
        doc.document_id,
        "DEST-B1",
        "L1",
        "staff-2",
        "WAREHOUSE_STAFF",
        '["wh-2"]',
        [
          { location_id: "L1", qty: 50000 },
          { location_id: "L2", qty: 10000 }, // L2 only has 5,000 -> insufficient
        ]
      )
    ).rejects.toThrow(/ไม่เพียงพอสำหรับจำนวนที่เลือกหยิบ/);
  });

  test("24. createTransfer preserves 13-digit barcode without converting or truncating to 8 digits", async () => {
    const input = CreateTransferSchema.parse({
      product_id: "prod-001",
      barcode: "8851234567890",
      sku: "SKU001",
      product_name: "ก๊อกน้ำ EAN-13 8851234567890",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      qty: 2,
      moved_by: "สมชาย",
      document_date: "2026-08-13",
      idempotency_key: "idem-13digit-test",
    });

    const doc = await createTransfer(
      { repo },
      { ...input, user_id: "admin-1", role: "ADMIN" }
    );

    const meta = JSON.parse(doc.note);
    expect(meta.barcode).toBe("8851234567890");
    expect(meta.barcode.length).toBe(13);
    expect(meta.sku).toBe("SKU001");
    expect(meta.product_name).toBe("ก๊อกน้ำ EAN-13 8851234567890");
  });
});

