import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { QueryResultRow } from "pg";
import { query, withDatabaseTransaction } from "@/server/repositories/postgres/database";
import { listProductionBoms, saveProductionBomRoles } from "@/server/production/production-bom.service";
import { createBomFormula, deleteBomFormula, getBomManagementData, updateProductBomFormula } from "@/server/production/bom-management.service";
import { getRepository } from "@/server/repositories";
import { createJobs, submitJobs, startJob, reportProduction, cancelJob, reopenJob, getJobDetail, deleteDraft, updateJob } from "@/server/production/production-job.service";
import { previewMaterialAvailability, listProductionCapacities } from "@/server/production/production-material.service";
import { availableMaterialSources } from "@/server/production/production-material-sources.service";
import { productionBomSelectionSchema } from "@/server/production/production-schemas";
import { issueStock } from "@/server/services/stock/issue-stock";
import { moveStock } from "@/server/services/stock/move-stock";
import { completeTransfer } from "@/server/services/stock/transfer-stock";
import { reverseStock } from "@/server/services/stock/reverse-stock";

let mockDb: PGlite;
let mockTail = Promise.resolve();
jest.setTimeout(30000);
jest.mock("pg", () => {
  const actual = jest.requireActual<typeof import("pg")>("pg");
  const execute = async (sql: string, values?: unknown[]) => {
    const result = await mockDb.query<QueryResultRow>(sql, values);
    return { rows: result.rows.map(row => Object.fromEntries(result.fields.map(field => {
      const v = row[field.name];
      return [field.name, v instanceof Date ? v.toISOString() : typeof v === "string" ? actual.types.getTypeParser(field.dataTypeID)(v) : v];
    }))) };
  };
  return { ...actual, Pool: class {
    query = execute;
    on() { return this; }
    async connect() {
      const previous = mockTail;
      let release!: () => void;
      mockTail = new Promise<void>(r => { release = r; });
      await previous;
      return { query: execute, release };
    }
  } };
});

const oldDriver = process.env.STORAGE_DRIVER, oldUrl = process.env.DATABASE_URL;
const actor = { id: "production-test", name: "Kaew", role: "APPROVER" };
const admin = { ...actor, role: "ADMIN" };
let count = 0;

beforeAll(async () => {
  process.env.STORAGE_DRIVER = "postgres";
  process.env.DATABASE_URL = "postgresql://test:test@localhost/production-material-test";
  mockDb = new PGlite();
  await mockDb.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE stockify_app;");
  const dir = path.join(__dirname, "../supabase/migrations");
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) await mockDb.exec(fs.readFileSync(path.join(dir, f), "utf8").replace("create extension if not exists pgcrypto;", ""));
  await query("INSERT INTO warehouses(warehouse_id,warehouse_code,warehouse_name) VALUES('wh-02','WH02','โกดัง2')");
  await query("INSERT INTO warehouses(warehouse_id,warehouse_code,warehouse_name) VALUES('wh-01','WH01','โกดัง1')");
  await query("INSERT INTO locations(location_id,warehouse_id,location_code) VALUES('raw-A','wh-02','RAW'),('fg-A','wh-02','FG')");
  await query("INSERT INTO locations(location_id,warehouse_id,location_code) VALUES('raw-other','wh-01','RAW-OTHER')");
}, 120000);

afterAll(async () => {
  await mockDb?.close();
  if (oldDriver === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = oldDriver;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
}, 30000);

async function fixture(target = 3) {
  const repo = getRepository(), id = ++count;
  const product = async (sku: string, unit: string) => repo.products.create({ sku, barcode: sku, product_name: sku, base_unit: unit, category: "test", minimum_stock: 0, description: "" });
  const fg = await product(`FG-${id}`, "ชุด"), main = await product(`MAIN-${id}`, "ตัว"), shared = await product(`SHARED-${id}`, "ชิ้น");
  await repo.stockSummary.applyChanges([{ productId: main.product_id, warehouseId: "wh-02", locationId: "raw-A", delta: 30 }, { productId: shared.product_id, warehouseId: "wh-02", locationId: "raw-A", delta: 10 }]);
  await query("UPDATE stock_summary SET opening_quantity=quantity WHERE product_id=ANY($1::text[])", [[main.product_id, shared.product_id]]);
  const bom = `BOM-${id}`;
  await query("INSERT INTO bom_formulas(bom_id,fg_sku,fg_name,fg_unit) VALUES($1,$2,$2,'ชุด')", [bom, fg.sku]);
  const [m] = await query("INSERT INTO bom_formula_items(bom_id,rm_sku,rm_name,rm_qty_required,rm_unit,rm_wh,is_primary) VALUES($1,$2,$2,2,'ตัว','โกดัง2',1) RETURNING bom_item_id", [bom, main.sku]);
  const [s] = await query("INSERT INTO bom_formula_items(bom_id,rm_sku,rm_name,rm_qty_required,rm_unit,rm_wh,is_primary) VALUES($1,$2,$2,1,'ใบ','โกดัง2',0) RETURNING bom_item_id", [bom, shared.sku]);
  const selection = { bom_id: bom, material_factors: { [String(s.bom_item_id)]: 1 } };
  const input = { production_date: "2026-10-21", table_no: 1, product_id: fg.product_id, target_qty: target, priority: "NORMAL" as const, note: "", location: "", bom: selection };
  const [job] = await createJobs(admin, [input]);
  return { repo, job, fg, main, shared, selection, input, mainId: Number(m.bom_item_id), sharedId: Number(s.bom_item_id) };
}

test("pickup planning auto-selects a sole source and requires a valid explicit choice for multiple sources", async () => {
  const f = await fixture();
  expect(f.job.material_plan?.selection.material_locations).toEqual({ [f.mainId]: 'raw-A', [f.sharedId]: 'raw-A' });
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: 'wh-02', locationId: 'fg-A', delta: 30 }]);
  await expect(createJobs(admin, [f.input])).rejects.toThrow('เลือกจุดรับวัตถุดิบ');
  for (const invalid of ['raw-other', 'unknown']) {
    await expect(createJobs(admin, [{ ...f.input, bom: { ...f.selection, material_locations: { [f.mainId]: invalid } } }])).rejects.toThrow('จุดรับไม่มีสต็อกหรือปิดใช้งาน');
  }
  await expect(createJobs(admin, [{ ...f.input, bom: { ...f.selection, material_locations: { '99999999': 'raw-A' } } }])).rejects.toThrow('จุดรับวัตถุดิบไม่ตรงกับสูตร');
  const selection = productionBomSelectionSchema.parse({ ...f.selection, material_locations: { [f.mainId]: 'fg-A' } });
  const [job] = await createJobs(admin, [{ ...f.input, bom: selection }]);
  expect((await getJobDetail(job.job_no))?.job.material_plan?.selection.material_locations).toEqual({ [f.mainId]: 'fg-A', [f.sharedId]: 'raw-A' });
});

test("production pickup reservations protect the chosen shelf while another shelf remains available", async () => {
  const f = await fixture();
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: 'wh-02', locationId: 'raw-A', delta: -24 }, { productId: f.main.product_id, warehouseId: 'wh-02', locationId: 'fg-A', delta: 30 }]);
  await submitJobs(admin, [f.job.job_no]);
  const [same] = await createJobs(admin, [{ ...f.input, bom: { ...f.selection, material_locations: { [f.mainId]: 'raw-A' } } }]);
  await expect(submitJobs(admin, [same.job_no])).rejects.toThrow('จุดรับ RAW พร้อมใช้ 0 ต้องการ 6');
  expect((await getJobDetail(same.job_no))?.job.status).toBe('DRAFT');
  const [other] = await createJobs(admin, [{ ...f.input, bom: { ...f.selection, material_locations: { [f.mainId]: 'fg-A' } } }]);
  await submitJobs(admin, [other.job_no]);
  const sources = await availableMaterialSources(f.repo, [f.main.product_id]);
  expect(sources.find(l => l.location_id === 'raw-A')?.available).toBe(0);
  expect(sources.find(l => l.location_id === 'fg-A')?.available).toBe(24);
  expect((await availableMaterialSources(f.repo, [f.main.product_id], f.job.job_no)).find(l => l.location_id === 'raw-A')?.available).toBe(6);
});

