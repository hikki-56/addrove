/**
 * Tests for the Receiving Plan (แผนรับสินค้า) workflow:
 * create → receive against plan (strict membership + progress) → auto-complete → cancel/close guards
 */
import {
  createReceivingPlan,
  listReceivingPlans,
  getReceivingPlan,
  cancelReceivingPlan,
  closeReceivingPlan,
  buildReceivingPlanView,
} from "@/lib/services/stock/receiving-plan";
import { receiveStock, ReceiveStockSchema } from "@/lib/services/stock/receive-stock";
import {
  StockConflictError,
  StockNotFoundError,
  StockValidationError,
} from "@/lib/services/stock/stock-errors";
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

const mockOtherWarehouse: Warehouse = {
  ...mockWarehouse,
  warehouse_id: "wh-2",
  warehouse_code: "WH-02",
  warehouse_name: "โกดัง2",
};

const mockProductA: Product = {
  product_id: "prod-001",
  sku: "SKU001",
  barcode: "8850001",
  product_name: "สินค้าทดสอบ A",
  category: "อุปกรณ์",
  base_unit: "ชิ้น",
  minimum_stock: 10,
  supplier: "Supplier A",
  description: "",
  active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockProductB: Product = {
  ...mockProductA,
  product_id: "prod-002",
  sku: "SKU002",
  barcode: "8850002",
  product_name: "สินค้าทดสอบ B",
};

class MockStockRepo implements IStockRepository {
  public documentsList: Document[] = [];
  public movementsList: StockMovement[] = [];
  public usedKeys = new Set<string>();
  private docCounter = 0;

  warehouses = {
    findAll: async () => [mockWarehouse, mockOtherWarehouse],
    findById: async (id: string) =>
      id === mockWarehouse.warehouse_id ? mockWarehouse : id === mockOtherWarehouse.warehouse_id ? mockOtherWarehouse : null,
    findByCode: async () => null,
    create: async () => mockWarehouse,
  };

  locations = {
    findAll: async () => [] as Location[],
    findById: async () => null,
    findByCode: async () => null,
    create: async (data: any) => data,
    update: async (id: string, data: any) => data,
  };

  products = {
    findAll: async () => [mockProductA, mockProductB],
    findById: async (id: string) =>
      id === mockProductA.product_id ? mockProductA : id === mockProductB.product_id ? mockProductB : null,
    findBySku: async (sku: string) =>
      sku === mockProductA.sku ? mockProductA : sku === mockProductB.sku ? mockProductB : null,
    findByBarcode: async () => null,
    create: async (p: any) => ({ ...mockProductA, ...p }),
    update: async () => mockProductA,
    hasMovements: async () => false,
  };

  documents = {
    findAll: async () => ({ data: this.documentsList, total: this.documentsList.length }),
    findById: async (id: string) => this.documentsList.find((d) => d.document_id === id) || null,
    findByNo: async (no: string) => this.documentsList.find((d) => d.document_no === no) || null,
    create: async (data: any) => {
      this.docCounter += 1;
      const doc: Document = {
        document_id: `doc-${this.docCounter}`,
        document_no: `${data.document_type === "RECEIVE_PLAN" ? "PLN" : "RCV"}-20260910-${String(this.docCounter).padStart(6, "0")}`,
        ...data,
        created_at: new Date().toISOString(),
      };
      this.documentsList.push(doc);
      return doc;
    },
    updateStatus: async (id: string, status: any) => {
      const doc = this.documentsList.find((d) => d.document_id === id);
      if (doc) doc.status = status;
    },
    updateNote: async (id: string, note: string) => {
      const doc = this.documentsList.find((d) => d.document_id === id);
      if (doc) doc.note = note;
    },
    updateDoc: async (id: string, updates: Partial<Document>) => {
      const doc = this.documentsList.find((d) => d.document_id === id);
      if (doc) Object.assign(doc, updates);
    },
    generateDocumentNo: async (type: string) => `${type}-20260910-000001`,
  };

  movements = {
    findAll: async () => ({ data: this.movementsList, total: this.movementsList.length }),
    findById: async () => null,
    findByDocumentId: async (id: string) => this.movementsList.filter((m) => m.document_id === id),
    existsByIdempotencyKey: async (key: string) => this.usedKeys.has(key),
    getBalance: async () => 0,
    getWarehouseBalance: async () => 0,
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
    findAll: async () => [] as StockSummary[],
    findByProduct: async () => [],
    applyChanges: async () => {},
  };

  stockCounts = {} as any;
  users = {} as any;
  dashboard = {} as any;
}

async function createPlanWithA(repo: MockStockRepo, expectedQty = 20) {
  return createReceivingPlan(
    { repo },
    {
      warehouse_id: "wh-1",
      reference_no: "PO-1001",
      expected_date: "2026-09-11",
      note: "แผนทดสอบ",
      lines: [{ product_id: "prod-001", expected_qty: expectedQty }],
      user_id: "admin-1",
      role: "ADMIN",
      created_by_name: "ผู้ดูแลระบบ (Admin)",
    }
  );
}

function receiveInput(planId: string, qty: number, productId = "prod-001", idemKey = `idem-${Math.random()}`) {
  return ReceiveStockSchema.parse({
    warehouse_id: "wh-1",
    document_date: "2026-09-10",
    idempotency_key: idemKey,
    plan_document_id: planId,
    lines: [{ product_id: productId, qty, location_id: "1K14-1A", boxes: 1 }],
  });
}

describe("createReceivingPlan", () => {
  let repo: MockStockRepo;
  beforeEach(() => {
    repo = new MockStockRepo();
  });

  test("creates a PENDING plan with expected lines and progress", async () => {
    const view = await createPlanWithA(repo);
    expect(view.status).toBe("PENDING");
    expect(view.document_no).toMatch(/^PLN-/);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0].product_id).toBe("prod-001");
    expect(view.lines[0].expected_qty).toBe(20);
    expect(view.lines[0].received_qty).toBe(0);
    expect(view.progress.fully_received).toBe(false);

    const doc = repo.documentsList[0];
    expect(doc.document_type).toBe("RECEIVE_PLAN");
    // ห้ามมีคีย์ target_sheet ใน note ของแผน — ไม่งั้นหลุดเข้าคิวอนุมัติ (กรองด้วย substring)
    expect(doc.note).not.toContain("target_sheet");
  });

  test("rejects unknown product", async () => {
    await expect(
      createReceivingPlan(
        { repo },
        {
          warehouse_id: "wh-1",
          reference_no: "",
          expected_date: "",
          note: "",
          lines: [{ product_id: "prod-ไม่มีจริง" }],
          user_id: "admin-1",
        }
      )
    ).rejects.toThrow(StockValidationError);
  });

  test("rejects duplicate product lines", async () => {
    await expect(
      createReceivingPlan(
        { repo },
        {
          warehouse_id: "wh-1",
          reference_no: "",
          expected_date: "",
          note: "",
          // prod-001 กับ SKU001 คือสินค้าเดียวกัน — ต้องจับได้ว่าซ้ำ
          lines: [{ product_id: "prod-001" }, { product_id: "SKU001" }],
          user_id: "admin-1",
        }
      )
    ).rejects.toThrow(StockValidationError);
  });

  test("rejects unknown warehouse", async () => {
    await expect(
      createReceivingPlan(
        { repo },
        {
          warehouse_id: "wh-404",
          reference_no: "",
          expected_date: "",
          note: "",
          lines: [{ product_id: "prod-001" }],
          user_id: "admin-1",
        }
      )
    ).rejects.toThrow(StockNotFoundError);
  });
});

