import type { PlannedLocation } from "@/types/planned-location";

export const PLANNED_SHELF_BARCODES_HREF = "/shelves/new-barcodes";
export const PLANNED_SHELF_SIDE_NAMES = { A: "ซ้าย", B: "ขวา", C: "กลาง" } as const;
export type ShelfLetter = keyof typeof PLANNED_SHELF_SIDE_NAMES;
export type ShelfLetterLayout = "nine-per-page" | "full-page";

export function buildShelfLetterLabels(letters: ShelfLetter[], copies: number): ShelfLetter[] {
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) return [];
  const selected = (["A", "B", "C"] as const).filter((letter) => letters.includes(letter));
  return Array.from({ length: copies }, () => selected).flat();
}

export function getPlannedBuildingFloor(description: string): number | null {
  const match = description.match(/ชั้นอาคาร\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

export interface PlannedLocationFilters {
  warehouse: string;
  buildingFloor: string;
  shelfLevel: string;
  side: string;
  search: string;
}

export function filterPlannedLocations(locations: PlannedLocation[], filters: PlannedLocationFilters): PlannedLocation[] {
  const term = filters.search.trim().toLocaleLowerCase();
  return locations.filter((location) =>
    (!filters.warehouse || location.warehouse_id === filters.warehouse) &&
    (!filters.buildingFloor || String(location.building_floor) === filters.buildingFloor) &&
    (!filters.shelfLevel || String(location.shelf_level) === filters.shelfLevel) &&
    (!filters.side || location.rack_side === filters.side) &&
    (!term || [location.location_code, location.warehouse_name, String(location.block_number),
      PLANNED_SHELF_SIDE_NAMES[location.rack_side], `L${location.shelf_level}`]
      .some((value) => value.toLocaleLowerCase().includes(term)))
  );
}

/** Nine labels per A4 landscape page; the source order is preserved. */
export function buildPlannedShelfPrintPages<T>(locations: T[]): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < locations.length; i += 9) pages.push(locations.slice(i, i + 9));
  return pages;
}
