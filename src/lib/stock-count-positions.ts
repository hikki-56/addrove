import { normalizeWarehouseId } from "@/lib/warehouse-utils";

const warehouseFivePositions = Array.from({ length: 7 }, (_, index) =>
  [1, 2].map(floor => `ห้อง ${index + 1} ชั้น ${floor}`)
).flat();

export function getCountPositions(warehouse: string) {
  return normalizeWarehouseId(warehouse) === "wh-05" ? warehouseFivePositions : undefined;
}