describe("receiveStock against a plan (นโยบายเข้มงวด)", () => {
  let repo: MockStockRepo;
  beforeEach(() => {
    repo = new MockStockRepo();
  });

  test("partial receipt moves plan to PROCESSING and logs progress", async () => {
    const plan = await createPlanWithA(repo, 20);

    const doc = await receiveStock(
      { repo },
      { ...receiveInput(plan.document_id, 8), user_id: "staff-1", created_by_name: "พนักงาน ก" }
    );

    expect(doc.document_type).toBe("RECEIVE");
    // reference_no ว่าง → ใช้เลขที่แผนเป็นอ้างอิงอัตโนมัติ
    expect(doc.reference_no).toBe(plan.document_no);
    // note ของเอกสารรับเข้าอ้างอิงแผน
    const notePayload = JSON.parse(doc.note);
    expect(notePayload.plan_document_id).toBe(plan.document_id);
    expect(notePayload.plan_document_no).toBe(plan.document_no);

    const updated = await getReceivingPlan({ repo }, plan.document_id);
    expect(updated.status).toBe("PROCESSING");
    expect(updated.lines[0].received_qty).toBe(8);
    expect(updated.receipts).toHaveLength(1);
    expect(updated.receipts[0].received_by_name).toBe("พนักงาน ก");
    expect(updated.progress.fully_received).toBe(false);
  });

  test("receiving the remaining quantity auto-completes the plan", async () => {
    const plan = await createPlanWithA(repo, 20);
    await receiveStock({ repo }, { ...receiveInput(plan.document_id, 8, "prod-001", "idem-a"), user_id: "staff-1" });
    await receiveStock({ repo }, { ...receiveInput(plan.document_id, 12, "prod-001", "idem-b"), user_id: "staff-1" });

    const updated = await getReceivingPlan({ repo }, plan.document_id);
    expect(updated.status).toBe("COMPLETED");
    expect(updated.lines[0].received_qty).toBe(20);
    expect(updated.progress.fully_received).toBe(true);
    expect(updated.receipts).toHaveLength(2);
  });

  test("rejects a product that is not in the plan", async () => {
    const plan = await createPlanWithA(repo, 20);

    await expect(
      receiveStock({ repo }, { ...receiveInput(plan.document_id, 5, "prod-002"), user_id: "staff-1" })
    ).rejects.toThrow(/ไม่สามารถรับสินค้าที่ไม่อยู่ในแผนได้/);

    // แผนต้องไม่ถูกแตะ
    const unchanged = await getReceivingPlan({ repo }, plan.document_id);
    expect(unchanged.receipts).toHaveLength(0);
    expect(unchanged.status).toBe("PENDING");
  });

  test("rejects when receiving into a different warehouse than the plan", async () => {
    const plan = await createPlanWithA(repo, 20);

    const wrongWhInput = ReceiveStockSchema.parse({
      warehouse_id: "wh-2",
      document_date: "2026-09-10",
      idempotency_key: "idem-wrong-wh",
      plan_document_id: plan.document_id,
      lines: [{ product_id: "prod-001", qty: 5, location_id: "1K14-1A" }],
    });

    await expect(
      receiveStock({ repo }, { ...wrongWhInput, user_id: "staff-1" })
    ).rejects.toThrow(StockValidationError);
  });

  test("rejects receiving against a cancelled plan", async () => {
    const plan = await createPlanWithA(repo, 20);
    await cancelReceivingPlan({ repo }, { plan_id: plan.document_id, user_id: "admin-1", user_name: "Admin" });

    await expect(
      receiveStock({ repo }, { ...receiveInput(plan.document_id, 5), user_id: "staff-1" })
    ).rejects.toThrow(StockValidationError);
  });

  test("rejects receiving against a completed plan", async () => {
    const plan = await createPlanWithA(repo, 5);
    await receiveStock({ repo }, { ...receiveInput(plan.document_id, 5, "prod-001", "idem-full"), user_id: "staff-1" });

    // แผนปิดอัตโนมัติแล้ว — รับเพิ่มไม่ได้
    await expect(
      receiveStock({ repo }, { ...receiveInput(plan.document_id, 1, "prod-001", "idem-extra"), user_id: "staff-1" })
    ).rejects.toThrow(StockValidationError);
  });

  test("over-receiving is allowed but keeps the plan COMPLETED (บันทึกตามของจริง)", async () => {
    const plan = await createPlanWithA(repo, 5);
    await receiveStock({ repo }, { ...receiveInput(plan.document_id, 8, "prod-001", "idem-over"), user_id: "staff-1" });

    const updated = await getReceivingPlan({ repo }, plan.document_id);
    expect(updated.status).toBe("COMPLETED");
    expect(updated.lines[0].received_qty).toBe(8);
  });
});

