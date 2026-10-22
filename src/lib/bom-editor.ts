// สิทธิ์และตรรกะล้วน (pure) ของหน้า "แก้ไขสูตร BOM" — ใช้ร่วมกันทั้ง client และ server

/** บัญชีเดียวที่เห็นเมนูและแก้ไขสูตร BOM ได้ (ตรวจซ้ำฝั่งเซิร์ฟเวอร์ทุกครั้ง) */
export const BOM_EDITOR_EMAIL = "ty@stockify.com";
export const BOM_EDITOR_HREF = "/production/formula";

export function canEditBom(email?: string | null): boolean {
  return typeof email === "string" && email.trim().toLowerCase() === BOM_EDITOR_EMAIL;
}

export interface BomEditorItem {
  /** ไม่มี = บรรทัดใหม่ */
  item_id?: number;
  sku: string;
  name?: string;
  qty: number;
  unit: string;
  waste_percentage: number;
  is_primary: 0 | 1;
}

export interface BomEditorFormula {
  bom_id: string;
  sku: string;
  name: string;
  unit: string;
  base_qty: number;
  items: BomEditorItem[];
  /** updated_at ของสูตร — กันบันทึกทับข้อมูลที่ผู้อื่นแก้ */
  revision: string;
}

export interface BomEditorInput {
  bom_id: string;
  revision: string;
  unit: string;
  base_qty: number;
  items: BomEditorItem[];
}

const isQty = (n: number) => Number.isFinite(n) && n > 0 && Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7 && n < 1e11;

/** ตรวจฟอร์มก่อนบันทึก — คืนรายการข้อความผิดพลาด (ว่าง = ผ่าน) */
export function validateBomDraft(draft: BomEditorInput): string[] {
  const errors: string[] = [];
  if (!draft.bom_id.trim()) errors.push("ไม่พบรหัสสูตร");
  if (!draft.unit.trim()) errors.push("กรุณาระบุหน่วยสินค้าสำเร็จรูป");
  if (!isQty(draft.base_qty)) errors.push("จำนวนฐานของสูตรต้องมากกว่า 0 (ทศนิยมไม่เกิน 3 ตำแหน่ง)");
  if (!draft.items.length) errors.push("สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ");
  const seen = new Set<string>();
  draft.items.forEach((item, i) => {
    const row = `แถวที่ ${i + 1}`;
    const sku = item.sku.trim();
    if (!sku) errors.push(`${row}: กรุณาระบุรหัสวัตถุดิบ`);
    else if (seen.has(sku.toLowerCase())) errors.push(`${row}: วัตถุดิบ ${sku} ซ้ำในสูตร`);
    seen.add(sku.toLowerCase());
    if (!isQty(item.qty)) errors.push(`${row}: จำนวนใช้ต้องมากกว่า 0 (ทศนิยมไม่เกิน 3 ตำแหน่ง)`);
    if (!item.unit.trim()) errors.push(`${row}: กรุณาระบุหน่วย`);
    if (!Number.isFinite(item.waste_percentage) || item.waste_percentage < 0 || item.waste_percentage > 100) errors.push(`${row}: อัตราสูญเสียต้องอยู่ระหว่าง 0–100%`);
    if (item.is_primary !== 0 && item.is_primary !== 1) errors.push(`${row}: กรุณาเลือกตัวหลัก/ตัวรอง`);
  });
  if (draft.items.length && !draft.items.some((i) => i.is_primary === 1)) errors.push("สูตรต้องมีวัตถุดิบหลักอย่างน้อย 1 รายการ");
  return errors;
}

/** ค้นหาสูตรด้วยรหัสสูตร / SKU / ชื่อสินค้า / วัตถุดิบ */
export function filterBomFormulas<T extends Pick<BomEditorFormula, "bom_id" | "sku" | "name" | "items">>(formulas: T[], search: string): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return formulas;
  return formulas.filter((f) =>
    [f.bom_id, f.sku, f.name, ...f.items.flatMap((i) => [i.sku, i.name || ""])].some((v) => v.toLowerCase().includes(q))
  );
}
