// ============================================================
// Unit Tests — Dashboard repository: ผลรวมคอลัมน์ "จำนวนคงเหลือ"
// จากชีตรายโกดัง 6 แท็บ (สำนักงานใหญ่ + โกดัง1-5)
// ใช้ mock ของ Google Sheets client (ไม่เรียกชีตจริง)
// ============================================================
jest.mock("@/lib/google-sheets/client", () => {
  type Rows = string[][];
  const state: { tabs: Record<string, Rows>; errors: Record<string, string> } = {
    tabs: {},
    errors: {},
  };
  const clone = (rows: Rows): Rows => rows.map((row) => [...row]);

  return {
    SHEETS: {
      WAREHOUSES: "Warehouses",
      LOCATIONS: "Locations",
      SHELVES: "Shelves",
      PRODUCTS: "PRODUCTS",
      DOCUMENTS: "Documents",
      STOCK_MOVEMENTS: "StockMovements",
      STOCK_SUMMARY: "StockSummary",
      STOCK_COUNTS: "StockCounts",
      USERS: "Users",
    },
    getWarehouseSheetName: (warehouseId: string): string => {
      const map: Record<string, string> = {
        "wh-1": "โกดัง1",
        "wh-2": "โกดัง2",
        "wh-3": "โกดัง3",
        "wh-4": "โกดัง4",
        "wh-5": "โกดัง5",
        "wh-6": "สำนักงานใหญ่",
      };
      return map[warehouseId] ?? warehouseId;
    },
    // จำลองพฤติกรรม client จริง: keepHeader=true คืนทุกแถวรวมหัวตาราง / ปกติตัดแถวแรกทิ้ง
    // แท็บที่ไม่มีข้อมูลใน state = อ่านได้ [] (แท็บว่าง) เว้นแต่จะลงทะเบียน error ไว้
    readSheet: jest.fn(
      async (
        sheetName: string,
        _range?: string,
        options?: { keepHeader?: boolean }
      ): Promise<Rows> => {
        const rows = state.tabs[sheetName] ?? [];
        return options?.keepHeader ? clone(rows) : clone(rows).slice(1);
      }
    ),
    appendRows: jest.fn(async () => undefined),
    updateRow: jest.fn(async () => undefined),
    getSheetReadError: jest.fn(
      (sheetName: string): string | null => state.errors[sheetName] ?? null
    ),
    __setTab: (name: string, rows: Rows): void => {
      state.tabs[name] = clone(rows);
    },
    __setReadError: (name: string, message: string): void => {
      state.errors[name] = message;
    },
    __reset: (): void => {
      state.tabs = {};
      state.errors = {};
    },
  };
});

import {
  SheetsDashboardRepository,
  DashboardDataError,
} from "@/lib/repositories/sheets/dashboard.repository";

const sheetMock = jest.requireMock("@/lib/google-sheets/client") as {
  __setTab: (name: string, rows: string[][]) => void;
  __setReadError: (name: string, message: string) => void;
  __reset: () => void;
};

const TABS = ["สำนักงานใหญ่", "โกดัง1", "โกดัง2", "โกดัง3", "โกดัง4", "โกดัง5"];

// หัวตารางมาตรฐานของชีตโกดัง — จำนวนคงเหลืออยู่คอลัมน์ F (index 5)
const STANDARD_HEADER = [
  "รหัสสินค้า",
  "บาร์โค้ด",
  "ชื่อสินค้า",
  "หมวดหมู่",
  "จำนวนขั้นต่ำ",
  "จำนวนคงเหลือ",
  "หน่วย",
  "อัปเดตล่าสุด",
];

function stockRow(sku: string, qty: string | number): string[] {
  return [
    sku,
    `BAR-${sku}`,
    `สินค้า ${sku}`,
    "ทั่วไป",
    "5",
    String(qty),
    "ชิ้น",
    "2026-01-01T00:00:00Z",
  ];
}

function tab(header: string[], rows: string[][]): string[][] {
  return [[...header], ...rows];
}

// ตั้งค่าเริ่มต้น: ทุกแท็บมีหัวตารางแต่ยังไม่มีรายการ (ยอดรวม 0)
function resetTabs(): void {
  sheetMock.__reset();
  for (const tabName of TABS) {
    sheetMock.__setTab(tabName, tab(STANDARD_HEADER, []));
  }
}

