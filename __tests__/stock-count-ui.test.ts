import { formatSavedNotice, groupCountEntriesByShelf } from "@/app/(dashboard)/stock-counts/_lib/count-ui";

it("formats the saved-count notice with กล่อง/ชิ้น and without แพ็ก", () => {
  expect(formatSavedNotice({ sku: "SD-45", shelf_code: "1K14-2A", quantity: 26, base_unit: "ชิ้น" }))
    .toBe("บันทึกแล้ว · SD-45 · ชั้น 1K14-2A · 26 ชิ้น");
  expect(formatSavedNotice({ sku: "STL-24", shelf_code: "1K14-1A", quantity: 48, base_unit: "กล่อง" }))
    .toBe("บันทึกแล้ว · STL-24 · ชั้น 1K14-1A · 48 กล่อง");
  expect(formatSavedNotice({ sku: "X", shelf_code: "A", quantity: 1, base_unit: "ชิ้น" })).not.toMatch(/แพ็ก/);
});

it("groups result rows by shelf and keeps the latest counter name", () => {
  const groups = groupCountEntriesByShelf([
    { shelf_code: "1K14-1A", counted_at: "2026-11-20T02:14:22Z", counter_name: "ณรงค์เดช", sku: "A" },
    { shelf_code: "1K14-1A", counted_at: "2026-11-20T02:16:03Z", counter_name: "ณรงค์เดช", sku: "B" },
    { shelf_code: "1K14-2A", counted_at: "2026-11-20T03:02:11Z", counter_name: "ณรงค์เดช", sku: "C" },
    { shelf_code: "1K15-1A", counted_at: "2026-11-20T03:21:07Z", counter_name: "วิกาดา", sku: "D" },
  ]);
  expect(groups.map(g => g.shelf_code)).toEqual(["1K14-1A", "1K14-2A", "1K15-1A"]);
  expect(groups[0].entries).toHaveLength(2);
  expect(groups[2].counter_name).toBe("วิกาดา");
});
