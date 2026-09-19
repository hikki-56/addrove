/**
 * ทดสอบ SheetsWarehouseSyncRepository.syncAdd แบบ "เขียนแล้วต้องตรวจยืนยัน"
 * เป้าหมาย: รับเข้าหลายรายการติดกัน ข้อมูลห้ามหาย และห้ามบวกยอดซ้ำตอน retry
 */
jest.mock("@/lib/google-sheets/client", () => {
  const state = {
    sheets: {} as Record<string, string[][]>,
    readOverrides: [] as Array<(rows: string[][]) => string[][]>,
    appendFailuresRemaining: 0,
    updateFailuresRemaining: 0,
    calls: { read: 0, append: 0, update: 0 },
  };

  return {
    SHEETS: { DOCUMENTS: "DOCUMENTS", STOCK_MOVEMENTS: "STOCK_MOVEMENTS", STOCK_SUMMARY: "STOCK_SUMMARY" },
    getWarehouseSheetName: (whId: string) => `warehouse:${whId}`,
    readSheet: jest.fn(async (name: string) => {
      state.calls.read += 1;
      let rows = (state.sheets[name] || []).map((r) => [...r]);
      const override = state.readOverrides.shift();
      if (override) rows = override(rows);
      return rows;
    }),
    appendRows: jest.fn(async (name: string, rows: unknown[][]) => {
      state.calls.append += 1;
      if (state.appendFailuresRemaining > 0) {
        state.appendFailuresRemaining -= 1;
        throw new Error("Apps Script 429");
      }
      state.sheets[name] = [...(state.sheets[name] || []), ...rows.map((r) => r.map(String))];
    }),
    updateRow: jest.fn(async (name: string, rowNum: number, row: unknown[]) => {
      state.calls.update += 1;
      if (state.updateFailuresRemaining > 0) {
        state.updateFailuresRemaining -= 1;
        throw new Error("Apps Script 500");
      }
      const rows = state.sheets[name] || [];
      rows[rowNum - 2] = row.map(String);
      state.sheets[name] = rows;
    }),
    deleteRows: jest.fn(async () => {}),
    clearSheetCache: jest.fn(),
    __resetSyncAddState: () => {
      state.sheets = {};
      state.readOverrides = [];
      state.appendFailuresRemaining = 0;
      state.updateFailuresRemaining = 0;
      state.calls = { read: 0, append: 0, update: 0 };
    },
    __setRows: (name: string, rows: string[][]) => {
      state.sheets[name] = rows.map((r) => [...r]);
    },
    __getRows: (name: string): string[][] => (state.sheets[name] || []).map((r) => [...r]),
    __queueReadOverride: (fn: (rows: string[][]) => string[][]) => {
      state.readOverrides.push(fn);
    },
    __state: state,
  };
});

import { SheetsWarehouseSyncRepository } from "@/lib/repositories/sheets/warehouse-sync.sheets-repository";
import type { ProductSyncInfo } from "@/lib/repositories/interfaces/warehouse-sync.repository.interface";
import * as client from "@/lib/google-sheets/client";

const mock = client as any;
const repo = new SheetsWarehouseSyncRepository();

const product: ProductSyncInfo = {
  sku: "A1",
  barcode: "90000001",
  product_name: "สินค้าทดสอบ",
  category: "ทั่วไป",
  base_unit: "ชิ้น",
  supplier: "อ-021",
};

const sheetName = "warehouse:wh-1";

beforeEach(() => {
  mock.__resetSyncAddState();
});

describe("syncAdd — เขียนครั้งแรกสำเร็จ", () => {
  it("append แถวใหม่และยืนยันยอดได้เลย", async () => {
    await repo.syncAdd("wh-1", product, 10, "2K12-2A");

    const rows = mock.__getRows(sheetName);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("A1");
    expect(rows[0][5]).toBe("10");
    expect(rows[0][6]).toBe("2K12-2A");
    expect(mock.__state.calls.append).toBe(1);
  });

  it("อัปเดตแถวเดิมด้วยการบวกยอด", async () => {
    mock.__setRows(sheetName, [[
      "A1", "90000001", "สินค้าทดสอบ", "ทั่วไป", "ชิ้น", "100", "2K12-2A", "อ-021", "",
    ]]);

    await repo.syncAdd("wh-1", product, 50, "2K12-2A");

    const rows = mock.__getRows(sheetName);
    expect(rows).toHaveLength(1);
    expect(rows[0][5]).toBe("150");
    expect(mock.__state.calls.update).toBe(1);
    expect(mock.__state.calls.append).toBe(0);
  });
});