describe("cancel / close guards", () => {
  let repo: MockStockRepo;
  beforeEach(() => {
    repo = new MockStockRepo();
  });

  test("close then cancel is rejected; both are idempotent on repeat", async () => {
    const plan = await createPlanWithA(repo, 20);

    await closeReceivingPlan({ repo }, { plan_id: plan.document_id, user_id: "admin-1", user_name: "Admin", reason: "ของไม่มาอีก" });
    const closed = await getReceivingPlan({ repo }, plan.document_id);
    expect(closed.status).toBe("COMPLETED");

    await expect(
      cancelReceivingPlan({ repo }, { plan_id: plan.document_id, user_id: "admin-1" })
    ).rejects.toThrow(StockConflictError);

    // ปิดซ้ำ = idempotent (ไม่โยน error)
    await expect(
      closeReceivingPlan({ repo }, { plan_id: plan.document_id, user_id: "admin-1" })
    ).resolves.toBeDefined();
  });

  test("cancel is idempotent and blocks receiving afterwards", async () => {
    const plan = await createPlanWithA(repo, 20);

    const cancelled = await cancelReceivingPlan(
      { repo },
      { plan_id: plan.document_id, user_id: "admin-1", user_name: "Admin", reason: "ยกเลิกการสั่งซื้อ" }
    );
    expect(cancelled.status).toBe("CANCELLED");

    const again = await cancelReceivingPlan({ repo }, { plan_id: plan.document_id, user_id: "admin-1" });
    expect(again.status).toBe("CANCELLED");

    await expect(closeReceivingPlan({ repo }, { plan_id: plan.document_id, user_id: "admin-1" })).rejects.toThrow(
      StockConflictError
    );
  });
});

