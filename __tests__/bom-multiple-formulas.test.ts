import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { buildMigrationModel, type Snapshot } from "../scripts/database/migration-model";

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261021000000_bom_multiple_formulas.sql"), "utf8");
let db: PGlite;

function snapshot(duplicateBomId = false): Snapshot {
  const body = {
    sourceId: "test-bom-alternatives",
    capturedAt: "2026-10-21T00:00:00.000Z",
    tabs: [
      { name: "BOM_Headers", formulas: [], values: [
        ["รหัส BOM", "รหัสสินค้า", "บาร์โค้ด", "ชื่อสินค้า", "หน่วย", "จำนวนฐาน", "รูปภาพ", "สถานะ"],
        ["BOM-OS", "AS12", "FG-AS12", "AS12", "ชุด", "1", "", "ACTIVE"],
        [duplicateBomId ? "BOM-OS" : "BOM-JHC", "AS12", "FG-AS12", "AS12", "ชุด", "1", "", "ACTIVE"],
      ] },
      { name: "BOM_Items", formulas: [], values: [
        ["รหัส BOM", "รหัส SKU วัตถุดิบ", "บาร์โค้ดวัตถุดิบ", "ชื่อวัตถุดิบ", "ตัวหลัก/ตัวรอง", "จำนวนที่ต้องใช้", "หน่วย"],
        ["BOM-OS", "RM-OS", "BAR-OS", "OS", "1", "1", "ตัว"],
        ["BOM-JHC", "RM-JHC", "BAR-JHC", "JHC", "1", "2", "ตัว"],
      ] },
    ],
  };
  return { ...body, checksum: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE stockify_app;");
  const directory = path.join(root, "supabase/migrations");
  for (const file of fs.readdirSync(directory).filter(file => file.endsWith(".sql")).sort()) {
    await db.exec(fs.readFileSync(path.join(directory, file), "utf8").replace("create extension if not exists pgcrypto;", ""));
  }
}, 30000);

afterAll(async () => { await db?.close(); });

test("preflight and database preserve two active recipes for one product with separate materials", async () => {
  const model = buildMigrationModel(snapshot());
  expect(model.errors).toEqual([]);
  expect(model.tables.bom_formulas).toHaveLength(2);
  for (const f of model.tables.bom_formulas) {
    await db.query("INSERT INTO bom_formulas(bom_id,fg_sku,fg_barcode,fg_name,fg_unit,base_qty,active) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [f.bom_id, f.fg_sku, f.fg_barcode, f.fg_name, f.fg_unit, f.base_qty, f.active]);
  }
  for (const i of model.tables.bom_formula_items) {
    await db.query("INSERT INTO bom_formula_items(bom_id,rm_sku,rm_name,rm_qty_required,rm_unit) VALUES($1,$2,$3,$4,$5)",
      [i.bom_id, i.rm_sku, i.rm_name, i.rm_qty_required, i.rm_unit]);
  }

  await db.exec(migration);
  const { rows } = await db.query("SELECT f.bom_id,f.fg_sku,f.active,i.rm_sku,i.rm_qty_required FROM bom_formulas f JOIN bom_formula_items i USING(bom_id) WHERE f.fg_sku='AS12' AND f.active ORDER BY f.bom_id");
  expect(rows).toEqual([
    { bom_id: "BOM-JHC", fg_sku: "AS12", active: true, rm_sku: "RM-JHC", rm_qty_required: "2.000" },
    { bom_id: "BOM-OS", fg_sku: "AS12", active: true, rm_sku: "RM-OS", rm_qty_required: "1.000" },
  ]);
  expect((await db.query("SELECT count(*)::integer AS total FROM products")).rows).toEqual([{ total: 0 }]);
  expect((await db.query("SELECT count(*)::integer AS total FROM stock_movements")).rows).toEqual([{ total: 0 }]);
});

test("recipe IDs remain unique and material rows still require an existing recipe", async () => {
  await expect(db.query("INSERT INTO bom_formulas(bom_id,fg_sku,fg_name) VALUES('BOM-OS','OTHER','Other product')"))
    .rejects.toThrow("bom_formulas_pkey");
  await expect(db.query("INSERT INTO bom_formula_items(bom_id,rm_sku,rm_name) VALUES('BOM-UNKNOWN','RM','Material')"))
    .rejects.toThrow("bom_formula_items_bom_id_fkey");
});

test("preflight still archives duplicate recipe identities instead of merging materials", () => {
  const model = buildMigrationModel(snapshot(true));
  expect(model.errors).toEqual([]);
  expect(model.tables.bom_formulas).toHaveLength(1);
  expect(model.warnings.duplicate_bom_headers_archived).toBe(1);
  expect(model.tables.bom_formula_items.map(i => [i.bom_id, i.rm_sku])).toEqual([["BOM-OS", "RM-OS"]]);
  expect(model.warnings.orphan_bom_items_archived).toBe(1);
});
