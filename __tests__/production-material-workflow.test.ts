import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { QueryResultRow } from "pg";
import { query } from "@/server/repositories/postgres/database";
import { getRepository } from "@/server/repositories";
import { createJobs, submitJobs, startJob, reportProduction, cancelJob, reopenJob, getJobDetail, deleteDraft, updateJob } from "@/server/production/production-job.service";
import { previewMaterialAvailability, listProductionCapacities } from "@/server/production/production-material.service";
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
  await reportProduction(actor, f.job.job_no, { good_qty: 1, defect_qty: 1, defect_cause: "ประกอบเสีย", note: "", photo_url: "", report_kind: "PARTIAL", close_reason: "", idempotency_key: "note-shortage-partial", receipt_location_id: "fg-A", materials: [{ item_id: f.mainId, used_qty: 4, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 2, scrap_qty: 0, scrap_cause: "" }] });
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
    materials: [{ item_id: f.mainId, used_qty: 4, scrap_qty: 0, scrap_cause: "" }, { item_id: f.sharedId, used_qty: 2, scrap_qty: 1, scrap_cause: "แผงขาดก่อนประกอบ" }] };
  await reportProduction(actor, f.job.job_no, partial);
  await reportProduction(actor, f.job.job_no, partial);
  expect(await f.repo.movements.getBalance(f.fg.product_id, "wh-02", "fg-A")).toBe(1);
  expect(await f.repo.movements.getBalance(f.main.product_id, "wh-02", "raw-A")).toBe(26);
  expect(await f.repo.movements.getBalance(f.shared.product_id, "wh-02", "raw-A")).toBe(7);
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
