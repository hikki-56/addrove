import { query } from "@/server/repositories/postgres/database";
import type { ProductionBomFormula } from "@/types/production-bom";

/** Production uses warehouse 2 even when an imported BOM names another source. */
export async function getProductionMaterialWarehouseId(): Promise<string> {
  const [warehouse] = await query<{ warehouse_id: string }>(`SELECT warehouse_id FROM warehouses
    WHERE active AND (warehouse_id IN ('wh-02','wh-2') OR regexp_replace(warehouse_name,'\\s','','g')='โกดัง2')
    ORDER BY CASE warehouse_id WHEN 'wh-02' THEN 0 WHEN 'wh-2' THEN 1 ELSE 2 END,warehouse_id LIMIT 1`);
  return warehouse?.warehouse_id || "";
}

/** Keep the saved recipe quantities; scope its stock source to the production warehouse. */
export function scopeProductionMaterials(formula: ProductionBomFormula, warehouseId: string): ProductionBomFormula {
  return { ...formula, items: formula.items.map(item => ({ ...item, warehouse_id: warehouseId })) };
}
