import type { ProductionBomFormula, ProductionBomPreview, ProductionBomSelection } from "@/types/production-bom";

const countUnits = new Set(["ชุด", "ชิ้น", "ใบ", "อัน", "ดวง", "เส้น", "ตัว", "หัว", "ลูก", "คู่", "pcs.", "ผืน", "บาน", "กระป๋อง", "คัน", "เล่ม", "หลอด", "ม้วน", "ขวด", "โหล", "ถุง", "แผง", "ห่อ"]);
const round = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;

export function productionMainCapacity(formula: ProductionBomFormula, selection: Partial<ProductionBomSelection>, available: (productId: string, warehouseId: string) => number): number | null {
  if (!Number.isFinite(formula.base_qty) || formula.base_qty <= 0) return null;
  const totals = new Map<string, { qty: number; available: number }>();
  for (const item of formula.items) {
    const chosen = selection.material_roles?.[String(item.item_id)];
    if (item.role_confirmed === false && chosen === undefined) return null;
    const role = chosen ?? item.is_primary;
    if (role !== 0 && role !== 1) return null;
    if (role === 0) continue;
    const factor = factorFor(item.unit, item.stock_unit, selection.material_factors?.[String(item.item_id)]);
    if (!item.warehouse_id || factor === null || !Number.isFinite(item.qty) || item.qty <= 0 || !Number.isFinite(item.waste_percentage) || item.waste_percentage < 0 || item.waste_percentage > 100) return null;
    const qty = item.qty / formula.base_qty * (1 + item.waste_percentage / 100) * factor;
    if (!Number.isFinite(qty) || qty <= 0) return null;
    const key = item.product_id + "\0" + item.warehouse_id;
    totals.set(key, { qty: (totals.get(key)?.qty || 0) + qty, available: Math.max(0, available(item.product_id, item.warehouse_id)) });
  }
  const capacity = Math.min(...[...totals.values()].map(i => Math.floor(i.available / i.qty)));
  return totals.size && Number.isFinite(capacity) ? capacity : null;
}

function factorFor(unit: string, stockUnit: string, supplied: number | undefined): number | null {
  if (unit === stockUnit) return 1;
  return typeof supplied === "number" && Number.isFinite(supplied) && supplied > 0 ? supplied : null;
}

export function previewProductionBom(formula: ProductionBomFormula, targetQty: number, selection: Partial<ProductionBomSelection> = {}, options: { allowZero?: boolean } = {}): ProductionBomPreview {
  const issues: string[] = [];
  if (!Number.isFinite(targetQty) || targetQty < 0 || targetQty === 0 && !options.allowZero) issues.push("จำนวนผลิตต้องมากกว่า 0");
  if (!Number.isFinite(formula.base_qty) || formula.base_qty <= 0) issues.push("จำนวนฐานของสูตรต้องมากกว่า 0");
  if (countUnits.has(formula.unit) && !Number.isInteger(targetQty)) issues.push(`จำนวนผลิตหน่วย ${formula.unit} ต้องเป็นจำนวนเต็ม`);
  if (!formula.items.length) issues.push("สูตรนี้ยังไม่มีรายการวัตถุดิบ");
  const factor = factorFor(formula.unit, formula.stock_unit, selection.fg_factor);
  if (factor === null) issues.push(`ระบุอัตราแปลงสินค้าสำเร็จรูป: 1 ${formula.unit} เท่ากับกี่ ${formula.stock_unit}`);
  const finishedRaw = factor === null ? null : targetQty * factor;
  const finished = finishedRaw === null ? null : round(finishedRaw);
  if (finishedRaw !== null && countUnits.has(formula.stock_unit) && Math.abs(finishedRaw - Math.round(finishedRaw)) > 1e-8) issues.push("จำนวนสินค้ารับเข้าหลังแปลงหน่วยต้องเป็นจำนวนเต็ม");
  if (finishedRaw !== null && Math.abs(finishedRaw - finished!) > 1e-8) issues.push("จำนวนสินค้ารับเข้าละเอียดเกิน 0.001 หน่วย ต้องตรวจอัตราแปลง");
  const materials = formula.items.map(item => {
    if (!item.warehouse_id) issues.push(`${item.sku}: ไม่พบคลังวัตถุดิบที่ระบุในสูตร`);
    const chosenRole = selection.material_roles?.[String(item.item_id)];
    const roleConfirmed = item.role_confirmed !== false || chosenRole !== undefined;
    const role = chosenRole ?? item.is_primary;
    if (!roleConfirmed || ![0, 1].includes(role)) issues.push(`${item.sku}: กรุณาระบุว่าเป็นตัวหลักหรือตัวรอง`);
    if (!Number.isFinite(item.qty) || item.qty <= 0) issues.push(`${item.sku}: จำนวนใช้ในสูตรต้องมากกว่า 0`);
    if (!Number.isFinite(item.waste_percentage) || item.waste_percentage < 0 || item.waste_percentage > 100) issues.push(`${item.sku}: อัตราสูญเสียไม่ถูกต้อง`);
    const itemFactor = factorFor(item.unit, item.stock_unit, selection.material_factors?.[String(item.item_id)]);
    if (itemFactor === null) issues.push(`${item.sku}: ระบุอัตราแปลง 1 ${item.unit} เท่ากับกี่ ${item.stock_unit}`);
    const rawRecipeQty = item.qty * targetQty / formula.base_qty * (1 + item.waste_percentage / 100);
    const recipeQty = round(rawRecipeQty);
    const rawStockQty = itemFactor === null ? null : rawRecipeQty * itemFactor;
    const stockQty = rawStockQty === null ? null : round(rawStockQty);
    if (!Number.isFinite(recipeQty) || stockQty !== null && !Number.isFinite(stockQty)) issues.push(`${item.sku}: คำนวณจำนวนไม่ได้`);
    if (rawStockQty !== null && countUnits.has(item.stock_unit) && Math.abs(rawStockQty - Math.round(rawStockQty)) > 1e-8) issues.push(`${item.sku}: จำนวนใช้หลังแปลงหน่วยเป็นเศษ ต้องตรวจจำนวนผลิตหรืออัตราแปลงก่อน`);
    if (rawStockQty !== null && Math.abs(rawStockQty - stockQty!) > 1e-8) issues.push(`${item.sku}: ผลคำนวณละเอียดเกิน 0.001 หน่วย ต้องตรวจจำนวนผลิตหรืออัตราแปลง`);
    return { ...item, is_primary: role, role_confirmed: roleConfirmed, recipe_qty: recipeQty, stock_qty: stockQty, factor: itemFactor };
  });
  if (!materials.some(i => i.is_primary === 1 && i.role_confirmed)) issues.push("สูตรต้องมีวัตถุดิบหลักอย่างน้อยหนึ่งรายการเพื่อคำนวณกำลังผลิต");
  return { formula, target_qty: targetQty, fg_factor: factor, finished_stock_qty: finished, materials, issues };
}

export function isValidProductionStockQuantity(value: number, unit: string): boolean {
  return Number.isFinite(value) && value >= 0 && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7 && (!countUnits.has(unit) || Number.isInteger(value));
}
