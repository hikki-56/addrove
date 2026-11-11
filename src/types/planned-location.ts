export interface PlannedLocation {
  planned_location_id: string;
  warehouse_id: string;
  warehouse_name: string;
  warehouse_prefix: string;
  block_number: number;
  rack_side: "A" | "B" | "C";
  shelf_level: number;
  location_code: string;
  description: string;
  building_floor: number | null;
}
