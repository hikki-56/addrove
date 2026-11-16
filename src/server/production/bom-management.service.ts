import { randomUUID } from "node:crypto";
import { validateBomDraft, type BomEditorInput } from "@/lib/bom-editor";
import { query } from "@/server/repositories/postgres/database";
import { getRepository } from "@/server/repositories";
import { getStorageDriver } from "@/server/repositories/storage-driver";
import { listBomFormulasForEditor, updateBomFormula } from "@/server/production/bom-editor.service";
import { listProductionBoms } from "@/server/production/production-bom.service";
import { ProductionError } from "@/server/production/production-error";
import type { BomCatalogProduct, BomManagementData } from "@/types/bom-management";
import type { Product } from "@/types/models";

const catalogProduct = (p: Product): BomCatalogProduct => ({ product_id: p.product_id, sku: p.sku, product_name: p.product_name, barcode: p.barcode ?? "", base_unit: p.base_unit });

async function getProduct(productId: string) {
  if (getStorageDriver() !== "postgres") throw new ProductionError("ระบบนี้รองรับการจัดการสูตรเฉพาะฐานข้อมูล PostgreSQL", 400);
  const product = await getRepository().products.findById(productId);
  if (!product?.active) throw new ProductionError("ไม่พบสินค้าที่เปิดใช้งาน", 404);
  return product;
}

function checkDraft(input: BomEditorInput) {
  const issues = validateBomDraft(input);
  if (issues.length) throw new ProductionError(issues.join(" · "), 400);
}

async function lockFormula(productId: string, bomId: string, revision: string) {
  const product = await getProduct(productId);
  const [formula] = await query("SELECT bom_id,updated_at FROM bom_formulas WHERE bom_id=$1 AND fg_sku=$2 AND active FOR UPDATE", [bomId, product.sku]);
  if (!formula) throw new ProductionError("ไม่พบสูตรที่เปิดใช้งานสำหรับสินค้านี้", 404);
  if (String(formula.updated_at) !== revision) throw new ProductionError("สูตรนี้ถูกแก้ไขไปแล้ว กรุณาโหลดสูตรใหม่ก่อนดำเนินการ", 409);
  return product;
}

export async function getBomManagementData(productId: string): Promise<BomManagementData> {
  const product = await getProduct(productId);
  const [formulas, productionFormulas, materials] = await Promise.all([
    listBomFormulasForEditor(product.sku), listProductionBoms(product.product_id), getRepository().products.findAll({ activeOnly: true }),
  ]);
  return { product: catalogProduct(product), formulas, production_formulas: productionFormulas, materials: materials.map(catalogProduct) };
}

/** Call inside withStorageRequest: header, materials and edit status commit together. */
export async function createBomFormula(productId: string, input: Omit<BomEditorInput, "bom_id" | "revision">): Promise<string> {
  const bomId = `BOM-${randomUUID()}`;
  const draft: BomEditorInput = { ...input, bom_id: bomId, revision: "new", items: input.items.map(item => ({ ...item, item_id: undefined })) };
  checkDraft(draft);
  const product = await getProduct(productId);
  const [header] = await query(`INSERT INTO bom_formulas(bom_id,fg_sku,fg_barcode,fg_name,fg_unit,base_qty)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING updated_at`, [bomId, product.sku, product.barcode ?? "", product.product_name, input.unit.trim(), input.base_qty]);
  await updateBomFormula({ ...draft, revision: String(header.updated_at) });
  return bomId;
}

export async function updateProductBomFormula(productId: string, input: BomEditorInput): Promise<void> {
  checkDraft(input);
  await lockFormula(productId, input.bom_id, input.revision);
  await updateBomFormula(input);
}

/** Deactivate only: existing production plans keep their frozen recipe and item IDs. */
export async function deleteBomFormula(productId: string, bomId: string, revision: string): Promise<void> {
  await lockFormula(productId, bomId, revision);
  await query("UPDATE bom_formulas SET active=false,edited_at=now() WHERE bom_id=$1", [bomId]);
}
