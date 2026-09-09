// สร้างข้อมูลกราฟโดนัท "สินค้าแยกตามโกดัง" จาก warehouse_distribution ของ Dashboard API
// เป็น pure function เพื่อทดสอบเปอร์เซ็นต์ ค่าติดลบ และ empty state ได้โดยไม่ต้อง render กราฟ
import type { WarehouseDistribution } from "@/types/models";

// ไล่โทนเขียว 6 ระดับ (เข้ม → อ่อน ตามลำดับโกดัง) — โทนเดียวกับสีแบรนด์ #06402B
// แยก segment ด้วยความสว่างเป็นหลัก และทุกแถว legend มีชื่อโกดัง + ตัวเลขกำกับ
// จึงไม่พึ่งสีเพียงอย่างเดียวในการอ่านกราฟ (ตามหลักสีไม่พูดคนเดียว)
export const WAREHOUSE_DONUT_COLORS = [
  "#06402B", // เขียวแบรนด์ — เข้มสุด
  "#0C5B3E",
  "#177A52",
  "#2E9C6F",
  "#6BC49A",
  "#B4E3CC", // อ่อนสุด — ลดความอิ่มสีใกล้ขาว
] as const;

export interface WarehouseDonutSlice {
  warehouseId: string;
  warehouseName: string;
  // ยอดจริงจากชีต — ติดลบได้และแสดงตามจริงพร้อมสถานะผิดปกติ
  quantity: number;
  // ขนาด segment ของ PieChart — กราฟวงกลมไม่รองรับค่าติดลบ จึงใช้ 0 แทนเฉพาะส่วนนี้
  segmentValue: number;
  // สัดส่วนเทียบฐานฝั่งบวก (ปกติ = ยอดรวม) — 0 เมื่อไม่มียอดบวกเลย กัน NaN% หรือเปอร์เซ็นต์เกิน 100%
  percent: number;
  isNegative: boolean;
  color: string;
}

export interface WarehouseDonutData {
  slices: WarehouseDonutSlice[];
  // ผลรวมยอดจริงทั้งหมด — ต้องตรงกับการ์ด "สินค้าทั้งหมด" เพราะใช้แหล่งข้อมูลชุดเดียวกัน
  total: number;
  // false เมื่อไม่มีข้อมูลหรือยอดรวม <= 0 → หน้า UI แสดง empty state แทนกราฟ
  hasData: boolean;
}

export function buildWarehouseDonut(
  distribution: WarehouseDistribution[] | null | undefined
): WarehouseDonutData {
  const items = Array.isArray(distribution)
    ? distribution.filter((w) => w && w.warehouse_id)
    : [];
  const total = items.reduce((sum, w) => sum + (Number(w.quantity) || 0), 0);
  // ฐานคำนวณเปอร์เซ็นต์ใช้ผลรวมฝั่งบวก — ปกติ (ทุกโกดังบวก) เท่ากับยอดรวมพอดี
  // แต่เมื่อมีโกดังติดลบ ยอดสุทธิจะน้อยกว่า แล้วส่วนแบ่งโกดังบวกจะเกิน 100% ได้
  // การใช้ฐานฝั่งบวกทำให้เปอร์เซ็นต์ไม่เกิน 100% เสมอ (ค่าติดลบแสดงเป็นเปอร์เซ็นต์ติดลบตามจริง)
  const positiveBase = items.reduce(
    (sum, w) => sum + Math.max(0, Number(w.quantity) || 0),
    0
  );

  const slices = items.map((w, index) => {
    const quantity = Number(w.quantity) || 0;
    return {
      warehouseId: w.warehouse_id,
      warehouseName: w.warehouse_name || w.warehouse_id,
      quantity,
      segmentValue: Math.max(0, quantity),
      percent: positiveBase > 0 ? Math.round((quantity / positiveBase) * 100) : 0,
      isNegative: quantity < 0,
      color: WAREHOUSE_DONUT_COLORS[index % WAREHOUSE_DONUT_COLORS.length],
    };
  });

  return { slices, total, hasData: items.length > 0 && total > 0 };
}
