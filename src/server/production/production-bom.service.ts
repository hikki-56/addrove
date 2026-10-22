import { query } from "@/server/repositories/postgres/database";
import { createHash } from "node:crypto";
import { getStorageDriver } from "@/server/repositories/storage-driver";
import { previewProductionBom } from "@/lib/production-bom";
import type { ProductionBomFormula, ProductionBomSelection } from "@/types/production-bom";
import { getProductionMaterialWarehouseId } from "@/server/production/production-warehouse";

/** Read every material row; the main/secondary marker is displayed, never silently filtered. */
export async function listProductionBoms(productId?: string): Promise<ProductionBomFormula[]> {
  if (getStorageDriver() !== "postgres") return [];
  const warehouseId = await getProductionMaterialWarehouseId();
  const formulas = await query(`SELECT f.*,p.product_id,p.base_unit AS stock_unit FROM bom_formulas f
    JOIN products p ON p.sku=f.fg_sku AND p.active
    WHERE f.active AND ($1::text IS NULL OR p.product_id=$1 OR p.sku=$1)
    ORDER BY f.fg_sku,f.bom_id`, [productId || null]);
  const materials = await query(`SELECT i.*,p.product_id,p.base_unit AS stock_unit
    FROM bom_formula_items i JOIN products p ON p.sku=i.rm_sku AND p.active
    ORDER BY i.bom_id,i.bom_item_id`);
  const counts = await query("SELECT bom_id,count(*)::integer AS total FROM bom_formula_items GROUP BY bom_id");
  return formulas.map((f): ProductionBomFormula | null => {
    const items = materials.filter(i => i.bom_id === f.bom_id).map(i => ({
      item_id: Number(i.bom_item_id), product_id: String(i.product_id), sku: String(i.rm_sku), name: String(i.rm_name), barcode: String(i.rm_barcode),
      qty: Number(i.rm_qty_required), unit: String(i.rm_unit), stock_unit: String(i.stock_unit), warehouse_id: warehouseId,
      is_primary: Number(i.is_primary), role_confirmed: !Array.isArray(i.source_cells) || i.source_cells.length === 0 || String(i.source_cells[4] ?? "").trim() !== "", waste_percentage: Number(i.waste_percentage),
    }));
    // Missing/inactive material references cannot make a recipe look complete.
    if (!items.length || items.length !== Number(counts.find(c => c.bom_id === f.bom_id)?.total || 0)) return null;
    return { bom_id: String(f.bom_id), product_id: String(f.product_id), sku: String(f.fg_sku), name: String(f.fg_name),
      label: `${f.bom_id} · ${items.filter(i => i.is_primary === 1).map(i => i.name).join(" / ") || f.fg_name}`,
      unit: String(f.fg_unit), stock_unit: String(f.stock_unit), base_qty: Number(f.base_qty), items,
      revision: createHash("sha256").update(JSON.stringify([f.updated_at, f.base_qty, f.fg_unit, f.stock_unit, items])).digest("hex") };
  }).filter((f): f is ProductionBomFormula => f !== null);
}

export async function getProductionBomPreview(selection: ProductionBomSelection, productId: string, targetQty: number) {
  const formula = (await listProductionBoms(productId)).find(f => f.bom_id === selection.bom_id);
  if (!formula) throw new Error("ไม่พบสูตรที่เปิดใช้งานสำหรับสินค้าที่เลือก");
  return previewProductionBom(formula, targetQty, selection);
}