test("good usage and scrap are deducted only from the saved pickup point and replay does not deduct twice", async () => {
  const f = await fixture();
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: 'wh-02', locationId: 'fg-A', delta: 100 }]);
  await submitJobs(admin, [f.job.job_no]);
  await startJob(actor, f.job.job_no);
  const input = { daily_close: true, good_qty: 3, defect_qty: 0, defect_cause: '', note: '', photo_url: '', report_kind: 'FINAL' as const, close_reason: '', receipt_location_id: 'fg-A', idempotency_key: 'saved-pickup-scrap',
    materials: [{ item_id: f.mainId, used_qty: 6, scrap_qty: 1, scrap_cause: 'ชำรุด' }, { item_id: f.sharedId, used_qty: 3, scrap_qty: 0, scrap_cause: '' }] };
  await reportProduction(actor, f.job.job_no, input);
  expect((await reportProduction(actor, f.job.job_no, input)).replayed).toBe(true);
  const stocks = await query('SELECT location_id,quantity FROM stock_summary WHERE product_id=$1 ORDER BY location_id', [f.main.product_id]);
  expect(stocks).toEqual([{ location_id: 'fg-A', quantity: 100 }, { location_id: 'raw-A', quantity: 23 }]);
  expect((await query("SELECT location_id FROM stock_movements WHERE product_id=$1 AND qty_change<0", [f.main.product_id]))).toEqual([{ location_id: 'raw-A' }]);
});

test("a depleted pickup point blocks reporting without falling back to another shelf or leaving partial changes", async () => {
  const f = await fixture();
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: 'wh-02', locationId: 'fg-A', delta: 100 }]);
  await submitJobs(admin, [f.job.job_no]);
  await startJob(actor, f.job.job_no);
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: 'wh-02', locationId: 'raw-A', delta: -25 }]);
  const before = await query('SELECT * FROM stock_summary WHERE product_id=ANY($1::text[]) ORDER BY product_id,location_id', [[f.main.product_id, f.shared.product_id, f.fg.product_id]]);
  await expect(reportProduction(actor, f.job.job_no, { good_qty: 3, defect_qty: 0, defect_cause: '', note: '', photo_url: '', report_kind: 'FINAL', close_reason: '', receipt_location_id: 'fg-A', idempotency_key: 'depleted-pickup',
    materials: [{ item_id: f.mainId, used_qty: 6, scrap_qty: 0, scrap_cause: '' }, { item_id: f.sharedId, used_qty: 3, scrap_qty: 0, scrap_cause: '' }] })).rejects.toThrow('จุดรับ RAW พร้อมใช้ 5 ต้องการ 6');
  expect(await query('SELECT * FROM stock_summary WHERE product_id=ANY($1::text[]) ORDER BY product_id,location_id', [[f.main.product_id, f.shared.product_id, f.fg.product_id]])).toEqual(before);
  expect((await getJobDetail(f.job.job_no))?.reports).toEqual([]);
});

test("legacy jobs without a pickup choice retain warehouse allocation", async () => {
  const f = await fixture();
  await query("UPDATE production_material_plans SET selection=selection-'material_locations' WHERE job_no=$1", [f.job.job_no]);
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: 'wh-02', locationId: 'fg-A', delta: 100 }]);
  await submitJobs(admin, [f.job.job_no]);
  await startJob(actor, f.job.job_no);
  await reportProduction(actor, f.job.job_no, { good_qty: 3, defect_qty: 0, defect_cause: '', note: '', photo_url: '', report_kind: 'FINAL', close_reason: '', receipt_location_id: 'fg-A', idempotency_key: 'legacy-pickup',
    materials: [{ item_id: f.mainId, used_qty: 6, scrap_qty: 0, scrap_cause: '' }, { item_id: f.sharedId, used_qty: 3, scrap_qty: 0, scrap_cause: '' }] });
  expect(Number((await query("SELECT quantity FROM stock_summary WHERE product_id=$1 AND location_id='fg-A'", [f.main.product_id]))[0].quantity)).toBe(94);
});

test("recipe management creates a second formula, protects product ownership and preserves existing production snapshots", async () => {
  const f = await fixture();
  const snapshots = await query("SELECT snapshot,selection FROM production_material_plans WHERE job_no=$1", [f.job.job_no]);
  const stock = await query("SELECT * FROM stock_summary WHERE product_id=ANY($1::text[]) ORDER BY product_id,location_id", [[f.main.product_id, f.shared.product_id]]);
  const bomId = await withDatabaseTransaction(() => createBomFormula(f.fg.product_id, { unit: "ชุด", base_qty: 2,
    items: [{ sku: f.main.sku, qty: 4, unit: "ตัว", waste_percentage: 0, is_primary: 1 }] }));
  let data = await getBomManagementData(f.fg.product_id);
  expect(data.formulas).toHaveLength(2);
  const created = data.formulas.find(formula => formula.bom_id === bomId)!;
  expect(created.edited_at).not.toBeNull();
  expect(created.items[0]).toMatchObject({ sku: f.main.sku, name: f.main.product_name, qty: 4 });
  expect(data.production_formulas.find(formula => formula.bom_id === bomId)?.items[0].role_confirmed).toBe(true);
  expect(data.production_formulas.find(formula => formula.bom_id === bomId)?.edited_at).not.toBeNull();
  const input = { bom_id: bomId, revision: created.revision, unit: "ชุด", base_qty: 2, items: created.items.map(item => ({ ...item, qty: 6 })) };
  await expect(withDatabaseTransaction(() => updateProductBomFormula(f.shared.product_id, input))).rejects.toMatchObject({ statusCode: 404 });
  await withDatabaseTransaction(() => updateProductBomFormula(f.fg.product_id, input));
  await expect(withDatabaseTransaction(() => deleteBomFormula(f.fg.product_id, bomId, created.revision))).rejects.toMatchObject({ statusCode: 409 });
  data = await getBomManagementData(f.fg.product_id);
  const updated = data.formulas.find(formula => formula.bom_id === bomId)!;
  expect(updated.items[0].qty).toBe(6);
  await withDatabaseTransaction(() => deleteBomFormula(f.fg.product_id, bomId, updated.revision));
  expect((await query("SELECT active FROM bom_formulas WHERE bom_id=$1", [bomId]))[0].active).toBe(false);
  expect(await query("SELECT bom_item_id FROM bom_formula_items WHERE bom_id=$1", [bomId])).toHaveLength(1);
  expect((await listProductionBoms(f.fg.product_id)).some(formula => formula.bom_id === bomId)).toBe(false);
  const original = (await getBomManagementData(f.fg.product_id)).formulas[0];
  await withDatabaseTransaction(() => deleteBomFormula(f.fg.product_id, original.bom_id, original.revision));
  expect((await getBomManagementData(f.fg.product_id)).formulas).toEqual([]);
  expect(await query("SELECT snapshot,selection FROM production_material_plans WHERE job_no=$1", [f.job.job_no])).toEqual(snapshots);
  expect(await query("SELECT * FROM stock_summary WHERE product_id=ANY($1::text[]) ORDER BY product_id,location_id", [[f.main.product_id, f.shared.product_id]])).toEqual(stock);
  await submitJobs(admin, [f.job.job_no]);
  expect((await getJobDetail(f.job.job_no))?.job.status).toBe("WAITING");
});

