import { query } from "@/server/repositories/postgres/database";
import { getReservedEntries } from "@/server/services/outbound/stock-reservation.service";
import type { IStockRepository } from "@/server/repositories/interfaces";
import type { ProductionBomFormula, ProductionBomSelection, ProductionMaterialStockLocation } from "@/types/production-bom";
import { getProductionMaterialWarehouseId } from "./production-warehouse";
import { ProductionError } from "./production-error";

export async function readMaterialStockLocations(productIds: string[], selectedIds: string[] = []): Promise<ProductionMaterialStockLocation[]> {
  if (!productIds.length) return [];
  const warehouseId = await getProductionMaterialWarehouseId();
  const rows = await query<ProductionMaterialStockLocation>(`SELECT s.product_id,l.location_id,
    coalesce(l.location_code,'') AS location_code,coalesce(l.location_name,'') AS location_name,s.quantity
    FROM stock_summary s JOIN locations l USING(location_id)
    WHERE s.warehouse_id=$1 AND l.warehouse_id=$1 AND l.active AND s.product_id=ANY($2::text[])
      AND (s.quantity>0 OR l.location_id=ANY($3::text[]))
    ORDER BY s.product_id,(l.location_code=''),l.location_code,l.location_id`, [warehouseId, productIds, selectedIds]);
  return rows.map(row => ({ ...row, quantity: Number(row.quantity) }));
}

/** Reservations stay warehouse-wide in storage. Attribute them to the saved pickup
 * points in recipe proportions; old jobs without pickup points protect every source. */
export async function availableMaterialSources(repo: IStockRepository, productIds: string[], excludeJob = "", selectedIds: string[] = []) {
  if (!productIds.length) return [];
  const warehouseId = await getProductionMaterialWarehouseId();
  const [locations, reservations, outbound] = await Promise.all([
    readMaterialStockLocations(productIds, selectedIds),
    query<{ product_id: string; quantity: number; snapshot: ProductionBomFormula; selection: ProductionBomSelection }>(`SELECT r.product_id,r.quantity,p.snapshot,p.selection
      FROM production_material_reservations r JOIN production_material_plans p USING(job_no)
      WHERE r.warehouse_id=$1 AND r.product_id=ANY($2::text[]) AND r.job_no<>$3`, [warehouseId, productIds, excludeJob]),
    getReservedEntries(repo),
  ]);
  return locations.map(location => {
    let reserved = outbound.filter(r => r.product_id === location.product_id).reduce((n, r) => n + r.qty, 0);
    for (const row of reservations.filter(r => r.product_id === location.product_id)) {
      const items = row.snapshot.items.filter(i => i.product_id === location.product_id);
      if (!items.length || items.some(i => !row.selection.material_locations?.[String(i.item_id)])) {
        reserved += Number(row.quantity);
        continue;
      }
      const weight = (i: typeof items[number]) => i.qty * (1 + i.waste_percentage / 100) * (i.unit === i.stock_unit ? 1 : row.selection.material_factors?.[String(i.item_id)] || 0);
      const total = items.reduce((n, i) => n + weight(i), 0);
      const here = items.filter(i => row.selection.material_locations?.[String(i.item_id)] === location.location_id).reduce((n, i) => n + weight(i), 0);
      if (here > 0) reserved += total > 0 ? Math.ceil((Number(row.quantity) * here / total - 1e-8) * 1000) / 1000 : Number(row.quantity);
    }
    return { ...location, available: Math.max(0, Math.round((location.quantity - reserved) * 1000) / 1000) };
  });
}

export async function resolveMaterialSources(formula: ProductionBomFormula, selection: ProductionBomSelection): Promise<ProductionBomSelection> {
  const locations = await readMaterialStockLocations(formula.items.map(i => i.product_id));
  const chosen = { ...selection.material_locations };
  for (const id of Object.keys(chosen)) if (!formula.items.some(i => String(i.item_id) === id)) throw new ProductionError("จุดรับวัตถุดิบไม่ตรงกับสูตร กรุณาเลือกใหม่");
  for (const item of formula.items) {
    const sources = locations.filter(l => l.product_id === item.product_id);
    const id = String(item.item_id);
    if (chosen[id] && !sources.some(l => l.location_id === chosen[id])) throw new ProductionError(`${item.sku}: จุดรับไม่มีสต็อกหรือปิดใช้งาน กรุณาเลือกใหม่`);
    if (!chosen[id] && sources.length === 1) chosen[id] = sources[0].location_id;
    if (!chosen[id] && sources.length > 1) throw new ProductionError(`${item.sku}: เลือกจุดรับวัตถุดิบ`);
  }
  return { ...selection, material_locations: chosen };
}
