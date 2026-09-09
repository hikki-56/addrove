// ============================================================
// Unit Tests — Dashboard aggregation (src/lib/dashboard/dashboard-aggregation.ts)
// สูตร KPI: รับเข้าวันนี้ / เบิกวันนี้ / ผลิตวันนี้
// - แยก production RECEIVE ออกจากการรับเข้าปกติ
// - แยก production ISSUE_OUT (วัตถุดิบ) ออกจากการเบิกปกติ
// - ป้องกันการนับเอกสารและ movement ซ้ำ
// - คำนวณ "วันนี้" ตามเขตเวลา Asia/Bangkok (รอบเที่ยงคืน)
// ============================================================
import {
  aggregateDashboardOperations,
  DASHBOARD_CHART_DAYS,
  type DashboardAggregationInput,
} from "@/lib/dashboard/dashboard-aggregation";
import type {
  Document,
  Product,
  StockMovement,
  User,
  Warehouse,
} from "@/types/models";

// 2026-09-08 09:00 ตามเวลาไทย (UTC+7) — ใช้เป็น "now" ตลอดไฟล์
const NOW = new Date("2026-09-08T02:00:00.000Z");
// 10:00 ของวันเดียวกันตามเวลาไทย
const TODAY_ISO = "2026-09-08T03:00:00.000Z";
// 00:30 ของวันนี้ตามเวลาไทย = เที่ยงคืนผ่านไป 30 นาที (17:30Z ของเมื่อวาน)
const TODAY_MIDNIGHT_BANGKOK_ISO = "2026-09-07T17:30:00.000Z";
// 21:00 ของเมื่อวานตามเวลาไทย
const YESTERDAY_EVENING_ISO = "2026-09-07T14:00:00.000Z";

