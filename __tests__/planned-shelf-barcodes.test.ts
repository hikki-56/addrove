import { buildPlannedShelfPrintPages, buildShelfLetterLabels, filterPlannedLocations, getPlannedBuildingFloor } from "@/lib/planned-locations";
import type { PlannedLocation } from "@/types/planned-location";

const filters = { warehouse: "", buildingFloor: "", shelfLevel: "", side: "", search: "" };
const items: PlannedLocation[] = [
  { planned_location_id: "new-a", warehouse_id: "wh-06", warehouse_name: "ออฟฟิศ", warehouse_prefix: "K6", block_number: 22, rack_side: "A", shelf_level: 1, location_code: "K6-22-AL1", description: "ชั้นอาคาร 2", building_floor: 2 },
  { planned_location_id: "new-b", warehouse_id: "wh-06", warehouse_name: "ออฟฟิศ", warehouse_prefix: "K6", block_number: 31, rack_side: "B", shelf_level: 2, location_code: "K6-31-BL2", description: "ชั้นอาคาร 3", building_floor: 3 },
  { planned_location_id: "new-c", warehouse_id: "wh-01", warehouse_name: "โกดัง 1", warehouse_prefix: "K1", block_number: 22, rack_side: "C", shelf_level: 3, location_code: "K1-22-CL3", description: "", building_floor: null },
];

test("standalone letter sheets repeat only selected letters and paginate without losing copies", () => {
  const labels = buildShelfLetterLabels(["C", "A", "A"], 5);
  expect(labels).toEqual(["A", "C", "A", "C", "A", "C", "A", "C", "A", "C"]);
  expect(buildPlannedShelfPrintPages(labels).map((page) => page.length)).toEqual([9, 1]);
  expect(buildShelfLetterLabels(["A", "B", "C"], 100)).toHaveLength(300);
  expect(buildShelfLetterLabels([], 3)).toEqual([]);
  for (const copies of [0, -1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(buildShelfLetterLabels(["A"], copies)).toEqual([]);
  }
});

test("building floors are read from their description, never guessed from block or shelf numbers", () => {
  expect(getPlannedBuildingFloor("ร่าง | ชั้นอาคาร 2 | ล็อก 22 | ชั้นวาง L1")).toBe(2);
  expect(getPlannedBuildingFloor("K6-22-AL1 ชั้นวาง L1")).toBeNull();
  expect(getPlannedBuildingFloor("")).toBeNull();
  expect(filterPlannedLocations(items, { ...filters, buildingFloor: "2" }).map((i) => i.location_code)).toEqual(["K6-22-AL1"]);
  expect(filterPlannedLocations(items, { ...filters, shelfLevel: "2" }).map((i) => i.location_code)).toEqual(["K6-31-BL2"]);
});

test("warehouse, side and search filters combine and preserve full new-format codes", () => {
  expect(filterPlannedLocations(items, { ...filters, warehouse: "wh-06", search: "22" }).map((i) => i.location_code)).toEqual(["K6-22-AL1"]);
  expect(filterPlannedLocations(items, { ...filters, search: " k6-31-bl2 " }).map((i) => i.planned_location_id)).toEqual(["new-b"]);
  expect(filterPlannedLocations(items, { ...filters, side: "C", search: "กลาง" }).map((i) => i.location_code)).toEqual(["K1-22-CL3"]);
  expect(filterPlannedLocations(items, { ...filters, warehouse: "wh-01", side: "A" })).toEqual([]);
});

test("print sheets keep label codes intact, include every selected label once and have no empty trailing page", () => {
  const labels = Array.from({ length: 18 }, (_, i) => ({ ...items[0], planned_location_id: `label-${i}`, location_code: `K6-${i + 21}-AL1` }));
  const pages = buildPlannedShelfPrintPages(labels);
  expect(pages.map((p) => p.length)).toEqual([9, 9]);
  expect(pages.flat()).toEqual(labels);
  expect(buildPlannedShelfPrintPages(labels.slice(0, 10)).map((p) => p.length)).toEqual([9, 1]);
  expect(buildPlannedShelfPrintPages([])).toEqual([]);
});