test("management repairs empty recipes and confirms imported material roles without losing notes", async () => {
  const f = await fixture();
  const emptyId = `A-EMPTY-${f.selection.bom_id}`;
  await query("INSERT INTO bom_formulas(bom_id,fg_sku,fg_name) VALUES($1,$2,'Empty recipe')", [emptyId, f.fg.sku]);
  let data = await getBomManagementData(f.fg.product_id);
  const empty = data.formulas.find(formula => formula.bom_id === emptyId)!;
  expect(empty.items).toEqual([]);
  expect(data.production_formulas.find(formula => formula.bom_id === emptyId)?.items).toEqual([]);
  expect(data.production_formulas[0].bom_id).toBe(f.selection.bom_id);
  expect((await listProductionCapacities(f.repo)).find(c => c.product_id === f.fg.product_id)?.bom_id).toBe(f.selection.bom_id);
  await withDatabaseTransaction(() => updateProductBomFormula(f.fg.product_id, { bom_id: emptyId, revision: empty.revision, unit: "ชุด", base_qty: 1,
    items: [{ sku: f.main.sku, qty: 2, unit: "ตัว", waste_percentage: 0, is_primary: 1 }] }));
  await query("UPDATE bom_formula_items SET source_cells=$2::jsonb WHERE bom_item_id=$1", [f.mainId, JSON.stringify([f.selection.bom_id, f.main.sku, "", "old name", "", "2", "ตัว", "keep original note"])]);
  data = await getBomManagementData(f.fg.product_id);
  const original = data.formulas.find(formula => formula.bom_id === f.selection.bom_id)!;
  await withDatabaseTransaction(() => updateProductBomFormula(f.fg.product_id, { bom_id: original.bom_id, revision: original.revision, unit: original.unit, base_qty: original.base_qty, items: original.items }));
  const reopened = (await listProductionBoms(f.fg.product_id)).find(formula => formula.bom_id === original.bom_id)!;
  expect(reopened.items.find(item => item.item_id === f.mainId)?.role_confirmed).toBe(true);
  expect((await query("SELECT source_cells FROM bom_formula_items WHERE bom_item_id=$1", [f.mainId]))[0].source_cells[7]).toBe("keep original note");
  expect((await getBomManagementData(f.fg.product_id)).production_formulas.some(formula => formula.bom_id === emptyId)).toBe(true);
});

test("daily close consumes the recipe for 100 good units plus identified scrap, closes 120 planned units and replays safely", async () => {
  const f = await fixture(120);
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: 'wh-02', locationId: 'raw-A', delta: 300 }, { productId: f.shared.product_id, warehouseId: 'wh-02', locationId: 'raw-A', delta: 200 }]);
  await submitJobs(admin, [f.job.job_no]);
  await startJob(actor, f.job.job_no);
  const input = { daily_close: true, good_qty: 100, defect_qty: 20, defect_cause: 'ประกอบเสีย', note: '', photo_url: '', report_kind: 'FINAL' as const,
    close_reason: 'ปิดยอดประจำวัน ผลิตดี 100 เสีย 20', create_backorder: false, receipt_location_id: 'fg-A', idempotency_key: 'daily-close-120-100-20',
    materials: [{ item_id: f.mainId, used_qty: 200, scrap_qty: 20, scrap_cause: 'ชิ้นส่วนหลักเสีย' }, { item_id: f.sharedId, used_qty: 100, scrap_qty: 5, scrap_cause: 'ชิ้นส่วนรองเสีย' }] };
  const first = await reportProduction(actor, f.job.job_no, input);
  expect(first.job).toMatchObject({ status: 'COMPLETED', produced_good: 100, defect_total: 20 });
  expect((await reportProduction(actor, f.job.job_no, input)).replayed).toBe(true);
  const stock = await query("SELECT product_id,quantity FROM stock_summary WHERE location_id='raw-A' AND product_id=ANY($1::text[])", [[f.main.product_id, f.shared.product_id]]);
  expect(Number(stock.find(s => s.product_id === f.main.product_id)?.quantity)).toBe(110);
  expect(Number(stock.find(s => s.product_id === f.shared.product_id)?.quantity)).toBe(105);
  expect(Number((await query("SELECT quantity FROM stock_summary WHERE product_id=$1 AND location_id='fg-A'", [f.fg.product_id]))[0].quantity)).toBe(100);
  expect(await query('SELECT job_no FROM production_material_reservations WHERE job_no=$1', [f.job.job_no])).toEqual([]);
  expect(await query('SELECT job_no FROM production_material_plans WHERE parent_job_no=$1', [f.job.job_no])).toEqual([]);
  const detail = await getJobDetail(f.job.job_no);
  expect(detail?.reports).toHaveLength(1);
  expect(detail?.reports[0].material_details).toEqual(expect.arrayContaining([expect.objectContaining({ sku: f.main.sku, used_qty: 200, scrap_qty: 20 }), expect.objectContaining({ sku: f.shared.sku, used_qty: 100, scrap_qty: 5 })]));
});

test('daily close rejects missing scrap, overridden good usage, partial reports and automatic carry-over without changing stock', async () => {
  const f = await fixture();
  await submitJobs(admin, [f.job.job_no]);
  await startJob(actor, f.job.job_no);
  const input = { daily_close: true, good_qty: 2, defect_qty: 1, defect_cause: 'ประกอบเสีย', note: '', photo_url: '', report_kind: 'FINAL' as const,
    close_reason: 'ปิดยอดวันนี้', create_backorder: false, receipt_location_id: 'fg-A',
    materials: [{ item_id: f.mainId, used_qty: 4, scrap_qty: 1, scrap_cause: 'เสีย' }, { item_id: f.sharedId, used_qty: 2, scrap_qty: 0, scrap_cause: '' }] };
  const before = await query('SELECT * FROM stock_summary ORDER BY product_id,location_id');
  const invalid = [
    { ...input, report_kind: 'PARTIAL' as const }, { ...input, create_backorder: true }, { ...input, defect_cause: '' },
    { ...input, materials: input.materials.map(i => ({ ...i, scrap_qty: 0 })) },
    { ...input, material_reason: 'cannot override daily good usage', materials: input.materials.map(i => ({ ...i, used_qty: i.used_qty + 1 })) },
  ];
  for (const [index, data] of invalid.entries()) await expect(reportProduction(actor, f.job.job_no, { ...data, idempotency_key: `invalid-daily-close-${index}` })).rejects.toThrow();
  expect(await query('SELECT * FROM stock_summary ORDER BY product_id,location_id')).toEqual(before);
  expect((await getJobDetail(f.job.job_no))?.job.status).toBe('IN_PROGRESS');
  expect((await getJobDetail(f.job.job_no))?.reports).toEqual([]);
});

