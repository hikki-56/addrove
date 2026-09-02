import { normalizeWarehouseId } from "@/lib/warehouse-utils";

// ผังโกดังตามแบบสถานที่จริง (K.1-K.4)
// รหัสตำแหน่ง: [เลขโกดัง]K[เลขล็อก]-[ด้าน][ระดับ] เช่น 1K14-1A = โกดัง 1 ล็อก 14 ซ้ายล่าง
// ด้าน: 1 = ซ้าย, 2 = ขวา | ระดับ: A = ล่าง, B = บน
// ตัวเลขล็อก 2 หลัก = [ชั้น][ล็อกในชั้น] เช่น ล็อก 14 = ชั้น 1 ล็อกที่ 4

export type PositionSide = 1 | 2;
export type PositionLevel = "A" | "B";

export interface ParsedPositionCode {
  whNum: number;
  lock: number;
  side: PositionSide;
  level: PositionLevel;
}

export const SIDE_LABELS: Record<PositionSide, string> = { 1: "ซ้าย", 2: "ขวา" };
export const LEVEL_LABELS: Record<PositionLevel, string> = { A: "ล่าง", B: "บน" };

export function positionCode(whNum: number, lock: number, side: PositionSide, level: PositionLevel): string {
  return `${whNum}K${lock}-${side}${level}`;
}

export function parsePositionCode(code: string | null | undefined): ParsedPositionCode | null {
  const m = String(code || "").trim().toUpperCase().match(/^(\d)K(\d+)-([12])([AB])$/);
  if (!m) return null;
  return { whNum: Number(m[1]), lock: Number(m[2]), side: Number(m[3]) as PositionSide, level: m[4] as PositionLevel };
}

export function positionLabel(side: PositionSide, level: PositionLevel): string {
  return `${SIDE_LABELS[side]}${LEVEL_LABELS[level]}`;
}

export interface WarehouseFloorLayout {
  floor: number;
  locks: number[];
  /** ข้อความแสดงแทนเมื่อชั้นนี้ไม่มีล็อก เช่น ชั้น 1 ออฟฟิศ */
  note?: string;
}

export interface WarehouseLayout {
  warehouse_id: string;
  wh_num: number;
  building_code: string;
  address_label: string;
  floors: WarehouseFloorLayout[];
}

function lockRange(floor: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(floor * 10 + i);
  return out;
}

// ตัวเลขล็อกต่อชั้นอิงจากแบบผังอาคารที่แนบมา (K.1 ชั้น 2 มีแค่ 4 ล็อก ส่วนชั้นอื่น 6 ล็อก)
export const WAREHOUSE_LAYOUTS: Record<string, WarehouseLayout> = {
  "wh-01": {
    warehouse_id: "wh-01",
    wh_num: 1,
    building_code: "K.1",
    address_label: "บ้านเลขที่ 58/90 และ 58/91",
    floors: [
      { floor: 1, locks: lockRange(1, 1, 6) },
      { floor: 2, locks: lockRange(2, 1, 4) },
      { floor: 3, locks: lockRange(3, 1, 6) },
      { floor: 4, locks: lockRange(4, 1, 6) },
    ],
  },
  "wh-02": {
    warehouse_id: "wh-02",
    wh_num: 2,
    building_code: "K.2",
    address_label: "บ้านเลขที่ 7 และ 9",
    floors: [1, 2, 3, 4, 5].map((f) => ({ floor: f, locks: lockRange(f, 1, 8) })),
  },
  "wh-03": {
    warehouse_id: "wh-03",
    wh_num: 3,
    building_code: "K.3",
    address_label: "บ้านเลขที่ 10",
    floors: [1, 2, 3, 4, 5].map((f) => ({ floor: f, locks: lockRange(f, 1, 4) })),
  },
  "wh-04": {
    warehouse_id: "wh-04",
    wh_num: 4,
    building_code: "K.4",
    address_label: "บ้านเลขที่ 26",
    floors: [1, 2].map((f) => ({ floor: f, locks: lockRange(f, 1, 4) })),
  },
  // สำนักงานใหญ่ = ออฟฟิศ ชั้น 1 เป็นออฟฟิศ/ห้อง QC ไม่มีล็อก เริ่มจัดเก็บที่ล็อก 21 (ชั้น 2)
  "wh-06": {
    warehouse_id: "wh-06",
    wh_num: 6,
    building_code: "Office",
    address_label: "บ้านเลขที่ 41, 43 และ 45",
    floors: [
      { floor: 1, locks: [], note: "ชั้นนี้เป็นออฟฟิศและห้อง QC — ไม่มีล็อกจัดเก็บสินค้า" },
      { floor: 2, locks: [21, 22, 23] },
      { floor: 3, locks: lockRange(3, 1, 9) },
      { floor: 4, locks: lockRange(4, 1, 9) },
      { floor: 5, locks: lockRange(5, 1, 9) },
    ],
  },
};

export function getWarehouseLayout(whId: string | null | undefined): WarehouseLayout | null {
  return WAREHOUSE_LAYOUTS[normalizeWarehouseId(whId)] || null;
}

export interface LockPositionDef {
  code: string;
  side: PositionSide;
  level: PositionLevel;
  label: string;
}

// เรียงตามที่วางบนการ์ดล็อก: แถวบน [ซ้ายบน, ขวาบน] แถวล่าง [ซ้ายล่าง, ขวาล่าง]
export function lockPositions(whNum: number, lock: number): LockPositionDef[] {
  return [
    { code: positionCode(whNum, lock, 1, "B"), side: 1, level: "B", label: positionLabel(1, "B") },
    { code: positionCode(whNum, lock, 2, "B"), side: 2, level: "B", label: positionLabel(2, "B") },
    { code: positionCode(whNum, lock, 1, "A"), side: 1, level: "A", label: positionLabel(1, "A") },
    { code: positionCode(whNum, lock, 2, "A"), side: 2, level: "A", label: positionLabel(2, "A") },
  ];
}

export type PositionStatus = "empty" | "partial" | "full";

export function positionStatus(qty: number, capacity: number): PositionStatus {
  if (qty <= 0) return "empty";
  if (capacity > 0 && qty >= capacity) return "full";
  return "partial";
}

export const DEFAULT_POSITION_CAPACITY = 1000;