function makeProduct(id: string, name: string, unit = "ชิ้น"): Product {
  return {
    product_id: id,
    sku: id,
    barcode: `BAR-${id}`,
    product_name: name,
    category: "ทั่วไป",
    base_unit: unit,
    minimum_stock: 5,
    description: "",
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function makeUser(id: string, fullName: string): User {
  return {
    user_id: id,
    full_name: fullName,
    email: `${id}@stockify.local`,
    password_hash: "",
    pin_hash: "",
    role: "WAREHOUSE_STAFF",
    warehouse_access: "*",
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function makeWarehouse(id: string, name: string): Warehouse {
  return {
    warehouse_id: id,
    warehouse_code: id,
    warehouse_name: name,
    address: "",
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function makeDocument(overrides: Partial<Document> & { document_id: string }): Document {
  return {
    document_no: `DOC-${overrides.document_id}`,
    document_type: "RECEIVE",
    reference_no: "",
    document_date: "2026-09-08",
    status: "POSTED",
    note: "",
    created_by: "user-1",
    created_at: TODAY_ISO,
    ...overrides,
  };
}

function makeMovement(overrides: Partial<StockMovement> & { movement_id: string }): StockMovement {
  return {
    document_id: "doc-none",
    product_id: "SKU-A",
    warehouse_id: "wh-1",
    location_id: "",
    qty_change: 0,
    movement_type: "RECEIVE",
    idempotency_key: "",
    created_by: "user-1",
    created_at: TODAY_ISO,
    ...overrides,
  };
}

const FIXTURE_USERS = [makeUser("user-1", "สมชาย ใจดี"), makeUser("user-2", "สมหญิง ขยัน")];
const FIXTURE_PRODUCTS = [
  makeProduct("SKU-A", "สินค้า A"),
  makeProduct("SKU-B", "สินค้า B"),
  makeProduct("FG-1", "กล่องสำเร็จรูป"),
  makeProduct("RM-1", "วัตถุดิบ 1"),
];
const FIXTURE_WAREHOUSES = [
  makeWarehouse("wh-1", "โกดัง1"),
  makeWarehouse("wh-2", "โกดัง2"),
];

function aggregate(
  movements: StockMovement[],
  documents: Document[],
  now: Date = NOW
) {
  const input: DashboardAggregationInput = {
    movements,
    documents,
    products: FIXTURE_PRODUCTS,
    users: FIXTURE_USERS,
    warehouses: FIXTURE_WAREHOUSES,
    now,
  };
  return aggregateDashboardOperations(input);
}

function productionNote(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "PRODUCTION_ORDER",
    order_no: "PRD-2026-001",
    status: "COMPLETED",
    items: [{ fg_name: "กล่องสำเร็จรูป", fg_unit: "ชิ้น", quantity: 50 }],
    created_at: TODAY_ISO,
    created_by_name: "หัวหน้าฝ่ายผลิต",
    target_warehouse_id: "wh-02",
    target_warehouse_name: "โกดัง 2 (สินค้าสำเร็จรูป)",
    ...overrides,
  });
}

// ── รับเข้าวันนี้ ────────────────────────────────────────────────

describe("aggregateDashboardOperations — รับเข้าวันนี้", () => {
  it("รวม RECEIVE ของวันนี้ทุก movement และนับเอกสารไม่ซ้ำ", () => {
    const result = aggregate(
      [
        makeMovement({ movement_id: "m1", document_id: "rcv-1", qty_change: 10 }),
        makeMovement({ movement_id: "m2", document_id: "rcv-1", qty_change: 5 }),
        makeMovement({ movement_id: "m3", document_id: "rcv-2", qty_change: 20 }),
      ],
      []
    );

    expect(result.received_today).toBe(35);
    expect(result.received_document_count_today).toBe(2);
  });

  it("ไม่รวม TRANSFER_IN และรายการของเมื่อวาน", () => {
    const result = aggregate(
      [
        makeMovement({ movement_id: "m1", document_id: "rcv-1", qty_change: 10 }),
        makeMovement({ movement_id: "m2", document_id: "trf-1", qty_change: 7, movement_type: "TRANSFER_IN" }),
        makeMovement({ movement_id: "m3", document_id: "rcv-yesterday", qty_change: 100, created_at: YESTERDAY_EVENING_ISO }),
      ],
      []
    );

    expect(result.received_today).toBe(10);
    expect(result.received_document_count_today).toBe(1);
  });

  it("แยก production RECEIVE (สินค้าสำเร็จรูป) ออกจากการรับเข้าปกติ", () => {
    const result = aggregate(
      [
        // RECEIVE ปกติ
        makeMovement({ movement_id: "m1", document_id: "rcv-1", qty_change: 30 }),
        // RECEIVE ของคำสั่งผลิต (FG เข้าคลัง) — ห้ามนับในรับเข้าวันนี้
        makeMovement({
          movement_id: "m2",
          document_id: "prd-doc-1",
          qty_change: 50,
          product_id: "FG-1",
          warehouse_id: "wh-02",
        }),
      ],
      [
        makeDocument({
          document_id: "prd-doc-1",
          document_no: "PRD-2026-001",
          note: productionNote({ total_fg_qty: 50 }),
        }),
      ]
    );

    expect(result.received_today).toBe(30);
    expect(result.received_document_count_today).toBe(1);
  });
});

// ── เบิกวันนี้ ───────────────────────────────────────────────────

describe("aggregateDashboardOperations — เบิกวันนี้", () => {
  it("รวม ISSUE / ISSUE_OUT / TRANSFER_OUT ด้วยค่าสัมบูรณ์ และนับเอกสารไม่ซ้ำ", () => {
    const result = aggregate(
      [
        makeMovement({ movement_id: "m1", document_id: "iss-1", qty_change: -8, movement_type: "ISSUE" }),
        makeMovement({ movement_id: "m2", document_id: "iss-2", qty_change: -2, movement_type: "ISSUE_OUT" }),
        makeMovement({ movement_id: "m3", document_id: "trf-1", qty_change: -4, movement_type: "TRANSFER_OUT" }),
        // TRANSFER_IN ไม่นับ
        makeMovement({ movement_id: "m4", document_id: "trf-1", qty_change: 4, movement_type: "TRANSFER_IN" }),
      ],
      []
    );

    expect(result.issued_today).toBe(14);
    expect(result.issued_document_count_today).toBe(3);
  });

  it("การโอนระหว่างโกดังนับเฉพาะขาออกครั้งเดียว", () => {
    const result = aggregate(
      [
        makeMovement({ movement_id: "m1", document_id: "trf-1", qty_change: -10, movement_type: "TRANSFER_OUT", warehouse_id: "wh-1" }),
        makeMovement({ movement_id: "m2", document_id: "trf-1", qty_change: 10, movement_type: "TRANSFER_IN", warehouse_id: "wh-2" }),
      ],
      []
    );

    expect(result.issued_today).toBe(10);
  });

  it("แยก production ISSUE_OUT (ตัดวัตถุดิบ) ออกจากการเบิกปกติ", () => {
    const result = aggregate(
      [
        makeMovement({ movement_id: "m1", document_id: "iss-1", qty_change: -6, movement_type: "ISSUE" }),
        makeMovement({
          movement_id: "m2",
          document_id: "prd-doc-1",
          qty_change: -20,
          movement_type: "ISSUE_OUT",
          product_id: "RM-1",
          warehouse_id: "wh-02",
        }),
      ],
      [
        makeDocument({
          document_id: "prd-doc-1",
          document_no: "PRD-2026-001",
          note: productionNote({ total_fg_qty: 50 }),
        }),
      ]
    );

    expect(result.issued_today).toBe(6);
    expect(result.issued_document_count_today).toBe(1);
  });

  it("คำสั่งผลิตที่ยังไม่สำเร็จ — movement ของมันก็ไม่ปนไปเป็นรับเข้า/เบิกปกติ", () => {
    const result = aggregate(
      [
        makeMovement({ movement_id: "m1", document_id: "prd-doc-1", qty_change: 50, product_id: "FG-1", warehouse_id: "wh-02" }),
        makeMovement({ movement_id: "m2", document_id: "prd-doc-1", qty_change: -20, movement_type: "ISSUE_OUT", product_id: "RM-1", warehouse_id: "wh-02" }),
      ],
      [
        makeDocument({
          document_id: "prd-doc-1",
          document_no: "PRD-2026-001",
          note: productionNote({ status: "PENDING", total_fg_qty: 50 }),
        }),
      ]
    );

    expect(result.received_today).toBe(0);
    expect(result.issued_today).toBe(0);
    expect(result.produced_today).toBe(0);
  });
});

// ── ผลิตวันนี้ ───────────────────────────────────────────────────

describe("aggregateDashboardOperations — ผลิตวันนี้", () => {
  it("นับเฉพาะคำสั่งผลิตที่ COMPLETED โดยใช้ total_fg_qty (หน่วยชิ้น)", () => {
    const result = aggregate(
      [],
      [
        makeDocument({
          document_id: "prd-doc-1",
          document_no: "PRD-2026-001",
          note: productionNote({ total_fg_qty: 50 }),
        }),
      ]
    );

    expect(result.produced_today).toBe(50);
    expect(result.production_order_count_today).toBe(1);
  });

  it("ไม่มี total_fg_qty → ใช้ผลรวม items[].quantity แทน", () => {
    const result = aggregate(
      [],
      [
        makeDocument({
          document_id: "prd-doc-1",
          document_no: "PRD-2026-001",
          note: productionNote({
            items: [
              { fg_name: "กล่อง A", quantity: 30 },
              { fg_name: "กล่อง B", quantity: 12 },
            ],
          }),
        }),
      ]
    );

    expect(result.produced_today).toBe(42);
  });

  it("คำสั่งผลิตไม่สำเร็จ (PENDING/CANCELLED) ไม่นับเป็นผลผลิตวันนี้", () => {
    const result = aggregate(
      [],
      [
        makeDocument({
          document_id: "prd-doc-1",
          document_no: "PRD-2026-001",
          note: productionNote({ status: "PENDING", total_fg_qty: 50 }),
        }),
        makeDocument({
          document_id: "prd-doc-2",
          document_no: "PRD-2026-002",
          note: productionNote({ order_no: "PRD-2026-002", status: "CANCELLED", total_fg_qty: 10 }),
        }),
      ]
    );

    expect(result.produced_today).toBe(0);
    expect(result.production_order_count_today).toBe(0);
  });

  it("ตรวจจับเอกสารผลิตได้จากเลขเอกสาร PRD- แม้ note ไม่มี type", () => {
    const result = aggregate(
      [],
      [
        makeDocument({
          document_id: "prd-doc-1",
          document_no: "PRD-2099-777",
          document_type: "RECEIVE",
          status: "COMPLETED",
          note: JSON.stringify({ order_no: "PRD-2099-777", total_fg_qty: 9, status: "COMPLETED", created_at: TODAY_ISO }),
        }),
      ]
    );

    expect(result.produced_today).toBe(9);
  });

  it("คำสั่งผลิตของเมื่อวานไม่นับเป็นวันนี้ แต่ลงกราฟของวันนั้น", () => {
    const yesterday = "2026-09-07T05:00:00.000Z"; // 12:00 เมื่อวานตามเวลาไทย
    const result = aggregate(
      [],
      [
        makeDocument({
          document_id: "prd-doc-1",
          document_no: "PRD-2026-001",
          note: productionNote({ created_at: yesterday, total_fg_qty: 21 }),
        }),
      ]
    );

    expect(result.produced_today).toBe(0);
    expect(result.production_order_count_today).toBe(0);
    const chartYesterday = result.chart_data.find((p) => p.date === "2026-09-07");
    expect(chartYesterday?.produced).toBe(21);
  });
});

// ── ป้องกันการนับซ้ำ ────────────────────────────────────────────

describe("aggregateDashboardOperations — ป้องกันการนับซ้ำ", () => {
  it("movement_id ซ้ำ (อ่านชีตได้ 2 แถวเดียวกัน) นับครั้งเดียว", () => {
    const movement = makeMovement({ movement_id: "m1", document_id: "rcv-1", qty_change: 10 });
    const result = aggregate([movement, { ...movement }], []);

    expect(result.received_today).toBe(10);
    expect(result.received_document_count_today).toBe(1);
  });

  it("document_id ซ้ำนับครั้งเดียว (เอาแถวที่ใหม่สุด)", () => {
    const result = aggregate(
      [],
      [
        makeDocument({ document_id: "rcv-1", status: "PENDING" }),
        makeDocument({ document_id: "rcv-1", status: "PENDING" }),
        makeDocument({ document_id: "rcv-2", status: "PENDING" }),
      ]
    );

    expect(result.pending_approval_count).toBe(2);
  });

  it("คำสั่งผลิตเดียวกัน (order_no เดียวกัน คนละ document_id) นับผลผลิตครั้งเดียว", () => {
    const result = aggregate(
      [],
      [
        makeDocument({
          document_id: "prd-doc-1",
          document_no: "PRD-2026-001",
          note: productionNote({ total_fg_qty: 50 }),
        }),
        makeDocument({
          document_id: "prd-doc-1b",
          document_no: "DOC-PRD-DUPLICATE",
          note: productionNote({ total_fg_qty: 50 }),
        }),
      ]
    );

    expect(result.produced_today).toBe(50);
    expect(result.production_order_count_today).toBe(1);
  });
});

// ── เขตเวลา Asia/Bangkok ────────────────────────────────────────

describe("aggregateDashboardOperations — เขตเวลา Asia/Bangkok", () => {
  it("movement เที่ยงคืนผ่านไป 30 นาที (00:30 ไทย) นับเป็นวันนี้", () => {
    const result = aggregate(
      [
        makeMovement({
          movement_id: "m1",
          document_id: "rcv-1",
          qty_change: 10,
          created_at: TODAY_MIDNIGHT_BANGKOK_ISO,
        }),
      ],
      []
    );

    expect(result.received_today).toBe(10);
  });

  it("movement ก่อนเที่ยงคืนไทย (21:00 เมื่อวาน) ไม่นับเป็นวันนี้", () => {
    const result = aggregate(
      [
        makeMovement({
          movement_id: "m1",
          document_id: "rcv-1",
          qty_change: 10,
          created_at: YESTERDAY_EVENING_ISO,
        }),
      ],
      []
    );

    expect(result.received_today).toBe(0);
  });

  it("chart_data เติมวันที่รอบ 90 วันต่อเนื่องจบที่วันนี้ (ตามเวลาไทย)", () => {
    const result = aggregate(
      [makeMovement({ movement_id: "m1", document_id: "rcv-1", qty_change: 10 })],
      []
    );

    expect(result.chart_data).toHaveLength(DASHBOARD_CHART_DAYS);
    expect(result.chart_data[0].date).toBe("2026-06-11");
    expect(result.chart_data[DASHBOARD_CHART_DAYS - 1].date).toBe("2026-09-08");
    // วันที่ไม่มีข้อมูลเติม 0 ครบทุกชุด
    for (const point of result.chart_data) {
      expect(Number.isFinite(point.received)).toBe(true);
      expect(Number.isFinite(point.issued)).toBe(true);
      expect(Number.isFinite(point.produced)).toBe(true);
    }
    expect(result.chart_data[DASHBOARD_CHART_DAYS - 1].received).toBe(10);
  });
});

// ── กิจกรรมวันนี้ ────────────────────────────────────────────────

describe("aggregateDashboardOperations — กิจกรรมวันนี้", () => {
  it("รวม movement ตามเอกสารเป็นกิจกรรมเดียว พร้อม resolve ชื่อผู้ใช้", () => {
    const result = aggregate(
      [
        makeMovement({ movement_id: "m1", document_id: "rcv-1", qty_change: 10, product_id: "SKU-A" }),
        makeMovement({ movement_id: "m2", document_id: "rcv-1", qty_change: 5, product_id: "SKU-B", created_by: "user-1" }),
        makeMovement({ movement_id: "m3", document_id: "iss-1", qty_change: -7, movement_type: "ISSUE", created_by: "user-2" }),
      ],
      [
        makeDocument({ document_id: "rcv-1", document_no: "RCV-001", status: "POSTED" }),
        makeDocument({ document_id: "iss-1", document_no: "ISS-001", document_type: "ISSUE", status: "POSTED", created_by: "user-2" }),
      ]
    );

    expect(result.today_activities).toHaveLength(2);
    const receive = result.today_activities.find((a) => a.action_type === "RECEIVE");
    expect(receive?.actor_name).toBe("สมชาย ใจดี");
    expect(receive?.quantity).toBe(15);
    expect(receive?.document_no).toBe("RCV-001");
    const issue = result.today_activities.find((a) => a.action_type === "ISSUE");
    expect(issue?.actor_name).toBe("สมหญิง ขยัน");
    expect(issue?.quantity).toBe(7);
  });

  it("กิจกรรมผลิตแสดงหนึ่งกิจกรรมต่อคำสั่งผลิต — ไม่แตกเป็น RECEIVE/ISSUE_OUT หลายบรรทัด", () => {
    const result = aggregate(
      [
        makeMovement({ movement_id: "m1", document_id: "prd-doc-1", qty_change: 50, product_id: "FG-1", warehouse_id: "wh-02" }),
        makeMovement({ movement_id: "m2", document_id: "prd-doc-1", qty_change: -20, movement_type: "ISSUE_OUT", product_id: "RM-1", warehouse_id: "wh-02" }),
        makeMovement({ movement_id: "m3", document_id: "prd-doc-1", qty_change: -8, movement_type: "ISSUE_OUT", product_id: "SKU-B", warehouse_id: "wh-02" }),
      ],
      [
        makeDocument({
          document_id: "prd-doc-1",
          document_no: "PRD-2026-001",
          note: productionNote({ total_fg_qty: 50 }),
        }),
      ]
    );

    expect(result.today_activities).toHaveLength(1);
    const production = result.today_activities[0];
    expect(production.action_type).toBe("PRODUCTION");
    expect(production.action_label).toBe("ผลิตสินค้า");
    expect(production.quantity).toBe(50);
    expect(production.document_no).toBe("PRD-2026-001");
  });

  it("ผู้ทำรายการเป็น UUID ที่หาชื่อไม่ได้ → ใช้ชื่อสำรอง ไม่แสดง UUID", () => {
    const result = aggregate(
      [
        makeMovement({
          movement_id: "m1",
          document_id: "rcv-1",
          qty_change: 3,
          created_by: "a1b2c3d4-1111-2222-3333-444455556666",
        }),
      ],
      []
    );

    expect(result.today_activities[0].actor_name).toBe("ไม่ทราบผู้ทำรายการ");
  });

  it("เรียงรายการล่าสุดก่อน", () => {
    const result = aggregate(
      [
        makeMovement({ movement_id: "m1", document_id: "rcv-1", qty_change: 1, created_at: TODAY_MIDNIGHT_BANGKOK_ISO }),
        makeMovement({ movement_id: "m2", document_id: "iss-1", qty_change: -1, movement_type: "ISSUE", created_at: TODAY_ISO }),
      ],
      []
    );

    expect(result.today_activities[0].id).toContain("iss-1");
    expect(result.today_activities[1].id).toContain("rcv-1");
  });

  it("กิจกรรมของเมื่อวานไม่แสดงในกิจกรรมวันนี้", () => {
    const result = aggregate(
      [
        makeMovement({ movement_id: "m1", document_id: "rcv-1", qty_change: 10, created_at: YESTERDAY_EVENING_ISO }),
      ],
      []
    );

    expect(result.today_activities).toHaveLength(0);
  });
});

// ── รายการรออนุมัติ ─────────────────────────────────────────────

describe("aggregateDashboardOperations — pending_approval_count", () => {
  it("นับรายการ RECEIVE ที่รออนุมัติทั้งหมด (ไม่ใช่แค่ที่แสดง)", () => {
    const pendingDocs = Array.from({ length: 5 }, (_, i) =>
      makeDocument({ document_id: `rcv-pending-${i}`, status: "PENDING" })
    );
    const result = aggregate([], [
      ...pendingDocs,
      makeDocument({ document_id: "rcv-posted", status: "POSTED" }),
      makeDocument({ document_id: "iss-1", document_type: "ISSUE", status: "PENDING" }),
      makeDocument({
        document_id: "prd-doc-1",
        document_no: "PRD-2026-001",
        status: "PENDING",
        note: productionNote({ status: "PENDING" }),
      }),
    ]);

    // 5 รายการ PENDING ของ RECEIVE — หน้า UI แสดง 3 รายการแต่ badge ต้องเท่ากับ 5
    expect(result.pending_approval_count).toBe(5);
  });
});