test("invalid recipe creation rolls back its header and does not leave an orphan formula", async () => {
  const f = await fixture();
  const before = await query("SELECT bom_id FROM bom_formulas WHERE fg_sku=$1 ORDER BY bom_id", [f.fg.sku]);
  await expect(withDatabaseTransaction(() => createBomFormula(f.fg.product_id, { unit: "ชุด", base_qty: 1,
    items: [{ sku: "MISSING-MANAGED-MATERIAL", qty: 1, unit: "ตัว", waste_percentage: 0, is_primary: 1 }] }))).rejects.toThrow("ไม่พบรหัสวัตถุดิบ");
  await expect(withDatabaseTransaction(() => createBomFormula(f.fg.product_id, { unit: "ชุด", base_qty: 1,
    items: [{ sku: f.main.sku, qty: 1, unit: "ตัว", waste_percentage: 0, is_primary: 0 }] }))).rejects.toThrow("วัตถุดิบหลัก");
  expect(await query("SELECT bom_id FROM bom_formulas WHERE fg_sku=$1 ORDER BY bom_id", [f.fg.sku])).toEqual(before);
});

test("incomplete imported recipes stay visible with every material but cannot create production plans", async () => {
  const f = await fixture();
  await query("INSERT INTO bom_formula_items(bom_id,rm_sku,rm_name,rm_qty_required,rm_unit,is_primary) VALUES($1,'MISSING-IMPORTED','Original imported material',1,'ชิ้น',0)", [f.selection.bom_id]);
  const formula = (await listProductionBoms(f.fg.product_id))[0];
  expect(formula.items).toHaveLength(3);
  expect(formula.items.find(i => i.sku === 'MISSING-IMPORTED')).toMatchObject({ product_id: '', name: 'Original imported material' });
  const capacity = (await listProductionCapacities(f.repo)).find(c => c.product_id === f.fg.product_id)!;
  expect(capacity).toMatchObject({ quantity: null, issue: 'มีสูตร · วัตถุดิบยังจับคู่ไม่ครบ' });
  const before = await query("SELECT job_no FROM production_jobs ORDER BY job_no");
  await expect(createJobs(admin, [f.input])).rejects.toThrow('ยังจับคู่ทะเบียนวัตถุดิบ');
  expect(await query("SELECT job_no FROM production_jobs ORDER BY job_no")).toEqual(before);
});

test("an empty imported recipe is listed and identified without allowing a production job", async () => {
  const f = await fixture();
  await query("DELETE FROM bom_formula_items WHERE bom_id=$1", [f.selection.bom_id]);
  expect((await listProductionBoms(f.fg.product_id))[0]).toMatchObject({ bom_id: f.selection.bom_id, items: [] });
  expect((await listProductionCapacities(f.repo)).find(c => c.product_id === f.fg.product_id)).toMatchObject({ quantity: null, issue: 'มีสูตร · ยังไม่มีวัตถุดิบ' });
  await expect(createJobs(admin, [f.input])).rejects.toThrow('ยังไม่มีรายการวัตถุดิบ');
});

test("saving selected material roles persists to the formula, preserves source data and existing job snapshots", async () => {
  const f = await fixture();
  const cells = [f.selection.bom_id, f.shared.sku, "barcode", "name", "", 1, "ใบ", "keep note"];
  await query("UPDATE bom_formula_items SET source_cells=$2::jsonb,is_primary=1 WHERE bom_item_id=$1", [f.sharedId, JSON.stringify(cells)]);
  const before = (await listProductionBoms(f.fg.product_id))[0];
  const snapshot = await query("SELECT snapshot FROM production_material_plans WHERE job_no=$1", [f.job.job_no]);
  expect(before.items.find(i => i.item_id === f.sharedId)?.role_confirmed).toBe(false);
  const input = { product_id: f.fg.product_id, bom_id: before.bom_id, revision: before.revision!, material_roles: { [f.sharedId]: 0 as const } };
  const saved = await withDatabaseTransaction(() => saveProductionBomRoles(input));
  expect((await query("SELECT edited_at FROM bom_formulas WHERE bom_id=$1", [input.bom_id]))[0].edited_at).not.toBeNull();
  expect(saved.revision).not.toBe(before.revision);
  const reopened = (await listProductionBoms(f.fg.product_id))[0];
  expect(reopened).toEqual(saved);
  expect(reopened.items.find(i => i.item_id === f.sharedId)).toMatchObject({ is_primary: 0, role_confirmed: true });
  const [row] = await query("SELECT source_cells,rm_qty_required,rm_unit FROM bom_formula_items WHERE bom_item_id=$1", [f.sharedId]);
  expect(row.source_cells).toEqual(cells.map((cell, index) => index === 4 ? "ตัวรอง" : cell));
  expect(Number(row.rm_qty_required)).toBe(1);
  expect(row.rm_unit).toBe("ใบ");
  expect(await query("SELECT snapshot FROM production_material_plans WHERE job_no=$1", [f.job.job_no])).toEqual(snapshot);
  await expect(withDatabaseTransaction(() => saveProductionBomRoles(input))).rejects.toMatchObject({ statusCode: 409 });
  const [newJob] = await createJobs(admin, [{ ...f.input, bom: { ...f.selection, revision: saved.revision } }]);
  expect(newJob.material_plan?.snapshot.items.find(i => i.item_id === f.sharedId)).toMatchObject({ is_primary: 0, role_confirmed: true });
});

test("role saving rejects foreign materials and a formula with only secondary materials without partial writes", async () => {
  const f = await fixture();
  await query("UPDATE bom_formula_items SET source_cells='[\"legacy\",\"\",\"\",\"\",\"\"]'::jsonb WHERE bom_id=$1", [f.selection.bom_id]);
  const formula = (await listProductionBoms(f.fg.product_id))[0];
  const before = await query("SELECT * FROM bom_formula_items WHERE bom_id=$1 ORDER BY bom_item_id", [formula.bom_id]);
  const input = { product_id: f.fg.product_id, bom_id: formula.bom_id, revision: formula.revision! };
  await expect(withDatabaseTransaction(() => saveProductionBomRoles({ ...input, material_roles: { [f.mainId]: 1, "999999": 0 } }))).rejects.toThrow("ในสูตรนี้");
  await expect(withDatabaseTransaction(() => saveProductionBomRoles({ ...input, material_roles: { [f.mainId]: 0, [f.sharedId]: 0 } }))).rejects.toThrow("อย่างน้อยหนึ่งรายการ");
  expect(await query("SELECT * FROM bom_formula_items WHERE bom_id=$1 ORDER BY bom_item_id", [formula.bom_id])).toEqual(before);
  const partial = await withDatabaseTransaction(() => saveProductionBomRoles({ ...input, material_roles: { [f.mainId]: 1 } }));
  expect(partial.items.find(i => i.item_id === f.mainId)).toMatchObject({ is_primary: 1, role_confirmed: true });
  expect(partial.items.find(i => i.item_id === f.sharedId)?.role_confirmed).toBe(false);
});

test("material locations show current positive active warehouse 2 stock without changing the frozen BOM", async () => {
  const f = await fixture();
  const inactive = `inactive-${f.mainId}`;
  await query("INSERT INTO locations(location_id,warehouse_id,location_code,active) VALUES($1,'wh-02',$1,false)", [inactive]);
  await f.repo.stockSummary.applyChanges([
    { productId: f.main.product_id, warehouseId: "wh-02", locationId: "fg-A", delta: 7 },
    { productId: f.main.product_id, warehouseId: "wh-01", locationId: "raw-other", delta: 1000 },
    { productId: f.main.product_id, warehouseId: "wh-02", locationId: inactive, delta: 9 },
    { productId: f.shared.product_id, warehouseId: "wh-02", locationId: "fg-A", delta: 0 },
  ]);
  const original = await query("SELECT snapshot FROM production_material_plans WHERE job_no=$1", [f.job.job_no]);
  let plan = (await getJobDetail(f.job.job_no))!.job.material_plan!;
  expect(plan.stock_locations?.filter(l => l.product_id === f.main.product_id)).toEqual([
    { product_id: f.main.product_id, location_id: "fg-A", location_code: "FG", location_name: "", quantity: 7 },
    { product_id: f.main.product_id, location_id: "raw-A", location_code: "RAW", location_name: "", quantity: 30 },
  ]);
  expect(plan.stock_locations?.filter(l => l.product_id === f.shared.product_id)).toHaveLength(1);
  expect(plan.stock_locations?.some(l => l.location_id === inactive || l.location_id === "raw-other")).toBe(false);
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: "wh-02", locationId: "fg-A", delta: -7 }]);
  plan = (await getJobDetail(f.job.job_no))!.job.material_plan!;
  expect(plan.stock_locations?.filter(l => l.product_id === f.main.product_id).map(l => l.location_code)).toEqual(["RAW"]);
  expect(await query("SELECT snapshot FROM production_material_plans WHERE job_no=$1", [f.job.job_no])).toEqual(original);
});

