import { query } from "@/server/repositories/postgres/database";
import { getPlannedBuildingFloor } from "@/lib/planned-locations";
import type { PlannedLocation } from "@/types/planned-location";

export async function getPlannedLocations(accessibleWarehouses: string[] | null): Promise<PlannedLocation[]> {
  if (accessibleWarehouses?.length === 0) return [];
  const rows = await query<Omit<PlannedLocation, "building_floor">>(`
    SELECT p.planned_location_id, p.warehouse_id, p.warehouse_prefix,
      CASE WHEN p.warehouse_prefix = 'K6' THEN 'ออฟฟิศ' ELSE w.warehouse_name END AS warehouse_name,
      p.block_number, p.rack_side, p.shelf_level, p.location_code, p.description
    FROM public.planned_locations p
    JOIN public.warehouses w ON w.warehouse_id = p.warehouse_id
    WHERE ($1::text[] IS NULL OR regexp_replace(lower(p.warehouse_id), '^wh-0*', 'wh-') = ANY($1::text[]))
    ORDER BY p.warehouse_prefix, p.block_number, p.rack_side, p.shelf_level
  `, [accessibleWarehouses]);
  return rows.map((row) => ({ ...row, building_floor: getPlannedBuildingFloor(row.description) }));
}