function setTabRows(tabName: string, rows: string[][]): void {
  sheetMock.__setTab(tabName, tab(STANDARD_HEADER, rows));
}

async function getStatsError(promise: Promise<unknown>): Promise<DashboardDataError> {
  return (await promise.catch((e: unknown) => e)) as DashboardDataError;
}

beforeEach(() => {
  resetTabs();
});

describe("SheetsDashboardRepository — total_remaining_quantity จากชีตรายโกดัง", () => {
  it("1) รวมจำนวนคงเหลือจากทั้ง 6 แท็บได้ถูกต้อง", async () => {
    const qtyByTab: Record<string, number> = {
      "สำนักงานใหญ่": 10,
      "โกดัง1": 20,
      "โกดัง2": 30,
      "โกดัง3": 40,
      "โกดัง4": 50,
      "โกดัง5": 60,
    };
    for (const [tabName, qty] of Object.entries(qtyByTab)) {
      setTabRows(tabName, [stockRow(`SKU-${TABS.indexOf(tabName)}`, qty)]);
    }

    const stats = await new SheetsDashboardRepository().getStats();

    expect(stats.total_remaining_quantity).toBe(210);
  });

  it("2) SKU เดียวกันอยู่หลายโกดัง — รวมทุกแท็บและนับ SKU ครั้งเดียว", async () => {
    setTabRows("โกดัง1", [stockRow("A01", 100)]);
    setTabRows("โกดัง2", [stockRow("A01", 50)]);
    setTabRows("โกดัง3", [stockRow("A01", 25)]);

    const stats = await new SheetsDashboardRepository().getStats();

    expect(stats.total_remaining_quantity).toBe(175);
    expect(stats.total_sku).toBe(1);
  });

  it("3) SKU เดียวกันอยู่หลายแถวในแท็บเดียว — รวมทุกแถว", async () => {
    setTabRows("โกดัง3", [
      stockRow("B01", 100), // ตำแหน่ง A-01
      stockRow("B01", 25), // ตำแหน่ง A-02
      stockRow("B01", 5), // ตำแหน่ง B-01
    ]);

    const stats = await new SheetsDashboardRepository().getStats();

    expect(stats.total_remaining_quantity).toBe(130);
    expect(stats.total_sku).toBe(1);
  });

  it("4) ตัวเลขมี comma เช่น 1,200 — parse ได้ 1200", async () => {
    setTabRows("โกดัง1", [stockRow("C01", "1,200")]);

    const stats = await new SheetsDashboardRepository().getStats();

    expect(stats.total_remaining_quantity).toBe(1200);
  });

  it("5) ตัวเลขเป็นทศนิยม — รวมได้ละเอียด", async () => {
    setTabRows("โกดัง2", [stockRow("D01", "1.5"), stockRow("D02", "2.25")]);

    const stats = await new SheetsDashboardRepository().getStats();

    expect(stats.total_remaining_quantity).toBeCloseTo(3.75, 10);
  });

  it("6) ช่องว่างและค่าที่ไม่ใช่ตัวเลขนับเป็น 0 — ไม่พังไม่นับซ้ำ", async () => {
    setTabRows("โกดัง4", [
      stockRow("E01", ""), // ช่องว่าง
      stockRow("E02", "   "), // ช่องว่างล้วน
      stockRow("E03", "abc"), // ไม่ใช่ตัวเลข
      stockRow("E04", "1 200"), // ตัวเลขมีช่องว่างคั่น
      stockRow("E05", " 7 "),
    ]);

    const stats = await new SheetsDashboardRepository().getStats();

    expect(stats.total_remaining_quantity).toBe(1207);
  });

  it("7) จำนวนติดลบรวมตามจริง — ห้ามเปลี่ยนเป็น 0", async () => {
    setTabRows("โกดัง5", [stockRow("F01", 100), stockRow("F02", "-5")]);

    const stats = await new SheetsDashboardRepository().getStats();

    expect(stats.total_remaining_quantity).toBe(95);
  });

  it("8) แท็บว่างจริง (ไม่มีข้อมูลเลย หรือมีแต่หัวตาราง) นับเป็น 0", async () => {
    sheetMock.__reset(); // โกดัง2 = ชีตว่างเปล่า (อ่านได้ []) ไม่มี error
    sheetMock.__setTab("สำนักงานใหญ่", tab(STANDARD_HEADER, [stockRow("G01", 10)]));
    sheetMock.__setTab("โกดัง1", tab(STANDARD_HEADER, [stockRow("G02", 20)]));
    sheetMock.__setTab("โกดัง3", tab(STANDARD_HEADER, [])); // มีแต่หัวตาราง
    sheetMock.__setTab("โกดัง4", tab(STANDARD_HEADER, [stockRow("G03", 5)]));
    sheetMock.__setTab("โกดัง5", tab(STANDARD_HEADER, [stockRow("G04", 5)]));

    const stats = await new SheetsDashboardRepository().getStats();

    expect(stats.total_remaining_quantity).toBe(40);
  });

  it("9) อ่านแท็บใดแท็บหนึ่งไม่สำเร็จ — โยน DashboardDataError ระบุชื่อแท็บ", async () => {
    setTabRows("โกดัง1", [stockRow("H01", 100)]);
    // อ่านชีตจริงไม่สำเร็จ → readSheet คืน [] และ getSheetReadError มีข้อความ
    sheetMock.__setTab("โกดัง2", []);
    sheetMock.__setReadError("โกดัง2", "Quota exceeded (429)");

    const err = await getStatsError(new SheetsDashboardRepository().getStats());

    expect(err).toBeInstanceOf(DashboardDataError);
    expect(err.sheet).toBe("โกดัง2");
    expect(err.operation).toBe("getStats:readWarehouseStock");
    expect(err.message).toContain("โกดัง2");
  });

  it("10) ไม่พบ Header 'จำนวนคงเหลือ' — error ระบุแท็บและสาเหตุชัดเจน", async () => {
    sheetMock.__setTab(
      "โกดัง4",
      tab(
        ["รหัสสินค้า", "บาร์โค้ด", "ชื่อสินค้า", "ราคา", "หมายเหตุ"],
        [stockRow("I01", 99)]
      )
    );

    const err = await getStatsError(new SheetsDashboardRepository().getStats());

    expect(err).toBeInstanceOf(DashboardDataError);
    expect(err.sheet).toBe("โกดัง4");
    expect(err.message).toContain("โกดัง4");
    expect(err.message).toContain("จำนวนคงเหลือ");
  });

  it("11) เกิดข้อผิดพลาดที่แท็บใด — ห้ามคืนผลรวมบางส่วนหรือค่า 0", async () => {
    // โกดัง1 มีข้อมูล 100 ชิ้น แต่โกดัง2 อ่านไม่สำเร็จ — ต้อง reject ทั้ง getStats
    setTabRows("โกดัง1", [stockRow("J01", 100)]);
    sheetMock.__setTab("โกดัง2", []);
    sheetMock.__setReadError("โกดัง2", "read timeout");

    const err = await getStatsError(new SheetsDashboardRepository().getStats());

    // ถ้าคืนผลรวมบางส่วนจะได้ object แทน error
    expect(err).toBeInstanceOf(DashboardDataError);
  });

  it("12) Header ชื่อต่างกันได้ในแต่ละแท็บ — หาจากชื่อคอลัมน์เสมอ ไม่ใช่ตำแหน่ง", async () => {
    // โกดัง1: คอลัมน์ชื่อ "คงเหลือ" อยู่ index 3
    sheetMock.__setTab(
      "โกดัง1",
      tab(
        ["รหัสสินค้า", "ชื่อสินค้า", "หน่วย", "คงเหลือ"],
        [["K01", "สินค้า K01", "ชิ้น", "11"]]
      )
    );
    // โกดัง2: "จำนวน คงเหลือ" มีช่องว่างและ (ชิ้น) ท้ายชื่อ
    sheetMock.__setTab(
      "โกดัง2",
      tab(
        ["รหัสสินค้า", "ชื่อสินค้า", "จำนวน คงเหลือ (ชิ้น)"],
        [["K02", "สินค้า K02", "22"]]
      )
    );
    // สำนักงานใหญ่: ราคา/จำนวนขั้นต่ำอยู่หน้าคอลัมน์จำนวนคงเหลือ — ห้ามหยิบผิด
    sheetMock.__setTab(
      "สำนักงานใหญ่",
      tab(
        ["รหัสสินค้า", "ชื่อสินค้า", "ราคา", "จำนวนขั้นต่ำ", "จำนวนคงเหลือ"],
        [["K03", "สินค้า K03", "150", "999", "33"]]
      )
    );

    const stats = await new SheetsDashboardRepository().getStats();

    // ถ้าเลือกผิดคอลัมน์จะได้ 150+999 หรือ 11+22+999 แทน 66
    expect(stats.total_remaining_quantity).toBe(66);
  });

  it("13) กรองรายโกดัง — รวมเฉพาะแท็บของโกดังนั้น", async () => {
    setTabRows("โกดัง1", [stockRow("L01", 100)]);
    for (const tabName of ["สำนักงานใหญ่", "โกดัง2", "โกดัง3", "โกดัง4", "โกดัง5"]) {
      setTabRows(tabName, [stockRow("OTHER", 999)]);
    }

    const stats = await new SheetsDashboardRepository().getStats("wh-1");

    expect(stats.total_remaining_quantity).toBe(100);
    expect(stats.total_sku).toBe(1);
  });

  it("14) total_sku ยังนับ SKU ไม่ซ้ำข้ามแท็บ (normalize รูปแบบรหัส)", async () => {
    setTabRows("โกดัง1", [stockRow("prod-M01", 10)]); // รูปแบบมี prefix
    setTabRows("โกดัง2", [stockRow("M01", 20)]); // รหัสเดียวกันแบบเปล่า
    setTabRows("โกดัง3", [stockRow("M02", 30)]);

    const stats = await new SheetsDashboardRepository().getStats();

    // prod-M01 กับ M01 คือ SKU เดียวกัน → ไม่ซ้ำ 2 รหัส
    expect(stats.total_sku).toBe(2);
    expect(stats.total_remaining_quantity).toBe(60);
  });
});