test("ordinary issues cannot spend production reservations, but free stock and the owning production job can", async () => {
  const f = await fixture(3);
  await submitJobs(admin, [f.job.job_no]);
  const stock = await query("SELECT * FROM stock_summary WHERE product_id=$1", [f.main.product_id]);
  const movements = await query("SELECT * FROM stock_movements WHERE product_id=$1", [f.main.product_id]);
  const input = { warehouse_id: "wh-2", document_date: "2026-10-21", reference_no: "reservation-test", note: "", user_id: admin.id, role: "ADMIN", lines: [{ product_id: f.main.sku, location_id: "RAW", qty: 25 }], idempotency_key: "reserved-issue-blocked" };
  await expect(issueStock({ repo: f.repo }, input)).rejects.toThrow("จองให้งานผลิต");
  expect(await query("SELECT * FROM stock_summary WHERE product_id=$1", [f.main.product_id])).toEqual(stock);
  expect(await query("SELECT * FROM stock_movements WHERE product_id=$1", [f.main.product_id])).toEqual(movements);
  expect(await query("SELECT * FROM documents WHERE reference_no='reservation-test'")).toEqual([]);
  await issueStock({ repo: f.repo }, { ...input, idempotency_key: "reserved-issue-free", lines: [{ ...input.lines[0], qty: 24 }] });
  expect(await f.repo.movements.getBalance(f.main.product_id, "wh-02", "raw-A")).toBe(6);
  await startJob(actor, f.job.job_no);
  await reportProduction(actor, f.job.job_no, { good_qty: 3, defect_qty: 0, defect_cause: "", note: "", photo_url: "", report_kind: "FINAL", close_reason: "", idempotency_key: "reserved-owner-report", receipt_location_id: "fg-A", materials: [{ item_id: f.mainId, used_qty: 6, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 3, scrap_qty: 0, scrap_cause: "" }] });
  expect(await f.repo.movements.getBalance(f.main.product_id, "wh-02", "raw-A")).toBe(0);
  expect(await f.repo.movements.getBalance(f.fg.product_id, "wh-02", "fg-A")).toBe(3);
});

test("reserved material can move between active locations and reservations do not block a different warehouse", async () => {
  const f = await fixture(3);
  await submitJobs(admin, [f.job.job_no]);
  const reserved = await query("SELECT * FROM production_material_reservations WHERE job_no=$1", [f.job.job_no]);
  await moveStock({ repo: f.repo }, { warehouse_id: "wh-02", product_id: f.main.product_id, from_location_id: "raw-A", to_location_id: "fg-A", qty: 30, reference_no: "", document_date: "2026-10-21", note: "", idempotency_key: "reserved-same-warehouse", user_id: admin.id, role: "ADMIN" });
  expect(await f.repo.movements.getBalance(f.main.product_id, "wh-02", "fg-A")).toBe(30);
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: "wh-01", locationId: "raw-other", delta: 20 }]);
  await issueStock({ repo: f.repo }, { warehouse_id: "wh-01", document_date: "2026-10-21", reference_no: "", note: "", user_id: admin.id, role: "ADMIN", idempotency_key: "reserved-other-warehouse", lines: [{ product_id: f.main.product_id, location_id: "raw-other", qty: 20 }] });
  expect(await f.repo.movements.getBalance(f.main.product_id, "wh-01", "raw-other")).toBe(0);
  expect(await query("SELECT * FROM production_material_reservations WHERE job_no=$1", [f.job.job_no])).toEqual(reserved);
});

test("cross-warehouse transfer approval cannot take production-reserved stock and rolls back both warehouses", async () => {
  const f = await fixture(3);
  await submitJobs(admin, [f.job.job_no]);
  const doc = await f.repo.documents.create({ document_type: "TRANSFER", status: "WAITING_APPROVAL", document_date: "2026-10-21", reference_no: "", created_by: admin.id, note: JSON.stringify({ from_warehouse_id: "wh-02", to_warehouse_id: "wh-01", from_location_id: "raw-A", to_location_id: "raw-other", product_id: f.main.product_id, qty: 25, idempotency_key: "reserved-transfer" }) });
  const before = await query("SELECT * FROM stock_summary WHERE product_id=$1 ORDER BY warehouse_id,location_id", [f.main.product_id]);
  await expect(completeTransfer({ repo: f.repo }, doc.document_id, "raw-other", "raw-A", admin.id, "ADMIN")).rejects.toThrow("จองให้งานผลิต");
  expect(await query("SELECT * FROM stock_summary WHERE product_id=$1 ORDER BY warehouse_id,location_id", [f.main.product_id])).toEqual(before);
  expect(await f.repo.movements.findByDocumentId(doc.document_id)).toEqual([]);
  expect((await f.repo.documents.findById(doc.document_id))?.status).toBe("WAITING_APPROVAL");
});

test("reversing a normal receipt cannot remove stock reserved for production", async () => {
  const f = await fixture(3);
  await query("UPDATE stock_summary SET quantity=5,opening_quantity=5 WHERE product_id=$1", [f.main.product_id]);
  const doc = await f.repo.documents.create({ document_type: "RECEIVE", status: "POSTED", document_date: "2026-10-21", reference_no: "", created_by: admin.id, note: "normal receipt" });
  await f.repo.movements.batchCreate([{ document_id: doc.document_id, product_id: f.main.product_id, warehouse_id: "wh-02", location_id: "raw-A", qty_change: 25, movement_type: "RECEIVE", idempotency_key: "reserved-original-receipt", created_by: admin.id }]);
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: "wh-02", locationId: "raw-A", delta: 25 }]);
  await submitJobs(admin, [f.job.job_no]);
  await expect(reverseStock({ repo: f.repo }, { original_document_id: doc.document_id, note: "", idempotency_key: "reserved-reversal-blocked", user_id: admin.id, role: "ADMIN" })).rejects.toThrow("จองให้งานผลิต");
  expect(await f.repo.movements.getBalance(f.main.product_id, "wh-02", "raw-A")).toBe(30);
  expect(await query("SELECT * FROM documents WHERE document_type='REVERSAL' AND reference_no=$1", [doc.document_no])).toEqual([]);
  await cancelJob(admin, f.job.job_no, "ยกเลิกก่อนกลับรายการ");
  await reverseStock({ repo: f.repo }, { original_document_id: doc.document_id, note: "", idempotency_key: "reserved-reversal-after-cancel", user_id: admin.id, role: "ADMIN" });
  expect(await f.repo.movements.getBalance(f.main.product_id, "wh-02", "raw-A")).toBe(5);
});

