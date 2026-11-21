import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { downloadCounts } from "@/app/(dashboard)/stock-counts/_lib/count-client";
import { formatSavedNotice } from "@/app/(dashboard)/stock-counts/_lib/count-ui";

it("formats the saved-count notice with กล่อง/ชิ้น and without แพ็ก", () => {
  expect(formatSavedNotice({ sku: "SD-45", shelf_code: "1K14-2A", quantity: 26, base_unit: "ชิ้น" }))
    .toBe("บันทึกแล้ว · SD-45 · ตำแหน่ง 1K14-2A · 26 ชิ้น");
  expect(formatSavedNotice({ sku: "STL-24", shelf_code: "1K14-1A", quantity: 48, base_unit: "กล่อง" }))
    .toBe("บันทึกแล้ว · STL-24 · ตำแหน่ง 1K14-1A · 48 กล่อง");
  expect(formatSavedNotice({ sku: "X", shelf_code: "A", quantity: 1, base_unit: "ชิ้น" })).not.toMatch(/แพ็ก/);
});

it("exports each submission with its operator, location, quantity and Bangkok date", async () => {
  const cwd = process.cwd();
  const dir = mkdtempSync(path.join(tmpdir(), "stock-count-export-"));
  try {
    process.chdir(dir);
    const item = { request_id: "1", product_id: "p", product_name: "สินค้า", sku: "SKU", shelf_code: "A1",
      counted_at: "2026-11-20T17:05:00Z", counter_name: "คนแรก", quantity: 2, base_unit: "ชิ้น", barcode: "0012" };
    await downloadCounts([item, { ...item, request_id: "2", counter_name: "คนที่สอง", quantity: 5 }], "โกดัง1", "2026-11-21");
    const workbook = XLSX.read(readFileSync("ตรวจนับ-โกดัง1-2026-11-21.xlsx"));
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["ผลตรวจนับ"], { header: 1 });
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(["โกดัง1", "A1", "SKU", "สินค้า", 2, "ชิ้น", "คนแรก", expect.stringContaining("21/11/69"), "0012"]);
    expect(rows[2][4]).toBe(5);
    expect(rows[2][6]).toBe("คนที่สอง");
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