describe("SheetsDashboardRepository — warehouse_distribution ของกราฟโดนัท", () => {
  it("15) ครบ 6 โกดังเสมอ แม้บางโกดังมีค่า 0 หรือไม่มีข้อมูลเลย", async () => {
    setTabRows("โกดัง2", [stockRow("W01", 70)]);
    // โกดังอื่นว่าง (มีแต่หัวตาราง) — ต้องยังปรากฏใน distribution ด้วยค่า 0

    const stats = await new SheetsDashboardRepository().getStats();

    expect(stats.warehouse_distribution).toHaveLength(6);
    const byId = new Map(
      stats.warehouse_distribution.map((w) => [w.warehouse_id, w])
    );
    expect(byId.get("wh-6")?.warehouse_name).toBe("สำนักงานใหญ่");
    expect(byId.get("wh-2")?.quantity).toBe(70);
    for (const id of ["wh-6", "wh-1", "wh-3", "wh-4", "wh-5"]) {
      expect(byId.get(id)?.quantity).toBe(0);
    }
  });

  it("16) ผลรวมของ distribution ทุกโกดังตรงกับ total_remaining_quantity (การ์ดสินค้าทั้งหมด)", async () => {
    const qtyByTab: Record<string, number> = {
      "สำนักงานใหญ่": 11,
      "โกดัง1": 22,
      "โกดัง2": 33,
      "โกดัง3": 0,
      "โกดัง4": 44,
      "โกดัง5": 55,
    };
    for (const [tabName, qty] of Object.entries(qtyByTab)) {
      if (qty > 0) setTabRows(tabName, [stockRow(`DW-${tabName}`, qty)]);
    }

    const stats = await new SheetsDashboardRepository().getStats();

    const distributionTotal = stats.warehouse_distribution.reduce(
      (sum, w) => sum + w.quantity,
      0
    );
    expect(distributionTotal).toBe(stats.total_remaining_quantity);
    expect(stats.total_remaining_quantity).toBe(165);
  });

  it("17) ค่าติดลบในแท็บส่งต่อตามจริงใน distribution (แสดงสถานะผิดปกติฝั่ง UI)", async () => {
    setTabRows("โกดัง3", [stockRow("N01", 100), stockRow("N02", "-40")]);

    const stats = await new SheetsDashboardRepository().getStats();

    expect(
      stats.warehouse_distribution.find((w) => w.warehouse_id === "wh-3")?.quantity
    ).toBe(60);
  });
});