test("production result documents reject generic reversal without changing stock, reports or status", async () => {
  const f = await fixture(1);
  await submitJobs(admin, [f.job.job_no]); await startJob(actor, f.job.job_no);
  await reportProduction(actor, f.job.job_no, { good_qty: 1, defect_qty: 0, defect_cause: "", note: "", photo_url: "", report_kind: "FINAL", close_reason: "", idempotency_key: "production-no-generic-reversal", receipt_location_id: "fg-A", materials: [{ item_id: f.mainId, used_qty: 2, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 1, scrap_qty: 0, scrap_cause: "" }] });
  const [doc] = await query("SELECT document_id FROM documents WHERE reference_no=$1 AND document_type='RECEIVE'", [f.job.job_no]);
  const before = await query("SELECT * FROM stock_summary ORDER BY product_id,location_id");
  const detail = await getJobDetail(f.job.job_no);
  await expect(reverseStock({ repo: f.repo }, { original_document_id: doc.document_id, user_id: admin.id, role: "ADMIN", note: "", idempotency_key: "generic-production-reversal" })).rejects.toThrow("เอกสารผลิต");
  expect(await query("SELECT * FROM stock_summary ORDER BY product_id,location_id")).toEqual(before);
  expect(await getJobDetail(f.job.job_no)).toEqual(detail);
});

test("note-only edits work during material shortages while changed targets still revalidate reservations", async () => {
  const f = await fixture(10);
  await submitJobs(admin, [f.job.job_no]); await startJob(actor, f.job.job_no);
  await reportProduction(actor, f.job.job_no, { good_qty: 1, defect_qty: 1, defect_cause: "ประกอบเสีย", note: "", photo_url: "", report_kind: "PARTIAL", close_reason: "", idempotency_key: "note-shortage-partial", receipt_location_id: "fg-A", materials: [{ item_id: f.mainId, used_qty: 2, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 1, scrap_qty: 0, scrap_cause: "" }] });
  const job = (await getJobDetail(f.job.job_no))!.job;
  const reserved = await query("SELECT * FROM production_material_reservations WHERE job_no=$1 ORDER BY product_id", [job.job_no]);
  const edited = await updateJob(admin, job.job_no, { updated_at: job.updated_at, note: "รอวัตถุดิบ", reason: "แก้หมายเหตุเท่านั้น" });
  expect(edited.note).toBe("รอวัตถุดิบ");
  expect(await query("SELECT * FROM production_material_reservations WHERE job_no=$1 ORDER BY product_id", [job.job_no])).toEqual(reserved);
  await expect(updateJob(admin, job.job_no, { updated_at: edited.updated_at, target_qty: 11, reason: "เพิ่มเป้า" })).rejects.toThrow("ยังขาด");
  expect((await getJobDetail(job.job_no))?.job.target_qty).toBe(10);
  await updateJob(admin, job.job_no, { updated_at: edited.updated_at, target_qty: 8, reason: "ลดเป้าให้พอกับของ" });
  expect(await query("SELECT quantity FROM production_material_reservations WHERE job_no=$1 AND product_id=$2", [job.job_no, f.shared.product_id])).toEqual([{ quantity: 7 }]);
});

test("deleted highest job number is never reused, even when no visible jobs remain that day", async () => {
  const f = await fixture();
  const input = { ...f.input, production_date: "2026-11-01" };
  const [removed] = await createJobs(admin, [input]);
  await deleteDraft(admin, removed.job_no);
  expect(await getJobDetail(removed.job_no)).toBeNull();
  const [next] = await createJobs(admin, [input]);
  expect(next.job_no).toBe("PRD-20261101-000002");
  expect(await query("SELECT count(*)::integer AS n FROM production_jobs WHERE job_no=$1 AND deleted_at IS NOT NULL", [removed.job_no])).toEqual([{ n: 1 }]);
});

test("all five tables create distinct numbers concurrently and complete independently with exact stock", async () => {
  const f = await fixture(1);
  const others = await Promise.all([2,3,4,5].map(table_no => createJobs(admin, [{ ...f.input, table_no }])));
  const jobs = [f.job, ...others.flat()];
  expect(new Set(jobs.map(j => j.job_no)).size).toBe(5);
  await submitJobs(admin, jobs.map(j => j.job_no));
  for (const job of jobs) {
    await startJob(actor, job.job_no);
    const input = { good_qty: 1, defect_qty: 0, defect_cause: "", note: "", photo_url: "", report_kind: "FINAL" as const, close_reason: "", idempotency_key: `five-tables-${job.job_no}`, receipt_location_id: "fg-A",
      materials: [{ item_id: f.mainId, used_qty: 2, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 1, scrap_qty: 0, scrap_cause: "" }] };
    await reportProduction(actor, job.job_no, input);
    expect((await reportProduction(actor, job.job_no, input)).replayed).toBe(true);
    expect((await getJobDetail(job.job_no))?.job.status).toBe("COMPLETED");
  }
  expect(await query("SELECT quantity FROM stock_summary WHERE product_id=$1 AND location_id='fg-A'", [f.fg.product_id])).toEqual([{ quantity: 5 }]);
  expect(await query("SELECT quantity FROM stock_summary WHERE product_id=$1 AND location_id='raw-A'", [f.main.product_id])).toEqual([{ quantity: 20 }]);
  expect(await query("SELECT quantity FROM stock_summary WHERE product_id=$1 AND location_id='raw-A'", [f.shared.product_id])).toEqual([{ quantity: 5 }]);
  expect(await query("SELECT * FROM production_material_reservations WHERE job_no=ANY($1::text[])", [jobs.map(j => j.job_no)])).toEqual([]);
});

test("failed delete history leaves the draft intact", async () => {
  const f = await fixture();
  await mockDb.exec(`CREATE FUNCTION fail_delete_history() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='DELETE' THEN RAISE EXCEPTION 'history unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_delete_history BEFORE INSERT ON production_history FOR EACH ROW EXECUTE FUNCTION fail_delete_history();`);
  try {
    await expect(deleteDraft(admin, f.job.job_no)).rejects.toThrow();
  } finally { await mockDb.exec("DROP TRIGGER fail_delete_history ON production_history; DROP FUNCTION fail_delete_history();"); }
  expect((await getJobDetail(f.job.job_no))?.job.status).toBe("DRAFT");
});

test("capacity, reservations and actual use stay in warehouse 2 even if the BOM and old snapshot name another warehouse", async () => {
  const f = await fixture();
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: "wh-01", locationId: "raw-other", delta: 1000 }]);
  await query("UPDATE stock_summary SET opening_quantity=quantity WHERE product_id=$1", [f.main.product_id]);
  await query("UPDATE bom_formula_items SET rm_wh='โกดัง1' WHERE bom_id=$1", [f.selection.bom_id]);
  await query(`UPDATE production_material_plans SET snapshot=jsonb_set(snapshot,'{items}',
    (SELECT jsonb_agg(item || '{"warehouse_id":"wh-01"}'::jsonb) FROM jsonb_array_elements(snapshot->'items') item)) WHERE job_no=$1`, [f.job.job_no]);
  const preview = await previewMaterialAvailability(f.repo, f.fg.product_id, 3, f.selection);
  expect(preview.main_capacity).toBe(15);
  expect(preview.materials.find(i => i.item_id === f.mainId)?.on_hand).toBe(30);
  expect(preview.materials.every(i => i.warehouse_id === "wh-02")).toBe(true);
  expect((await getJobDetail(f.job.job_no))!.job.material_plan!.snapshot.items.every(i => i.warehouse_id === "wh-02")).toBe(true);
  await submitJobs(admin, [f.job.job_no]);
  expect(await query("SELECT DISTINCT warehouse_id FROM production_material_reservations WHERE job_no=$1", [f.job.job_no])).toEqual([{ warehouse_id: "wh-02" }]);
  await startJob(actor, f.job.job_no);
  await reportProduction(actor, f.job.job_no, { good_qty: 1, defect_qty: 0, defect_cause: "", note: "", photo_url: "", report_kind: "PARTIAL", close_reason: "", idempotency_key: "warehouse-2-only", receipt_location_id: "fg-A",
    materials: [{ item_id: f.mainId, used_qty: 2, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 1, scrap_qty: 0, scrap_cause: "" }] });
  expect(await query("SELECT warehouse_id,quantity FROM stock_summary WHERE product_id=$1 ORDER BY warehouse_id", [f.main.product_id])).toEqual([{ warehouse_id: "wh-01", quantity: 1000 }, { warehouse_id: "wh-02", quantity: 28 }]);
});