describe("listReceivingPlans", () => {
  let repo: MockStockRepo;
  beforeEach(async () => {
    repo = new MockStockRepo();
    await createPlanWithA(repo, 20); // wh-1
    await createReceivingPlan(
      { repo },
      {
        warehouse_id: "wh-2",
        reference_no: "",
        expected_date: "",
        note: "",
        lines: [{ product_id: "prod-002" }], // ไม่ตั้งเป้า = เช็คลิสต์
        user_id: "admin-1",
      }
    );
  });

  test("filters by OPEN status and by warehouse (normalize wh-01 ↔ wh-1)", async () => {
    const open = await listReceivingPlans({ repo }, { status: "OPEN" });
    expect(open).toHaveLength(2);

    // wh-01 (มี zero padding) ต้องจับคู่กับ wh-1 ที่ mock เก็บไว้
    const wh1 = await listReceivingPlans({ repo }, { warehouse_id: "wh-01", status: "OPEN" });
    expect(wh1).toHaveLength(1);
    expect(wh1[0].warehouse_id).toBe("wh-1");

    const checklist = await listReceivingPlans({ repo }, { warehouse_id: "wh-2" });
    expect(checklist).toHaveLength(1);
    expect(checklist[0].progress.has_target).toBe(false);
    expect(checklist[0].lines[0].fulfilled).toBe(false);
  });

  test("checklist-only plan never auto-completes", async () => {
    const [wh2Plan] = await listReceivingPlans({ repo }, { warehouse_id: "wh-2" });
    await receiveStock(
      { repo },
      {
        ...ReceiveStockSchema.parse({
          warehouse_id: "wh-2",
          document_date: "2026-09-10",
          idempotency_key: "idem-checklist",
          plan_document_id: wh2Plan.document_id,
          lines: [{ product_id: "prod-002", qty: 99, location_id: "2A01-1A" }],
        }),
        user_id: "staff-1",
      }
    );
    const updated = await getReceivingPlan({ repo }, wh2Plan.document_id);
    expect(updated.status).toBe("PROCESSING");
    expect(updated.lines[0].received_qty).toBe(99);
  });
});

describe("buildReceivingPlanView guards", () => {
  test("returns null for non-plan documents", () => {
    const fakeDoc: Document = {
      document_id: "doc-x",
      document_no: "RCV-20260910-000001",
      document_type: "RECEIVE",
      reference_no: "",
      document_date: "2026-09-10",
      status: "PENDING",
      note: JSON.stringify({ warehouse_id: "wh-1", target_sheet: "โกดัง1", lines: [], rows: [] }),
      created_by: "u1",
      created_at: new Date().toISOString(),
    };
    expect(buildReceivingPlanView(fakeDoc)).toBeNull();
  });
});
