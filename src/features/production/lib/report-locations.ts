import { parsePositionCode } from "@/lib/warehouse-layout";
import { isOfficeWarehouse } from "@/lib/office";
import type { Location, Warehouse } from "@/types/models";

export const OFFICE_LOCATION_LABEL = "ออฟฟิศ";

export interface ReportLocationOption {
  location_id: string;
  location_code: string;
  label: string;
  warehouse_id: string;
}

/** ชั้นอาคารจากรหัสตำแหน่งโกดัง 2 เช่น 2K51-1A = ชั้น 5 ล็อก 1 */
export function warehouse2FloorFromCode(code: string | null | undefined): number | null {
  const text = String(code || "").trim().toUpperCase();
  const parsed = parsePositionCode(text);
  if (parsed?.whNum === 2) return Math.floor(parsed.lock / 10) || null;
  const loose = text.match(/^2K(\d+)/);
  if (!loose) return null;
  const floor = Math.floor(Number(loose[1]) / 10);
  return floor > 0 ? floor : null;
}

export function isWarehouse2Floor5Code(code: string | null | undefined): boolean {
  return warehouse2FloorFromCode(code) === 5;
}

export function isWarehouse2(warehouse: Pick<Warehouse, "warehouse_id" | "warehouse_name">): boolean {
  return /^wh-0?2$/i.test(warehouse.warehouse_id) || /^โกดัง\s*2$/.test(warehouse.warehouse_name.replace(/\s+/g, ""));
}

export function findOfficeWarehouse(warehouses: Warehouse[]): Warehouse | undefined {
  return warehouses.find((w) => w.active && isOfficeWarehouse(w));
}

export function findWarehouse2(warehouses: Warehouse[]): Warehouse | undefined {
  return warehouses.find((w) => w.active && isWarehouse2(w));
}

export function toLocationOption(location: Pick<Location, "location_id" | "location_code" | "warehouse_id">, label = location.location_code): ReportLocationOption {
  return { location_id: location.location_id, location_code: location.location_code, label, warehouse_id: location.warehouse_id };
}

export function receiptLocations(locations: Location[], warehouse2Id: string, office: Location | null): ReportLocationOption[] {
  const floor5 = locations
    .filter((l) => l.active && l.warehouse_id === warehouse2Id && l.location_code && isWarehouse2Floor5Code(l.location_code))
    .sort((a, b) => a.location_code.localeCompare(b.location_code, "en"))
    .map((l) => toLocationOption(l));
  return office ? [...floor5, toLocationOption(office, OFFICE_LOCATION_LABEL)] : floor5;
}

export function leftoverLocations(locations: Location[], warehouse2Id: string): ReportLocationOption[] {
  return locations
    .filter((l) => l.active && l.warehouse_id === warehouse2Id && l.location_code)
    .sort((a, b) => a.location_code.localeCompare(b.location_code, "en"))
    .map((l) => toLocationOption(l));
}

/** เลือกตำแหน่งออฟฟิศหนึ่งจุดจากคลังสำนักงานใหญ่ — ใช้ A1 ถ้ามี */
export function pickOfficeLocation(locations: Location[], officeWarehouseId: string): Location | null {
  const rows = locations.filter((l) => l.active && l.warehouse_id === officeWarehouseId);
  const byCode = (code: string) => rows.find((l) => l.location_code.trim().toUpperCase() === code);
  return byCode("A1") || rows.find((l) => l.location_code.trim()) || rows[0] || null;
}

export function formatCartonVarianceNote(input: {
  overQty: number;
  shortQty: number;
  overItemLabel?: string;
  leftoverCode?: string;
}): string {
  const qty = (n: number) => (Number.isInteger(n) ? String(n) : String(n));
  const parts: string[] = [];
  if (input.overQty > 0) {
    parts.push(`เกินจากลัง ${qty(input.overQty)} ชิ้น`);
    if (input.overItemLabel) parts.push(`ตัวที่เกิน: ${input.overItemLabel}`);
    if (input.leftoverCode) parts.push(`ที่เก็บของเกิน ${input.leftoverCode}`);
  }
  if (input.shortQty > 0) parts.push(`ขาดจากลัง ${qty(input.shortQty)} ชิ้น`);
  return parts.join(" · ");
}