test("stock in another warehouse cannot cover a warehouse 2 shortage", async () => {
  const f = await fixture();
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: "wh-02", locationId: "raw-A", delta: -30 }, { productId: f.main.product_id, warehouseId: "wh-01", locationId: "raw-other", delta: 1000 }]);
  await query("UPDATE bom_formula_items SET rm_wh='โกดัง1' WHERE bom_id=$1", [f.selection.bom_id]);
  const preview = await previewMaterialAvailability(f.repo, f.fg.product_id, 3, f.selection);
  expect(preview.main_capacity).toBe(0);
  expect(preview.materials.find(i => i.item_id === f.mainId)?.shortage).toBe(6);
  await expect(submitJobs(admin, [f.job.job_no])).rejects.toThrow("ยังขาด");
});

test("bulk search capacity matches the default recipe, deducts reservations and excludes the edited job", async () => {
  const f = await fixture();
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: "wh-01", locationId: "raw-other", delta: 1000 }]);
  const alt = `${f.selection.bom_id}-ALT`;
  await query("INSERT INTO bom_formulas(bom_id,fg_sku,fg_name,fg_unit) VALUES($1,$2,$2,'ชุด')", [alt, f.fg.sku]);
  await query("INSERT INTO bom_formula_items(bom_id,rm_sku,rm_name,rm_qty_required,rm_unit,rm_wh,is_primary) VALUES($1,$2,$2,1,'ตัว','โกดัง2',1)", [alt, f.main.sku]);
  let capacities = await listProductionCapacities(f.repo);
  expect(capacities.filter(c => c.product_id === f.fg.product_id)).toEqual([{ product_id: f.fg.product_id, bom_id: f.selection.bom_id, quantity: 15, unit: "ชุด" }]);
  await submitJobs(admin, [f.job.job_no]);
  capacities = await listProductionCapacities(f.repo);
  expect(capacities.find(c => c.product_id === f.fg.product_id)?.quantity).toBe(12);
  expect((await listProductionCapacities(f.repo, f.job.job_no)).find(c => c.product_id === f.fg.product_id)?.quantity).toBe(15);
});

test("legacy draft without a BOM identifies the blocked job and remains a draft", async () => {
  const f = await fixture();
  await query("DELETE FROM production_material_plans WHERE job_no=$1", [f.job.job_no]);
  await expect(submitJobs(admin, [f.job.job_no])).rejects.toThrow(`${f.job.job_no}: กรุณาเปิดแก้ไขงาน`);
  expect((await getJobDetail(f.job.job_no))?.job.status).toBe("DRAFT");
  expect(await query("SELECT * FROM production_material_reservations WHERE job_no=$1", [f.job.job_no])).toEqual([]);
});

test("capacity follows primary stock, while shared secondary material is reserved across tables and cancellation releases it", async () => {
  const f = await fixture();
  const preview = await previewMaterialAvailability(f.repo, f.fg.product_id, 3, f.selection);
  expect(preview.main_capacity).toBe(15); // shared stock supports only 10, but is not the primary capacity.
  await submitJobs(admin, [f.job.job_no]);
  const [second] = await createJobs(admin, [{ ...f.input, table_no: 2, target_qty: 8 }]);
  await expect(submitJobs(admin, [second.job_no])).rejects.toThrow("ยังขาด");
  expect((await getJobDetail(second.job_no))?.job.status).toBe("DRAFT");
  expect(await query("SELECT sum(quantity) AS quantity FROM production_material_reservations WHERE job_no=$1", [second.job_no])).toEqual([{ quantity: null }]);
  await cancelJob(admin, f.job.job_no, "เปลี่ยนแผน");
  await submitJobs(admin, [second.job_no]);
  expect((await getJobDetail(second.job_no))?.job.status).toBe("WAITING");
});

