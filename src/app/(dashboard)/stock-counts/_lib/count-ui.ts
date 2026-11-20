export function formatSavedNotice(saved: { sku: string; shelf_code: string; quantity: number; base_unit: string }) {
  return `บันทึกแล้ว · ${saved.sku} · ชั้น ${saved.shelf_code} · ${saved.quantity} ${saved.base_unit}`;
}

export function groupCountEntriesByShelf<T extends { shelf_code: string; counted_at: string; counter_name: string }>(entries: T[]) {
  const groups: { shelf_code: string; counter_name: string; entries: T[] }[] = [];
  const index = new Map<string, number>();
  for (const row of entries) {
    const at = index.get(row.shelf_code);
    if (at === undefined) {
      index.set(row.shelf_code, groups.length);
      groups.push({ shelf_code: row.shelf_code, counter_name: row.counter_name, entries: [row] });
      continue;
    }
    const group = groups[at];
    group.entries.push(row);
    const latest = group.entries.reduce((a, b) => (a.counted_at >= b.counted_at ? a : b));
    group.counter_name = latest.counter_name;
  }
  return groups;
}
