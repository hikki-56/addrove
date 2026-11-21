export function formatSavedNotice(saved: { sku: string; shelf_code: string; quantity: number; base_unit: string }) {
  return `บันทึกแล้ว · ${saved.sku} · ตำแหน่ง ${saved.shelf_code} · ${saved.quantity} ${saved.base_unit}`;
}
