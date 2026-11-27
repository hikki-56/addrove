import {
  formatCartonVarianceNote,
  formatReceiptLocationSummary,
  isWarehouse2Floor5Code,
  leftoverLocations,
  pickOfficeLocation,
  receiptLocations,
  warehouse2FloorFromCode,
} from "@/features/production/lib/report-locations";
import type { Location } from "@/types/models";

function loc(partial: Partial<Location> & Pick<Location, "location_id" | "warehouse_id" | "location_code">): Location {
  return { location_name: partial.location_code, active: true, created_at: "", updated_at: "", ...partial };
}

const wh2 = [
  loc({ location_id: "f5a", warehouse_id: "wh-02", location_code: "2K51-1A" }),
  loc({ location_id: "f5b", warehouse_id: "wh-02", location_code: "2K58-2B" }),
  loc({ location_id: "f1", warehouse_id: "wh-02", location_code: "2K11-1A" }),
  loc({ location_id: "a1-2", warehouse_id: "wh-02", location_code: "A1" }),
  loc({ location_id: "empty", warehouse_id: "wh-02", location_code: "", active: true }),
  loc({ location_id: "off", warehouse_id: "wh-02", location_code: "2K51-1A", active: false }),
];
const officeA1 = loc({ location_id: "off-a1", warehouse_id: "wh-06", location_code: "A1" });
const officeShelf = loc({ location_id: "off-k", warehouse_id: "wh-06", location_code: "6K21-1A" });

describe("warehouse 2 floor from location code", () => {
  it("reads the building floor from the lock number", () => {
    expect(warehouse2FloorFromCode("2K51-1A")).toBe(5);
    expect(warehouse2FloorFromCode("2K58-2B")).toBe(5);
    expect(warehouse2FloorFromCode("2K11-1A")).toBe(1);
    expect(warehouse2FloorFromCode("2K45-2A")).toBe(4);
    expect(isWarehouse2Floor5Code("2K51-1A")).toBe(true);
    expect(isWarehouse2Floor5Code("2K11-1A")).toBe(false);
    expect(isWarehouse2Floor5Code("6K51-1A")).toBe(false);
    expect(isWarehouse2Floor5Code("A1")).toBe(false);
  });
});

describe("receipt and leftover location lists", () => {
  it("lists only warehouse 2 floor 5 plus the office location for ผลิตได้จริงเก็บที่", () => {
    const rows = receiptLocations([...wh2, officeA1, officeShelf], "wh-02", officeA1);
    expect(rows.map((r) => r.label)).toEqual(["2K51-1A", "2K58-2B", "ออฟฟิศ"]);
    expect(rows[2]).toMatchObject({ location_id: "off-a1", label: "ออฟฟิศ" });
  });

  it("lists every coded warehouse 2 location for ที่เก็บของเกิน", () => {
    expect(leftoverLocations(wh2, "wh-02").map((r) => r.location_code)).toEqual(["2K11-1A", "2K51-1A", "2K58-2B", "A1"]);
  });

  it("prefers A1 as the office location", () => {
    expect(pickOfficeLocation([officeShelf, officeA1], "wh-06")?.location_id).toBe("off-a1");
  });
});

describe("formatCartonVarianceNote", () => {
  it("writes a short Thai note with ชิ้น and never invents แพ็ก", () => {
    expect(formatCartonVarianceNote({
      overQty: 2,
      shortQty: 1,
      overItemLabel: "ชุดชำระ สีเหลือง",
      leftoverCode: "2K51-1A",
    })).toBe("เกินจากลัง 2 ชิ้น · ตัวที่เกิน: ชุดชำระ สีเหลือง · ที่เก็บของเกิน 2K51-1A · ขาดจากลัง 1 ชิ้น");
    expect(formatCartonVarianceNote({ overQty: 0, shortQty: 3 })).toBe("ขาดจากลัง 3 ชิ้น");
    expect(formatCartonVarianceNote({ overQty: 0, shortQty: 0 })).toBe("");
  });
});

describe("formatReceiptLocationSummary", () => {
  it("joins location labels and quantities", () => {
    expect(formatReceiptLocationSummary([
      { label: "2K51-1A", qty: 8 },
      { label: "ออฟฟิศ", qty: 2 },
    ])).toBe("2K51-1A 8 · ออฟฟิศ 2");
  });
});
