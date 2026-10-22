import { previewProductionBom, isValidProductionStockQuantity, productionMainCapacity } from "@/lib/production-bom";
import type { ProductionBomFormula } from "@/types/production-bom";

const formula: ProductionBomFormula = { bom_id: "BOM", product_id: "fg", sku: "FG", name: "FG", label: "BOM", unit: "ชุด", stock_unit: "ชุด", base_qty: 10,
  items: [
    { item_id: 1, product_id: "main", sku: "MAIN", name: "Main", barcode: "M", qty: 40, unit: "ตัว", stock_unit: "ตัว", warehouse_id: "wh-02", is_primary: 1, waste_percentage: 0 },
    { item_id: 2, product_id: "shared", sku: "SHARED", name: "Shared", barcode: "S", qty: 10, unit: "ใบ", stock_unit: "ใบ", warehouse_id: "wh-02", is_primary: 0, waste_percentage: 0 },
  ] };

test("scales from the recipe base and includes shared secondary materials", () => {
  const p = previewProductionBom(formula, 100);
  expect(p.issues).toEqual([]);
  expect(p.materials.map(i => [i.sku, i.stock_qty])).toEqual([["MAIN", 400], ["SHARED", 100]]);
  expect(formula.items[0].qty).toBe(40);
});

test("search capacity uses main ratios and aggregates repeated main materials, without limiting by secondary stock", () => {
  expect(productionMainCapacity(formula, {}, id => id === "main" ? 100 : 0)).toBe(25);
  expect(productionMainCapacity({ ...formula, items: [...formula.items, { ...formula.items[0], item_id: 3 }] }, {}, () => 100)).toBe(12);
  expect(productionMainCapacity(formula, {}, () => 0)).toBe(0);
});

test("search capacity is unknown until main units and blank roles are confirmed", () => {
  const changed = { ...formula, items: [{ ...formula.items[0], unit: "คู่" }] };
  expect(productionMainCapacity(changed, {}, () => 100)).toBeNull();
  expect(productionMainCapacity(changed, { material_factors: { "1": 2 } }, () => 100)).toBe(12);
  const blank = { ...formula, items: [{ ...formula.items[0], role_confirmed: false }] };
  expect(productionMainCapacity(blank, {}, () => 100)).toBeNull();
  expect(productionMainCapacity(blank, { material_roles: { "1": 1 } }, () => 100)).toBe(25);
});
test("different units require an explicit per-material factor; pairs are never assumed to be pieces", () => {
  const f = { ...formula, items: [{ ...formula.items[0], unit: "คู่", stock_unit: "ชิ้น" }] };
  expect(previewProductionBom(f, 10).materials[0].stock_qty).toBeNull();
  expect(previewProductionBom(f, 10).issues).not.toEqual([]);
  expect(previewProductionBom(f, 10, { material_factors: { "1": 2 } }).materials[0].stock_qty).toBe(80);
});
test("finished goods conversions are independent of material conversions", () => {
  const f = { ...formula, stock_unit: "ชิ้น" };
  expect(previewProductionBom(f, 10).finished_stock_qty).toBeNull();
  expect(previewProductionBom(f, 10, { fg_factor: 2 }).finished_stock_qty).toBe(20);
});
test("fractional count requirements are rejected instead of silently rounded up", () => {
  const f = { ...formula, base_qty: 3, items: [{ ...formula.items[0], qty: 1 }] };
  expect(previewProductionBom(f, 1).issues.join(" ")).toContain("เป็นเศษ");
});

test("close-only reports validate zero consumption without rejecting fractional per-unit recipes", () => {
  const f = { ...formula, base_qty: 1, items: [{ ...formula.items[0], qty: 0.5 }] };
  expect(previewProductionBom(f, 0).issues.length).toBeGreaterThan(0);
  const preview = previewProductionBom(f, 0, {}, { allowZero: true });
  expect(preview.issues).toEqual([]);
  expect(preview.materials[0].stock_qty).toBe(0);
});
test.each([0, -1, Infinity, NaN])("invalid base quantity %s cannot produce a valid preview", base_qty => {
  expect(previewProductionBom({ ...formula, base_qty }, 10).issues.length).toBeGreaterThan(0);
});
test("waste is calculated once from the recipe and stock quantities honor unit precision", () => {
  const f = { ...formula, items: [{ ...formula.items[0], qty: 10, waste_percentage: 10 }] };
  expect(previewProductionBom(f, 100).materials[0].stock_qty).toBe(110);
  expect(isValidProductionStockQuantity(1.5, "คู่")).toBe(false);
  expect(isValidProductionStockQuantity(1.125, "กิโล")).toBe(true);
  expect(isValidProductionStockQuantity(1.1254, "กิโล")).toBe(false);
});

test("blank historical main/secondary markers need Admin classification instead of the old imported default", () => {
  const f = { ...formula, items: [{ ...formula.items[0], role_confirmed: false }] };
  expect(previewProductionBom(f, 10).issues.join(" ")).toContain("ตัวหลักหรือตัวรอง");
  expect(previewProductionBom(f, 10, { material_roles: { "1": 1 } }).issues).toEqual([]);
});

test("conversion happens before rounding and tiny count usage cannot disappear", () => {
  const f = { ...formula, base_qty: 3, items: [{ ...formula.items[0], qty: 1, unit: "คู่", stock_unit: "ชิ้น" }] };
  expect(previewProductionBom(f, 1, { material_factors: { "1": 3 } }).materials[0].stock_qty).toBe(1);
  expect(previewProductionBom(f, 1, { material_factors: { "1": 3 } }).issues).toEqual([]);
  expect(previewProductionBom({ ...formula, base_qty: 10000, items: [{ ...formula.items[0], qty: 1 }] }, 1).issues.length).toBeGreaterThan(0);
});