test("concurrent tables cannot both reserve the same shared stock", async () => {
  const f = await fixture(6);
  const [other] = await createJobs(admin, [{ ...f.input, table_no: 5 }]);
  const results = await Promise.allSettled([submitJobs(admin, [f.job.job_no]), submitJobs(admin, [other.job_no])]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  expect(await query("SELECT sum(quantity) AS quantity FROM production_material_reservations WHERE product_id=$1", [f.shared.product_id])).toEqual([{ quantity: 6 }]);
});

test("capacity sums repeated primary material rows sharing the same stock", async () => {
  const f = await fixture();
  await query("INSERT INTO bom_formula_items(bom_id,rm_sku,rm_name,rm_qty_required,rm_unit,rm_wh,is_primary) VALUES($1,$2,$2,1,'ตัว','โกดัง2',1)", [f.selection.bom_id, f.main.sku]);
  const preview = await previewMaterialAvailability(f.repo, f.fg.product_id, 3, f.selection);
  expect(preview.main_capacity).toBe(10); // 30 main pieces / (2 + 1) pieces per finished unit.
});

test("no primary stock shows zero capacity and blocks dispatch even when secondary stock exists", async () => {
  const f = await fixture();
  await f.repo.stockSummary.applyChanges([{ productId: f.main.product_id, warehouseId: "wh-02", locationId: "raw-A", delta: -30 }]);
  const preview = await previewMaterialAvailability(f.repo, f.fg.product_id, 3, f.selection);
  expect(preview.main_capacity).toBe(0);
  expect(preview.materials.find(i => i.item_id === f.sharedId)?.available).toBe(10);
  await expect(submitJobs(admin, [f.job.job_no])).rejects.toThrow("ยังขาด");
});

test("frozen recipe, actual component scrap, partial receipts and final backorder all post once", async () => {
  const f = await fixture(4);
  await submitJobs(admin, [f.job.job_no]);
  await startJob(actor, f.job.job_no);
  await query("UPDATE bom_formula_items SET rm_qty_required=99 WHERE bom_item_id=$1", [f.mainId]);
  const partial = { good_qty: 1, defect_qty: 1, defect_cause: "ประกอบแล้วเสีย", note: "", photo_url: "", report_kind: "PARTIAL" as const, close_reason: "", idempotency_key: "material-partial", receipt_location_id: "fg-A",
    materials: [{ item_id: f.mainId, used_qty: 2, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 1, scrap_qty: 1, scrap_cause: "แผงขาดก่อนประกอบ" }] };
  await reportProduction(actor, f.job.job_no, partial);
  await reportProduction(actor, f.job.job_no, partial);
  expect(await f.repo.movements.getBalance(f.fg.product_id, "wh-02", "fg-A")).toBe(1);
  expect(await f.repo.movements.getBalance(f.main.product_id, "wh-02", "raw-A")).toBe(28);
  expect(await f.repo.movements.getBalance(f.shared.product_id, "wh-02", "raw-A")).toBe(8);
  await expect(reportProduction(actor, f.job.job_no, { ...partial, good_qty: 2 })).rejects.toThrow("รหัสยืนยัน");
  const final = { ...partial, good_qty: 1, defect_qty: 0, defect_cause: "", report_kind: "FINAL" as const, close_reason: "ทำส่วนที่เหลือต่อ", create_backorder: true, idempotency_key: "material-final",
    materials: [{ item_id: f.mainId, used_qty: 2, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 1, scrap_qty: 0, scrap_cause: "" }] };
  await reportProduction(actor, f.job.job_no, final);
  expect((await reportProduction(actor, f.job.job_no, final)).replayed).toBe(true);
  const parent = (await getJobDetail(f.job.job_no))!.job;
  const child = (await getJobDetail(parent.material_plan!.backorder_job_no!))!.job;
  expect(child.target_qty).toBe(2);
  expect(child.status).toBe("DRAFT");
  expect(child.material_plan!.snapshot.items.find(i => i.item_id === f.mainId)?.qty).toBe(2);
  expect(await query("SELECT count(*)::integer AS n FROM production_material_reservations WHERE job_no=$1", [f.job.job_no])).toEqual([{ n: 0 }]);
  expect(await f.repo.movements.getBalance(f.fg.product_id, "wh-02", "fg-A")).toBe(2);
  await expect(reopenJob(admin, f.job.job_no, "retry")).rejects.toThrow("ใบงานค้าง");
});

test("a multi-job dispatch rolls back all jobs when a later job lacks materials", async () => {
  const f = await fixture(1);
  const [other] = await createJobs(admin, [{ ...f.input, target_qty: 20, table_no: 2 }]);
  await expect(submitJobs(admin, [f.job.job_no, other.job_no])).rejects.toThrow("ยังขาด");
  for (const job of [f.job, other]) expect((await getJobDetail(job.job_no))?.job.status).toBe("DRAFT");
  expect(await query("SELECT * FROM production_material_reservations WHERE job_no=ANY($1::text[])", [[f.job.job_no, other.job_no]])).toEqual([]);
});

test("invalid location, duplicate components, negative amounts, scrap cause and unexplained deviations cannot change stock", async () => {
  const f = await fixture();
  await submitJobs(admin, [f.job.job_no]); await startJob(actor, f.job.job_no);
  const good = { item_id: f.mainId, used_qty: 2, scrap_qty: 0, scrap_cause: "" };
  const shared = { item_id: f.sharedId, used_qty: 1, scrap_qty: 0, scrap_cause: "" };
  const input = { good_qty: 1, defect_qty: 0, defect_cause: "", note: "", photo_url: "", report_kind: "PARTIAL" as const, close_reason: "", receipt_location_id: "fg-A", materials: [good, shared] };
  const invalid = [
    { ...input, receipt_location_id: "raw-other" },
    { ...input, materials: [good, good] },
    { ...input, materials: [{ ...good, used_qty: -1 }, shared] },
    { ...input, materials: [{ ...good, scrap_qty: 1 }, shared] },
    { ...input, materials: [{ ...good, used_qty: 3 }, shared] },
  ];
  const before = await query("SELECT * FROM stock_summary ORDER BY product_id,location_id");
  for (let i = 0; i < invalid.length; i++) await expect(reportProduction(actor, f.job.job_no, { ...invalid[i], idempotency_key: `invalid-report-${i}` })).rejects.toThrow();
  expect((await getJobDetail(f.job.job_no))?.reports).toHaveLength(0);
  expect(await query("SELECT * FROM stock_summary ORDER BY product_id,location_id")).toEqual(before);
});

test("a partial batch recipe can close without additional output or stock changes", async () => {
  const f = await fixture(4);
  await query("UPDATE bom_formula_items SET rm_qty_required=0.5 WHERE bom_item_id=$1", [f.mainId]);
  await updateJob(admin, f.job.job_no, { updated_at: f.job.updated_at, bom: f.selection, reason: "" });
  await submitJobs(admin, [f.job.job_no]); await startJob(actor, f.job.job_no);
  const input = { good_qty: 2, defect_qty: 0, defect_cause: "", note: "", photo_url: "", report_kind: "PARTIAL" as const, close_reason: "", receipt_location_id: "fg-A", idempotency_key: "batch-partial",
    materials: [{ item_id: f.mainId, used_qty: 1, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 2, scrap_qty: 0, scrap_cause: "" }] };
  await reportProduction(actor, f.job.job_no, input);
  const before = await query("SELECT * FROM stock_summary ORDER BY product_id,location_id");
  await reportProduction(actor, f.job.job_no, { ...input, good_qty: 0, report_kind: "FINAL", close_reason: "หยุดงาน", idempotency_key: "batch-close", materials: input.materials.map(i => ({ ...i, used_qty: 0 })) });
  expect((await getJobDetail(f.job.job_no))?.job.status).toBe("COMPLETED");
  expect(await query("SELECT * FROM stock_summary ORDER BY product_id,location_id")).toEqual(before);
});

test("failed receipt rolls back material deductions, report, ledger and reservations together", async () => {
  const f = await fixture();
  await submitJobs(admin, [f.job.job_no]); await startJob(actor, f.job.job_no);
  const balances = await query("SELECT * FROM stock_summary ORDER BY product_id,location_id");
  const reserved = await query("SELECT * FROM production_material_reservations WHERE job_no=$1", [f.job.job_no]);
  const original = f.repo.movements.batchCreate.bind(f.repo.movements);
  const spy = jest.spyOn(f.repo.movements, "batchCreate").mockImplementation(async rows => {
    if (rows.some(r => r.movement_type === "RECEIVE")) throw new Error("receipt write failed");
    return original(rows);
  });
  try {
    await expect(reportProduction(actor, f.job.job_no, { good_qty: 1, defect_qty: 0, defect_cause: "", note: "", photo_url: "", report_kind: "PARTIAL", close_reason: "", idempotency_key: "failed-material", receipt_location_id: "fg-A",
      materials: [{ item_id: f.mainId, used_qty: 2, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 1, scrap_qty: 0, scrap_cause: "" }] })).rejects.toThrow();
  } finally { spy.mockRestore(); }
  expect(await query("SELECT * FROM stock_summary ORDER BY product_id,location_id")).toEqual(balances);
  expect(await query("SELECT * FROM production_material_reservations WHERE job_no=$1", [f.job.job_no])).toEqual(reserved);
  expect((await getJobDetail(f.job.job_no))!.reports).toHaveLength(0);
  expect(await query("SELECT * FROM documents WHERE reference_no=$1", [f.job.job_no])).toEqual([]);
});

test("carton over/short is stored on production_reports columns", async () => {
  const f = await fixture();
  await submitJobs(admin, [f.job.job_no]);
  await startJob(actor, f.job.job_no);
  const input = { daily_close: true, good_qty: 3, defect_qty: 0, defect_cause: "", note: "", photo_url: "", report_kind: "FINAL" as const, close_reason: "", receipt_location_id: "fg-A", idempotency_key: "carton-columns",
    carton_over_qty: 2, carton_short_qty: 1, carton_over_item_id: "fg", leftover_location_id: "fg-A",
    materials: [{ item_id: f.mainId, used_qty: 6, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 3, scrap_qty: 0, scrap_cause: "" }] };
  const result = await reportProduction(actor, f.job.job_no, input);
  expect(await query("SELECT carton_over_qty,carton_short_qty,carton_over_item_id,leftover_location_id FROM production_reports WHERE report_id=$1", [result.report.report_id])).toEqual([
    { carton_over_qty: 2, carton_short_qty: 1, carton_over_item_id: "fg", leftover_location_id: "fg-A" },
  ]);
});
