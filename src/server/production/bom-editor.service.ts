import { query } from "@/server/repositories/postgres/database";
import { getStorageDriver } from "@/server/repositories/storage-driver";
import { ProductionError } from "@/server/production/production-error";
import type { BomEditorFormula, BomEditorInput } from "@/lib/bom-editor";

/** ทุกสูตรที่เปิดใช้งาน รวมสูตรที่วัตถุดิบไม่ครบ (หน้าแก้ไขต้องเห็นเพื่อซ่อมได้) */
export async function listBomFormulasForEditor(): Promise<BomEditorFormula[]> {
  if (getStorageDriver() !== "postgres") return [];
  const formulas = await query(`SELECT bom_id,fg_sku,fg_name,fg_unit,base_qty,updated_at FROM bom_formulas WHERE active ORDER BY fg_sku,bom_id`);
  const items = await query(`SELECT bom_item_id,bom_id,rm_sku,rm_name,rm_qty_required,rm_unit,waste_percentage,is_primary
    FROM bom_formula_items WHERE bom_id IN (SELECT bom_id FROM bom_formulas WHERE active) ORDER BY bom_id,bom_item_id`);
  return formulas.map((f) => ({
    bom_id: String(f.bom_id), sku: String(f.fg_sku), name: String(f.fg_name), unit: String(f.fg_unit), base_qty: Number(f.base_qty),
    revision: String(f.updated_at),
    items: items.filter((i) => i.bom_id === f.bom_id).map((i) => ({
      item_id: Number(i.bom_item_id), sku: String(i.rm_sku), name: String(i.rm_name), qty: Number(i.rm_qty_required),
      unit: String(i.rm_unit), waste_percentage: Number(i.waste_percentage), is_primary: Number(i.is_primary) === 0 ? 0 as const : 1 as const,
    })),
  }));
}

/** ต้องเรียกภายใน withStorageRequest (ธุรกรรมเดียว) — ล้มที่ใดย้อนกลับทั้งหมด */
export async function updateBomFormula(input: BomEditorInput): Promise<void> {
  if (getStorageDriver() !== "postgres") throw new ProductionError("ระบบนี้รองรับการแก้ไขสูตรเฉพาะฐานข้อมูล PostgreSQL", 400);
  const [formula] = await query(`SELECT bom_id,updated_at FROM bom_formulas WHERE bom_id=$1 AND active FOR UPDATE`, [input.bom_id]);
  if (!formula) throw new ProductionError("ไม่พบสูตรนี้ (อาจถูกปิดใช้งานแล้ว)", 404);
  if (String(formula.updated_at) !== input.revision) throw new ProductionError("สูตรนี้ถูกแก้ไขไปแล้ว กรุณารีเฟรชแล้วลองใหม่", 409);

  const skus = [...new Set(input.items.map((i) => i.sku.trim()))];
  const products = await query(`SELECT sku,name,barcode FROM products WHERE active AND sku = ANY($1::text[])`, [skus]);
  const missing = skus.filter((s) => !products.some((p) => p.sku === s));
  if (missing.length) throw new ProductionError(`ไม่พบรหัสวัตถุดิบที่เปิดใช้งาน: ${missing.join(", ")}`, 400);

  const existing = await query(`SELECT bom_item_id FROM bom_formula_items WHERE bom_id=$1`, [input.bom_id]);
  const existingIds = new Set(existing.map((r) => Number(r.bom_item_id)));
  const keepIds = input.items.flatMap((i) => (i.item_id === undefined ? [] : [i.item_id]));
  if (keepIds.some((id) => !existingIds.has(id))) throw new ProductionError("รายการวัตถุดิบไม่ตรงกับสูตรปัจจุบัน กรุณารีเฟรช", 409);

  await query(`DELETE FROM bom_formula_items WHERE bom_id=$1 AND NOT (bom_item_id = ANY($2::bigint[]))`, [input.bom_id, keepIds]);
  for (const item of input.items) {
    const p = products.find((r) => r.sku === item.sku.trim())!;
    const values = [input.bom_id, p.sku, p.barcode ?? "", p.name, item.qty, item.unit.trim(), item.waste_percentage, item.is_primary];
    if (item.item_id === undefined) {
      await query(`INSERT INTO bom_formula_items (bom_id,rm_sku,rm_barcode,rm_name,rm_qty_required,rm_unit,waste_percentage,is_primary)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, values);
    } else {
      await query(`UPDATE bom_formula_items SET rm_sku=$2,rm_barcode=$3,rm_name=$4,rm_qty_required=$5,rm_unit=$6,waste_percentage=$7,is_primary=$8
        WHERE bom_id=$1 AND bom_item_id=$9`, [...values, item.item_id]);
    }
  }
  // updated_at เปลี่ยนเสมอ (trigger) → revision ใหม่ และ revision ของ ProductionBomFormula เปลี่ยนตาม
  await query(`UPDATE bom_formulas SET fg_unit=$2,base_qty=$3,updated_at=now() WHERE bom_id=$1`, [input.bom_id, input.unit.trim(), input.base_qty]);
}