describe("syncAdd — ล้มชั่วคราวแล้ว retry จนข้อมูลไม่หาย", () => {
  it("append ล้มรอบแรก (Apps Script error) แล้วสำเร็จรอบสอง", async () => {
    mock.__state.appendFailuresRemaining = 1;

    await repo.syncAdd("wh-1", product, 10, "2K12-2A");

    const rows = mock.__getRows(sheetName);
    expect(rows).toHaveLength(1);
    expect(rows[0][5]).toBe("10");
    expect(mock.__state.calls.append).toBe(2);
  });

  it("update ล้มรอบแรกแล้วสำเร็จรอบสอง ยอดถูกต้อง", async () => {
    mock.__setRows(sheetName, [[
      "A1", "90000001", "สินค้าทดสอบ", "ทั่วไป", "ชิ้น", "100", "2K12-2A", "อ-021", "",
    ]]);
    mock.__state.updateFailuresRemaining = 1;

    await repo.syncAdd("wh-1", product, 50, "2K12-2A");

    expect(mock.__getRows(sheetName)[0][5]).toBe("150");
    expect(mock.__state.calls.update).toBe(2);
  });

  it("ล้มตลอดจนหมดโควตา retry ต้อง throw ไม่ใช่กลืนเงียบ", async () => {
    mock.__state.appendFailuresRemaining = 99;

    await expect(repo.syncAdd("wh-1", product, 10, "2K12-2A")).rejects.toThrow(/A1/);
    expect(mock.__getRows(sheetName)).toHaveLength(0);
    expect(mock.__state.calls.append).toBe(3);
  });
});

describe("syncAdd — เขียนสำเร็จแต่อ่านกลับตรวจไม่เจอ (ข้อมูลเก่า) ห้ามเขียนซ้ำ", () => {
  it("append ลงชีตแล้ว แต่ verify อ่านได้ข้อมูลเก่า → รอบถัดไปต้องเห็นยอดตรงเป้าและหยุด", async () => {
    // read ครั้งที่ 2 (verify ของ attempt 1) คืนชีตว่างเหมือนเดิม (จำลอง cache เก่า)
    mock.__queueReadOverride(() => []);

    await repo.syncAdd("wh-1", product, 10, "2K12-2A");

    const rows = mock.__getRows(sheetName);
    expect(rows).toHaveLength(1); // ห้ามซ้ำสองแถว
    expect(rows[0][5]).toBe("10"); // ห้ามบวกเป็น 20
    expect(mock.__state.calls.append).toBe(1);
    expect(mock.__state.calls.update).toBe(0);
  });

  it("update ลงชีตแล้ว แต่ verify อ่านได้ยอดเก่า → รอบถัดไปต้องเห็นยอดใหม่และหยุด", async () => {
    const original = ["A1", "90000001", "สินค้าทดสอบ", "ทั่วไป", "ชิ้น", "100", "2K12-2A", "อ-021", ""];
    mock.__setRows(sheetName, [original]);
    // verify ของ attempt 1 ยังเห็นยอดเก่า 100
    mock.__queueReadOverride(() => [[...original]]);

    await repo.syncAdd("wh-1", product, 50, "2K12-2A");

    const rows = mock.__getRows(sheetName);
    expect(rows).toHaveLength(1);
    expect(rows[0][5]).toBe("150"); // ห้ามบวกเป็น 200
    expect(mock.__state.calls.update).toBe(1);
  });
});

describe("syncAdd — หลายรายการต่อเนื่อง (ตามที่หน้าอนุมัติเรียก)", () => {
  it("รันต่อเนื่อง 8 รายการ ข้อมูลครบทุกแถว ยอดถูกทุกตัว", async () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({
      product: { ...product, sku: `A${i + 1}`, barcode: `9000000${i + 1}` },
      qty: 100 + i,
    }));

    for (const line of lines) {
      await repo.syncAdd("wh-1", line.product, line.qty, "2K12-2A");
    }

    const rows = mock.__getRows(sheetName);
    expect(rows).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(rows[i][0]).toBe(`A${i + 1}`);
      expect(rows[i][5]).toBe(String(100 + i));
    }
  });

  it("สินค้าเดียวกันรับสองรอบ ต้องรวมยอดในแถวเดียว", async () => {
    await repo.syncAdd("wh-1", product, 120, "2K12-2A");
    await repo.syncAdd("wh-1", product, 80, "2K12-2A");

    const rows = mock.__getRows(sheetName);
    expect(rows).toHaveLength(1);
    expect(rows[0][5]).toBe("200");
  });
});
