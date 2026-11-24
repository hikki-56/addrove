import type { ProductComparison } from "@/types/count-round";

export function addCountQuantity(a: number, b: number) {
  return (Math.round(a * 1000) + Math.round(b * 1000)) / 1000;
}

export function productTotals(comparison: ProductComparison) {
  let expected: number | null = null;
  let counted: number | null = null;
  for (const row of comparison.shelves) {
    if (row.expected_qty !== null) expected = addCountQuantity(expected ?? 0, row.expected_qty);
    if (row.counted_qty !== null) counted = addCountQuantity(counted ?? 0, row.counted_qty);
  }
  return { expected, counted };
}

export function countComparisonLabel(expected: number | null, counted: number | null, closed = false) {
  if (counted === null) return closed && expected ? `ไม่มีรายการนับ · ขาด ${expected}` : "ยังไม่ได้นับ";
  if (expected === null) return "ไม่พบสินค้านี้ในไฟล์ของโกดัง";
  const difference = Math.round((counted - expected) * 1000) / 1000;
  if (difference === 0) return "ตรงกับไฟล์";
  return difference < 0 ? `ขาด ${Math.abs(difference)}` : `เกิน ${difference}`;
}
