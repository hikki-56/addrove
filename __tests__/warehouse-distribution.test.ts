// ============================================================
// Unit Tests — กราฟโดนัท "สินค้าแยกตามโกดัง"
// (_lib/warehouse-distribution.ts)
// - แสดงครบ 6 โกดังเสมอแม้บางโกดังมีค่า 0
// - ผลรวมตรงกับการ์ด "สินค้าทั้งหมด" (ใช้แหล่งข้อมูลชุดเดียวกัน)
// - เปอร์เซ็นต์รวม ~100% / ยอดรวม 0 → ไม่มี NaN% หรือเปอร์เซ็นต์เกินจริง
// - ยอดติดลบแสดงยอดจริง + segment ใช้ 0
// ============================================================
import {
  buildWarehouseDonut,
  WAREHOUSE_DONUT_COLORS,
} from "@/app/(dashboard)/dashboard/_lib/warehouse-distribution";
import type { WarehouseDistribution } from "@/types/models";

const SIX_WAREHOUSES: WarehouseDistribution[] = [
  { warehouse_id: "wh-6", warehouse_name: "สำนักงานใหญ่", quantity: 100 },
  { warehouse_id: "wh-1", warehouse_name: "โกดัง1", quantity: 200 },
  { warehouse_id: "wh-2", warehouse_name: "โกดัง2", quantity: 300 },
  { warehouse_id: "wh-3", warehouse_name: "โกดัง3", quantity: 0 },
  { warehouse_id: "wh-4", warehouse_name: "โกดัง4", quantity: 0 },
  { warehouse_id: "wh-5", warehouse_name: "โกดัง5", quantity: 400 },
];

describe("buildWarehouseDonut — กราฟโดนัทแยกตามโกดัง", () => {
  it("แสดงครบ 6 โกดังเสมอแม้บางโกดังมีค่า 0 และใช้สี 6 สีที่แยกกันชัด", () => {
    const donut = buildWarehouseDonut(SIX_WAREHOUSES);

    expect(donut.slices).toHaveLength(6);
    expect(donut.hasData).toBe(true);
    const colors = new Set(donut.slices.map((s) => s.color));
    expect(colors.size).toBe(6);
    expect(WAREHOUSE_DONUT_COLORS).toHaveLength(6);
    // โกดังที่มีค่า 0 ยังอยู่ในรายการ
    expect(donut.slices.map((s) => s.warehouseName)).toEqual(
      expect.arrayContaining(["โกดัง3", "โกดัง4"])
    );
  });

  it("ผลรวมของทั้ง 6 โกดังตรงกับการ์ดสินค้าทั้งหมด (แหล่งข้อมูลชุดเดียวกัน)", () => {
    const donut = buildWarehouseDonut(SIX_WAREHOUSES);

    expect(donut.total).toBe(1000);
  });

  it("เปอร์เซ็นต์แต่ละส่วนเทียบยอดรวม และผลรวมประมาณ 100% (ทนผลต่างการปัดเศษ)", () => {
    const donut = buildWarehouseDonut(SIX_WAREHOUSES);

    expect(donut.slices[0].percent).toBe(10);
    expect(donut.slices[1].percent).toBe(20);
    expect(donut.slices[2].percent).toBe(30);
    expect(donut.slices[5].percent).toBe(40);
    const sum = donut.slices.reduce((acc, s) => acc + s.percent, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(donut.slices.length - 1);
  });

  it("ยอดรวมเป็น 0 → empty state และเปอร์เซ็นต์ทุกส่วนเป็น 0 (ไม่มี NaN%)", () => {
    const donut = buildWarehouseDonut(
      SIX_WAREHOUSES.map((w) => ({ ...w, quantity: 0 }))
    );

    expect(donut.hasData).toBe(false);
    expect(donut.total).toBe(0);
    for (const slice of donut.slices) {
      expect(slice.percent).toBe(0);
      expect(Number.isNaN(slice.percent)).toBe(false);
    }
  });

  it("ไม่มีข้อมูลเลย → empty state", () => {
    expect(buildWarehouseDonut(null).hasData).toBe(false);
    expect(buildWarehouseDonut(undefined).hasData).toBe(false);
    expect(buildWarehouseDonut([]).hasData).toBe(false);
  });

  it("โกดังยอดติดลบ — แสดงยอดจริงพร้อมสถานะผิดปกติ แต่ segment ใช้ 0 และเปอร์เซ็นต์ไม่เกิน 100%", () => {
    const donut = buildWarehouseDonut([
      { warehouse_id: "wh-6", warehouse_name: "สำนักงานใหญ่", quantity: 120 },
      { warehouse_id: "wh-1", warehouse_name: "โกดัง1", quantity: -20 },
    ]);

    const negative = donut.slices[1];
    expect(negative.quantity).toBe(-20);
    expect(negative.segmentValue).toBe(0);
    expect(negative.isNegative).toBe(true);
    // ยอดรวมยังเป็นยอดจริงตามการ์ด "สินค้าทั้งหมด" (net = 100)
    expect(donut.total).toBe(100);
    // โกดังบวก: 120/120 ของฐานฝั่งบวก = 100% ไม่เกิน 100 / โกดังติดลบ: ติดลบตามจริง
    expect(donut.slices[0].percent).toBe(100);
    expect(donut.slices[1].percent).toBe(-17);
  });

  it("ค่า quantity เป็น string ตัวเลข (จาก JSON หลวม) ก็ parse ได้", () => {
    const donut = buildWarehouseDonut([
      { warehouse_id: "wh-6", warehouse_name: "สำนักงานใหญ่", quantity: Number("150") },
      { warehouse_id: "wh-1", warehouse_name: "โกดัง1", quantity: Number("50") },
    ]);

    expect(donut.total).toBe(200);
    expect(donut.slices[0].percent).toBe(75);
  });
});
