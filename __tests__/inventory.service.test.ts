// ============================================================
// Unit Tests for InventoryService — 8 required test cases
// Uses in-memory mock repositories (no Google Sheets needed)
// ============================================================
jest.mock("@/lib/google-sheets/client", () => {
  let sheets: Record<string, string[][]> = {};
  const clone = (rows: string[][]) => rows.map((row) => [...row]);

  return {
    SHEETS: {
      DOCUMENTS: "DOCUMENTS",
      STOCK_MOVEMENTS: "STOCK_MOVEMENTS",
      STOCK_SUMMARY: "STOCK_SUMMARY",
    },
    getWarehouseSheetName: (warehouseId: string) => `warehouse:${warehouseId}`,
    readSheet: jest.fn(async (sheetName: string) => clone(sheets[sheetName] || [])),
    appendRows: jest.fn(async (sheetName: string, rows: unknown[][]) => {
      sheets[sheetName] = [...(sheets[sheetName] || []), ...rows.map((row) => row.map(String))];
    }),
    updateRow: jest.fn(async (sheetName: string, rowNumber: number, row: unknown[]) => {
      const rows = sheets[sheetName] || [];
      rows[rowNumber - 2] = row.map(String);
      sheets[sheetName] = rows;
    }),
    deleteRows: jest.fn(async (sheetName: string, rowIndices: number[]) => {
      const rows = sheets[sheetName] || [];
      for (const rowIndex of [...rowIndices].sort((a, b) => b - a)) {
        rows.splice(rowIndex - 1, 1);
      }
      sheets[sheetName] = rows;
    }),
    clearSheetCache: jest.fn(),
    __resetSheets: () => { sheets = {}; },
    __setWarehouseRows: (warehouseId: string, rows: string[][]) => {
      sheets[`warehouse:${warehouseId}`] = clone(rows);
    },
  };
});

import { InventoryService } from "@/lib/services/inventory.service";
import type { IStockRepository } from "@/lib/repositories/interfaces";
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

const sheetMock = jest.requireMock("@/lib/google-sheets/client") as {
  __resetSheets: () => void;
  __setWarehouseRows: (warehouseId: string, rows: string[][]) => void;
};

// ------ In-memory store ------
class MockRepo implements IStockRepository {
  public movementsList: StockMovement[] = [];
  public usedKeys = new Set<string>();
  public documentsList: Document[] = [];

  warehouses = {
    findAll: async () => [mockWarehouse],
    findById: async (id: string) => (id === mockWarehouse.warehouse_id ? mockWarehouse : null),
    findByCode: async () => null,
    create: async () => mockWarehouse,
  };

  locations = {
    findAll: async () => [mockLocationA, mockLocationB],
    findById: async (id: string) => {
      if (id === mockLocationA.location_id) return mockLocationA;
      if (id === mockLocationB.location_id) return mockLocationB;
      return null;
    },
    findByCode: async () => null,
    create: async () => mockLocationA,
    update: async () => mockLocationA,
  };

  products = {
    findAll: async () => [mockProduct],
    findById: async (id: string) => (id === mockProduct.product_id ? mockProduct : null),
    findBySku: async () => null,
    findByBarcode: async () => null,
    create: async () => mockProduct,
    update: async () => mockProduct,
    hasMovements: async () => false,
  };

  documents: IStockRepository["documents"];
  movements: IStockRepository["movements"];
  stockSummary: IStockRepository["stockSummary"];
  stockCounts: IStockRepository["stockCounts"];
  users: IStockRepository["users"];
  dashboard: IStockRepository["dashboard"];

  constructor() {
    const self = this;

    this.documents = {
      findAll: async () => ({ data: self.documentsList, total: self.documentsList.length }),
      findById: async (id: string) => self.documentsList.find((d) => d.document_id === id) ?? null,
      findByNo: async (no: string) => self.documentsList.find((d) => d.document_no === no) ?? null,
      create: async (doc: Omit<Document, "document_id" | "document_no" | "created_at">) => {
        const newDoc: Document = {
          ...doc,
          document_id: `doc-${Date.now()}-${Math.random()}`,
          document_no: `DOC-${Date.now()}`,
          created_at: new Date().toISOString(),
        };
        self.documentsList.push(newDoc);
        return newDoc;
      },
      updateStatus: async () => {},
      generateDocumentNo: async () => `DOC-${Date.now()}`,
    };

    this.movements = {
      findByDocumentId: async (docId: string) =>
        self.movementsList.filter((m) => m.document_id === docId),
      findAll: async () => ({ data: [] as MovementWithDetails[], total: 0 }),
      getBalance: async (productId: string, warehouseId: string, locationId: string) =>
        self.movementsList
          .filter(
            (m) =>
              m.product_id === productId &&
              m.warehouse_id === warehouseId &&
              m.location_id === locationId
          )
          .reduce((sum, m) => sum + m.qty_change, 0),
      getWarehouseBalance: async (productId: string, warehouseId: string) =>
        self.movementsList
          .filter((m) => m.product_id === productId && m.warehouse_id === warehouseId)
          .reduce((sum, m) => sum + m.qty_change, 0),
      existsByIdempotencyKey: async (key: string) => self.usedKeys.has(key),
      batchCreate: async (
        items: Omit<StockMovement, "movement_id" | "created_at">[]
      ): Promise<StockMovement[]> => {
        const created: StockMovement[] = items.map((item, i) => ({
          ...item,
          movement_id: `mov-${Date.now()}-${i}`,
          created_at: new Date().toISOString(),
        }));
        self.movementsList.push(...created);
        created.forEach((m) => self.usedKeys.add(m.idempotency_key));
        return created;
      },
    };

    this.stockSummary = {
      findAll: async () => [] as StockSummary[],
      findByProductAndLocation: async () => null,
      applyChanges: async () => {},
      rebuild: async () => {},
    };

    this.stockCounts = {
      findAll: async () => [] as StockCount[],
      findById: async () => null,
      create: async () => ({ count_id: "test", count_no: "CNT-001" } as StockCount),
      update: async () => null,
    };

    this.users = {
      findAll: async () => [] as User[],
      findById: async () => null,
      findByEmail: async () => null,
      create: async () => ({ user_id: "u1" } as User),
      update: async () => null,
    };

    this.dashboard = {
      getStats: async () => ({
        total_sku: 0,
        total_quantity: 0,
        low_stock_count: 0,
        out_of_stock_count: 0,
        received_today: 0,
        issued_today: 0,
        recent_movements: [] as MovementWithDetails[],
        chart_data: [],
      } as DashboardStats),
    };
  }
}

// ------ Test fixtures ------
const mockWarehouse: Warehouse = {
  warehouse_id: "wh-1",
  warehouse_code: "WH001",
  warehouse_name: "คลังสินค้าหลัก",
  address: "",
  active: true,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const mockLocationA: Location = {
  location_id: "loc-A",
  warehouse_id: "wh-1",
  zone: "A",
  aisle: "01",
  rack: "01",
  shelf: "01",
  bin: "01",
  location_code: "WH01-ZA-01-R01-S01-B01",
  description: "",
  active: true,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const mockLocationB: Location = {
  location_id: "loc-B",
  warehouse_id: "wh-1",
  zone: "B",
  aisle: "01",
  rack: "01",
  shelf: "01",
  bin: "01",
  location_code: "WH01-ZB-01-R01-S01-B01",
  description: "",
  active: true,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const mockProduct: Product = {
  product_id: "prod-1",
  sku: "SKU001",
  barcode: "1234567890",
  product_name: "สินค้าทดสอบ",
  category: "ทั่วไป",
  base_unit: "ชิ้น",
  minimum_stock: 10,
  description: "",
  active: true,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

function seedStock(repo: MockRepo, quantity: number, locationId = "loc-A") {
  repo.movementsList.push({
    movement_id: `opening-${locationId}`,
    document_id: "opening-doc",
    product_id: "prod-1",
    warehouse_id: "wh-1",
    location_id: locationId,
    qty_change: quantity,
    movement_type: "OPENING",
    idempotency_key: `opening-${locationId}`,
    created_by: "system",
    created_at: "2024-01-01T00:00:00Z",
  });
  sheetMock.__setWarehouseRows("wh-1", [[
    "SKU001",
    "1234567890",
    "สินค้าทดสอบ",
    "ทั่วไป",
    "ชิ้น",
    String(quantity),
    locationId.replace(/^loc-/, ""),
    "",
    "2024-01-01T00:00:00Z",
  ]]);
}

// ============================================================
// Tests
// ============================================================

describe("InventoryService", () => {
  let repo: MockRepo;
  let service: InventoryService;

  beforeEach(() => {
    sheetMock.__resetSheets();
    repo = new MockRepo();
    service = new InventoryService(repo);
  });

  // Test 1: Receive requests are pending until an Admin approves them.
  test("1. รับสินค้าเข้าต้องสร้างเอกสาร PENDING โดยยังไม่เพิ่มยอด", async () => {
    const doc = await service.receive({
      warehouse_id: "wh-1",
      reference_no: "PO-001",
      document_date: "2024-01-01",
      note: "",
      idempotency_key: "recv-001",
      lines: [{ product_id: "prod-1", location_id: "loc-A", qty: 100 }],
      user_id: "user-1",
    });

    const balance = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    expect(doc.status).toBe("PENDING");
    expect(balance).toBe(0);
    expect(JSON.parse(doc.note).idempotency_key).toBe("recv-001");
  });

  // Test 2: เบิก 20 ชิ้น ยอดต้องเหลือ 80
  test("2. เบิกสินค้าออก 20 ชิ้น ยอดคงเหลือต้องเป็น 80", async () => {
    seedStock(repo, 100);

    await service.issue({
      warehouse_id: "wh-1",
      reference_no: "",
      document_date: "2024-01-01",
      note: "",
      idempotency_key: "iss-001",
      lines: [{ product_id: "prod-1", location_id: "loc-A", qty: 20 }],
      user_id: "user-1",
    });

    const balance = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    expect(balance).toBe(80);
  });

  // Test 3: ย้าย 30 ชิ้นจาก A ไป B
  test("3. ย้าย 30 ชิ้นจาก A ไป B: ยอด A=50, B=30, รวม=80", async () => {
    seedStock(repo, 80);

    await service.move({
      warehouse_id: "wh-1",
      product_id: "prod-1",
      from_location_id: "loc-A",
      to_location_id: "loc-B",
      qty: 30,
      reference_no: "",
      document_date: "2024-01-01",
      note: "",
      idempotency_key: "move-001",
      user_id: "user-1",
    });

    const balanceA = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    const balanceB = await repo.movements.getBalance("prod-1", "wh-1", "loc-B");
    const total = await repo.movements.getWarehouseBalance("prod-1", "wh-1");

    expect(balanceA).toBe(50);
    expect(balanceB).toBe(30);
    expect(total).toBe(80);
  });

  // Test 4: เบิก 81 ชิ้น (เกินยอด 80) ต้องถูกปฏิเสธ
  test("4. เบิก 81 ชิ้น (เกินยอดคงเหลือ 80) ต้องถูกปฏิเสธ", async () => {
    seedStock(repo, 80);

    await expect(
      service.issue({
        warehouse_id: "wh-1",
        reference_no: "",
        document_date: "2024-01-01",
        note: "",
        idempotency_key: "iss-003",
        lines: [{ product_id: "prod-1", location_id: "loc-A", qty: 81 }],
        user_id: "user-1",
      })
    ).rejects.toThrow(/ไม่เพียงพอ/);
  });

  // Test 5: idempotency_key ซ้ำต้องไม่สร้างรายการใหม่
  test("5. ส่ง idempotency_key เดิมต้องไม่สร้างรายการซ้ำ", async () => {
    const input = {
      warehouse_id: "wh-1",
      reference_no: "",
      document_date: "2024-01-01",
      note: "",
      idempotency_key: "recv-idem-001",
      lines: [{ product_id: "prod-1", location_id: "loc-A", qty: 50 }],
      user_id: "user-1",
    };

    await service.receive(input);
    await expect(service.receive(input)).rejects.toThrow(/idempotency_key ซ้ำ/);

    const balance = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    expect(balance).toBe(0); // ยังไม่เพิ่มยอดจนกว่า Admin จะอนุมัติ
    expect(repo.documentsList).toHaveLength(1);
  });

  // Test 6: กลับรายการเบิก 20 ชิ้น ยอดต้องกลับเป็น 100
  test("6. กลับรายการเบิก 20 ชิ้น ยอดต้องกลับเป็น 100", async () => {
    seedStock(repo, 100);

    const issueDoc = await service.issue({
      warehouse_id: "wh-1",
      reference_no: "",
      document_date: "2024-01-01",
      note: "",
      idempotency_key: "iss-004",
      lines: [{ product_id: "prod-1", location_id: "loc-A", qty: 20 }],
      user_id: "user-1",
    });

    // Balance is now 80
    const balanceBefore = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    expect(balanceBefore).toBe(80);

    // Reversal
    await service.reversal({
      original_document_id: issueDoc.document_id,
      note: "ทดสอบกลับยอด",
      idempotency_key: "rev-001",
      user_id: "user-1",
    });

    const balanceAfter = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    expect(balanceAfter).toBe(100);
  });

  // Test 7: โกดังที่ปิดใช้งาน
  test("7. โกดังที่ปิดใช้งานต้องปฏิเสธการรับสินค้า", async () => {
    repo.warehouses.findById = async () => ({
      ...mockWarehouse,
      active: false,
    });

    await expect(
      service.receive({
        warehouse_id: "wh-1",
        reference_no: "",
        document_date: "2024-01-01",
        note: "",
        idempotency_key: "recv-inactive-001",
        lines: [{ product_id: "prod-1", location_id: "loc-A", qty: 10 }],
        user_id: "user-1",
      })
    ).rejects.toThrow(/โกดังถูกปิดใช้งาน/);
  });

  // Test 8: ข้อมูลไม่ครบ/จำนวนติดลบต้องถูกปฏิเสธโดย Zod
  test("8. จำนวนติดลบหรือศูนย์ต้องถูกปฏิเสธ", async () => {
    const { ReceiveDocumentSchema } = await import("@/types/api");
    const result = ReceiveDocumentSchema.safeParse({
      warehouse_id: "wh-1",
      document_date: "2024-01-01",
      idempotency_key: "key-001",
      lines: [{ product_id: "prod-1", location_id: "loc-A", qty: -5 }],
    });

    expect(result.success).toBe(false);
  });
});
