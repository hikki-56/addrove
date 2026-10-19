import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { QueryResultRow } from "pg";
import { PostgresStockRepository } from "@/server/repositories/postgres/stock.repository";
import { query, withDatabaseTransaction } from "@/server/repositories/postgres/database";
import { appendRows, readSheet, updateRow } from "@/server/google-sheets/client";
import { withStorageRequest } from "@/server/storage-transaction";
import { createJobs, submitJobs, startJob, reportProduction, deleteDraft, getJobDetail } from "@/server/production/production-job.service";
import { createProductWithStock } from "@/server/services/create-product";
import { submitTransferMove, completeTransfer } from "@/server/services/stock/transfer-stock";
let mockDb: PGlite;
let mockConnectionTail = Promise.resolve();
jest.mock("pg", () => {
    const actual = jest.requireActual<typeof import("pg")>("pg");
    const execute = async (sql: string, values?: unknown[]) => {
        const result = await mockDb.query<QueryResultRow>(sql, values);
        const rows = result.rows.map(row => Object.fromEntries(result.fields.map(field => {
            const value = row[field.name];
            return [field.name, value instanceof Date ? value.toISOString() : typeof value === "string" ? actual.types.getTypeParser(field.dataTypeID)(value) : value];
        })));
        return { rows };
    };
    return { ...actual, Pool: class {
            query = execute;
            on() { return this; }
            async connect() {
                const previous = mockConnectionTail;
                let release!: () => void;
                mockConnectionTail = new Promise<void>(resolve => { release = resolve; });
                await previous;
                return { query: execute, release };
            }
        } };
});
const repo = new PostgresStockRepository();
const root = path.join(__dirname, "..");
const oldDriver = process.env.STORAGE_DRIVER;
const oldUrl = process.env.DATABASE_URL;

beforeAll(async () => {
    process.env.STORAGE_DRIVER = "postgres";
    process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
    mockDb = new PGlite();
    await mockDb.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE stockify_app;");
    for (const file of fs.readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort()) {
        await mockDb.exec(fs.readFileSync(path.join(root, "supabase/migrations", file), "utf8").replace("create extension if not exists pgcrypto;", ""));
    }
    await query("INSERT INTO warehouses(warehouse_id,warehouse_code,warehouse_name) VALUES('wh-1','WH01','โกดัง1')");
    await query("INSERT INTO locations(location_id,warehouse_id,location_code) VALUES('loc-A1','wh-1','A1')");
    await repo.products.create({ sku: "TEST", product_name: "Test product", category: "test", barcode: "TEST", base_unit: "ชิ้น", minimum_stock: 0, description: "" });
}, 30000);
afterAll(async () => {
    await mockDb.close();
    if (oldDriver === undefined)
        delete process.env.STORAGE_DRIVER;
    else
        process.env.STORAGE_DRIVER = oldDriver;
    if (oldUrl === undefined)
        delete process.env.DATABASE_URL;
    else
        process.env.DATABASE_URL = oldUrl;
});
test("all schema migrations are rerunnable and server-only RLS is enabled", async () => {
    await mockDb.exec(fs.readFileSync(path.join(root, "supabase/migrations/20261012000000_complete_stockify_storage.sql"), "utf8"));
    const rows = await query("SELECT relname,relrowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='public' AND relkind='r'");
    expect(rows).toHaveLength(23);
    expect(rows.every(row => row.relrowsecurity)).toBe(true);
    await mockDb.exec("SET ROLE anon;");
    try {
        await expect(mockDb.query("SELECT * FROM production_reports")).rejects.toThrow();
    }
    finally {
        await mockDb.exec("RESET ROLE;");
    }
});
test("document numbering is durable and unique under concurrent requests", async () => {
    const docs = await Promise.all(Array.from({ length: 12 }, () => repo.documents.create({ document_type: "RECEIVE", document_date: "2026-10-12", reference_no: "", status: "PENDING", note: "", created_by: "test" })));
    expect(new Set(docs.map(doc => doc.document_no)).size).toBe(12);
    expect((await repo.documents.findAll({ page: 1, limit: 100 })).total).toBe(12);
});

test("carton packaging survives creation, unrelated edits, migration replay and clearing without stock changes", async () => {
    expect((await repo.products.findBySku("TEST"))?.units_per_carton).toBeNull();
    const product = await repo.products.create({ sku: "CARTON", product_name: "Carton product", category: "test", barcode: "CARTON", base_unit: "ชิ้น", minimum_stock: 0, description: "", units_per_carton: 12 });
    try {
        await repo.stockSummary.applyChanges([{ productId: product.product_id, warehouseId: "wh-1", locationId: "A1", delta: 30 }]);
        const balancesBefore = await query("SELECT * FROM stock_summary WHERE product_id=$1", [product.product_id]);
        const movementsBefore = await repo.movements.findAll({ product_id: product.product_id });
        expect((await repo.products.findByBarcode("CARTON"))?.units_per_carton).toBe(12);
        await repo.products.update(product.product_id, { units_per_carton: 24 });
        await repo.products.update(product.product_id, { product_name: "Renamed carton product" });
        await mockDb.exec(fs.readFileSync(path.join(root, "supabase/migrations/20261015000000_product_carton_quantity.sql"), "utf8"));
        expect((await repo.products.findById(product.product_id))?.units_per_carton).toBe(24);
        await repo.products.update(product.product_id, { units_per_carton: null });
        expect((await repo.products.findById(product.product_id))?.units_per_carton).toBeNull();
        expect(await query("SELECT * FROM stock_summary WHERE product_id=$1", [product.product_id])).toEqual(balancesBefore);
        expect(await repo.movements.findAll({ product_id: product.product_id })).toEqual(movementsBefore);
    } finally {
        await query("DELETE FROM stock_summary WHERE product_id=$1", [product.product_id]);
        await query("DELETE FROM products WHERE product_id=$1", [product.product_id]);
    }
});

test.each([0, -1])("database rejects invalid carton quantity %s", async units => {
    await expect(query("UPDATE products SET units_per_carton=$1 WHERE sku='TEST'", [units])).rejects.toThrow("products_units_per_carton_positive");
    expect((await repo.products.findBySku("TEST"))?.units_per_carton).toBeNull();
});
test("an insufficient-stock operation rolls back its document and all prior deltas", async () => {
    await repo.stockSummary.applyChanges([{ productId: "TEST", warehouseId: "wh-01", locationId: "A1", delta: 10 }]);
    await expect(withDatabaseTransaction(async () => {
        await repo.documents.create({ document_type: "ISSUE", document_date: "2026-10-12", reference_no: "rollback-test", status: "POSTED", note: "", created_by: "test" });
        await repo.stockSummary.applyChanges([{ productId: "TEST", warehouseId: "wh-1", locationId: "A1", delta: -3 }, { productId: "TEST", warehouseId: "wh-1", locationId: "A1", delta: -8 }]);
    })).rejects.toThrow("สต็อกไม่เพียงพอ");
    expect(await repo.movements.getBalance("prod-TEST", "wh-1", "loc-A1")).toBe(10);
    expect((await query("SELECT * FROM documents WHERE reference_no='rollback-test'")).length).toBe(0);
});
test("zero balances stay zero even when the old ledger has positive movements", async () => {
    const doc = await repo.documents.create({ document_type: "RECEIVE", document_date: "2026-10-12", reference_no: "", status: "POSTED", note: "", created_by: "test" });
    await repo.movements.batchCreate([{ document_id: doc.document_id, product_id: "TEST", warehouse_id: "wh-1", location_id: "A1", qty_change: 10, movement_type: "RECEIVE", idempotency_key: "test-ledger", created_by: "test" }]);
    await repo.stockSummary.applyChanges([{ productId: "TEST", warehouseId: "wh-1", locationId: "A1", delta: -10 }]);
    expect(await repo.movements.getBalance("TEST", "wh-1", "A1")).toBe(0);
    expect(await repo.movements.getWarehouseBalance("TEST", "wh-1")).toBe(0);
});

test("staff submission persists awaiting approval and survives late progress without posting stock", async () => {
    const doc = await repo.documents.create({ document_type: "TRANSFER", document_date: "2026-10-12", reference_no: "submit-persistence", status: "PENDING", note: JSON.stringify({ current_step: 3 }), created_by: "test" });
    const handler = withStorageRequest(async () => Response.json(await submitTransferMove({ repo }, doc.document_id, { fromLocationId: "A1", toLocationId: "B1", userId: "test", userName: "Test staff" })));
    expect((await handler()).status).toBe(200);
    await repo.documents.mutateTransferProgress(doc.document_id, () => ({ note: JSON.stringify({ current_step: 2 }) }));
    const persisted = await repo.documents.findById(doc.document_id);
    expect(persisted?.status).toBe("WAITING_APPROVAL");
    expect(JSON.parse(persisted!.note)).toMatchObject({ current_step: 4, to_location_id: "B1", mover_user_id: "test" });
    expect(JSON.parse(persisted!.note).moved_at).toBeTruthy();
    const resubmitted = await submitTransferMove({ repo }, doc.document_id, { toLocationId: "C1", userId: "test" });
    expect(resubmitted).toEqual(persisted);
    expect(await repo.movements.findByDocumentId(doc.document_id)).toEqual([]);
});
test("production-supplied document IDs are retained for movement foreign keys", async () => {
    const supplied = { document_id: "doc-production-report", document_no: "PRD-20261012-1-R1", created_at: new Date().toISOString(), document_type: "RECEIVE" as const, document_date: "2026-10-12", reference_no: "production", status: "POSTED" as const, note: "", created_by: "test" };
    const doc = await repo.documents.create(supplied);
    expect(doc.document_id).toBe(supplied.document_id);
    await expect(repo.movements.batchCreate([{ document_id: doc.document_id, product_id: "TEST", warehouse_id: "wh-1", location_id: "A1", qty_change: 1, movement_type: "RECEIVE", idempotency_key: "production-test", created_by: "test" }])).resolves.toHaveLength(1);
});
test("users retain password hashes, PINs, and warehouse authorization", async () => {
    const user = await repo.users.create({ full_name: "Test User", email: "test@example.invalid", password_hash: "existing-hash", pin_hash: "existing-pin", role: "WAREHOUSE_STAFF", warehouse_access: '["wh-1"]', active: true });
    const found = await repo.users.findByEmail("TEST@example.invalid");
    expect(found).toMatchObject({ user_id: user.user_id, password_hash: "existing-hash", pin_hash: "existing-pin", warehouse_access: '["wh-1"]' });
    expect((await readSheet("Users", "A2:M"))[0][12]).toBe('["wh-1"]');
    await query("UPDATE users SET source_cells=$2::jsonb WHERE user_id=$1", [user.user_id, JSON.stringify([user.user_id, "existing-hash", "existing-pin"])]);
    expect(await repo.users.findById(user.user_id)).not.toHaveProperty("source_cells");
    expect(await repo.users.findById(user.user_id)).not.toHaveProperty("source_row");
});
test("legacy auxiliary tabs preserve columns and partial updates use PostgreSQL", async () => {
    await appendRows("รายการสินค้ากล่อง_Q", [["Q1", "sku", "name", 1, "extra"]]);
    await updateRow("รายการสินค้ากล่อง_Q", 2, ["Q1", "updated"]);
    expect(await readSheet("รายการสินค้ากล่อง_Q", "A2:E")).toEqual([["Q1", "updated", "name", "1", "extra"]]);
    await repo.stockSummary.applyChanges([{ productId: "TEST", warehouseId: "wh-1", locationId: "A1", delta: 5 }]);
    expect((await readSheet("โกดัง1", "A2:I"))[0][5]).toBe("5");
});
test("a handler that catches errors and returns 4xx cannot commit partial writes", async () => {
    const handler = withStorageRequest(async () => {
        await repo.documents.create({ document_type: "RECEIVE", document_date: "2026-10-12", reference_no: "http-rollback", status: "PENDING", note: "", created_by: "test" });
        return Response.json({ success: false }, { status: 409 });
    });
    expect((await handler()).status).toBe(409);
    expect(await query("SELECT * FROM documents WHERE reference_no='http-rollback'")).toEqual([]);
});
test("idempotency keys cannot silently fall back to memory", async () => {
    const record = { key: "durable-test", operation_type: "RECEIVE", actor_id: "test", payload_hash: "hash", status: "PROCESSING" as const };
    await repo.idempotency.create(record);
    await expect(repo.idempotency.create(record)).rejects.toThrow();
    expect(await repo.idempotency.findByKey(record.key)).toMatchObject(record);
});
test("swallowed nested business errors still force the outer transaction to roll back", async () => {
    const before = await repo.movements.getBalance("TEST", "wh-1", "A1");
    await expect(withDatabaseTransaction(async () => {
        try {
            await repo.stockSummary.applyChanges([{ productId: "TEST", warehouseId: "wh-1", locationId: "A1", delta: -1000 }]);
        }
        catch { /* Legacy approval handlers catch this error. */ }
        await repo.documents.create({ document_type: "RECEIVE", document_date: "2026-10-12", reference_no: "swallowed-error", status: "POSTED", note: "", created_by: "test" });
    })).rejects.toThrow("no changes were committed");
    expect(await repo.movements.getBalance("TEST", "wh-1", "A1")).toBe(before);
    expect(await query("SELECT * FROM documents WHERE reference_no='swallowed-error'")).toEqual([]);
});
test("native production reporting posts stock exactly once and draft deletion retains history", async () => {
    await query("INSERT INTO warehouses(warehouse_id,warehouse_code,warehouse_name) VALUES('wh-2','WH02','โกดัง2')");
    await query("INSERT INTO locations(location_id,warehouse_id,location_code) VALUES('loc-wh2-A1','wh-2','A1')");
    const actor = { id: "test", name: "Test operator", role: "ADMIN" as const };
    const input = { production_date: "2026-10-12", table_no: 1, product_id: "prod-TEST", target_qty: 4, priority: "NORMAL" as const, note: "", location: "A1" };
    const [job] = await createJobs(actor, [input]);
    await submitJobs(actor, [job.job_no]);
    await startJob(actor, job.job_no);
    const report = { good_qty: 2, defect_qty: 0, defect_cause: "", note: "", photo_url: "", report_kind: "PARTIAL" as const, close_reason: "", idempotency_key: "production-native-report" };
    await reportProduction(actor, job.job_no, report);
    expect((await reportProduction(actor, job.job_no, report)).replayed).toBe(true);
    expect(await repo.movements.getBalance("TEST", "wh-2", "A1")).toBe(2);
    const [draft] = await createJobs(actor, [input]);
    await deleteDraft(actor, draft.job_no);
    expect(await getJobDetail(draft.job_no)).toBeNull();
    expect((await query("SELECT * FROM production_history WHERE job_no=$1", [draft.job_no])).length).toBe(2);
});
test("native dashboard uses minimum-stock settings from the typed product repository", async () => {
    await repo.products.update("prod-TEST", { minimum_stock: 100 });
    expect((await repo.dashboard.getStats("wh-1")).low_stock_count).toBe(1);
});
test("new products post durable initial stock while staff additions await approval", async () => {
    await query("INSERT INTO locations(location_id,warehouse_id,location_code) VALUES('loc-14A1','wh-1','14A1')");
    const input = { sku: "NEW-ADMIN", product_name: "New product", category: "test", barcode: "NEW-ADMIN", base_unit: "ชิ้น", minimum_stock: 0, description: "", warehouse_id: "wh-1", initial_quantity: 7 };
    await createProductWithStock(input, { id: "test", name: "Admin", role: "ADMIN" });
    expect(await repo.movements.getBalance("NEW-ADMIN", "wh-1", "14A1")).toBe(7);
    await repo.stockSummary.rebuild();
    expect(await repo.movements.getBalance("NEW-ADMIN", "wh-1", "14A1")).toBe(7);
    const product = await createProductWithStock({ ...input, sku: "NEW-STAFF", barcode: "NEW-STAFF" }, { id: "test", name: "Staff", role: "WAREHOUSE_STAFF" });
    expect((await query("SELECT status,note FROM documents WHERE reference_no=$1", [product.sku]))[0]).toMatchObject({ status: "PENDING" });
    expect(await repo.movements.getWarehouseBalance(product.product_id, "wh-1")).toBe(0);
    const before = (await query("SELECT count(*)::int count FROM documents"))[0].count;
    await createProductWithStock({ ...input, sku: "NEW-ZERO", barcode: "NEW-ZERO", initial_quantity: 0 }, { id: "test", name: "Admin", role: "ADMIN" });
    expect((await query("SELECT count(*)::int count FROM documents"))[0].count).toBe(before);
    expect((await repo.stockSummary.findAll("wh-1")).some(row => row.product_id === "prod-NEW-ZERO" && row.quantity === 0)).toBe(true);
});

test("approval allocates a warehouse-wide transfer across actual shelves and unassigned stock exactly once", async () => {
    await query("INSERT INTO warehouses(warehouse_id,warehouse_code,warehouse_name) VALUES('wh-05','WHTRF','Transfer destination')");
    await query("INSERT INTO locations(location_id,warehouse_id,location_code) VALUES('loc-transfer-dest','wh-05','DEST'),('loc-transfer-source-b','wh-1','B1')");
    const product = await repo.products.create({ sku: "TRANSFER-MULTI", barcode: "TRANSFER-MULTI", product_name: "Transfer test", category: "test", base_unit: "ชิ้น", minimum_stock: 0, description: "" });
    await repo.stockSummary.applyChanges([
        { productId: product.product_id, warehouseId: "wh-1", locationId: "A1", delta: 3 },
        { productId: product.product_id, warehouseId: "wh-1", locationId: "B1", delta: 2 },
        { productId: product.product_id, warehouseId: "wh-1", locationId: "", delta: 1 },
    ]);
    const create = (qty: number) => repo.documents.create({ document_type: "TRANSFER", document_date: "2026-10-13", reference_no: "multi-location", status: "WAITING_APPROVAL", created_by: "test", note: JSON.stringify({ product_id: product.product_id, from_warehouse_id: "wh-1", to_warehouse_id: "wh-05", from_location_id: "A1, B1", to_location_id: "DEST", qty }) });
    const insufficient = await create(7);
    const approve = (id: string) => withStorageRequest(async () => Response.json(await completeTransfer({ repo }, id, "DEST", "A1, B1", "test", "ADMIN")))();
    expect((await approve(insufficient.document_id)).status).toBe(503);
    expect(await repo.movements.findByDocumentId(insufficient.document_id)).toEqual([]);
    expect((await repo.documents.findById(insufficient.document_id))?.status).toBe("WAITING_APPROVAL");
    const doc = await create(6);
    expect((await approve(doc.document_id)).status).toBe(200);
    expect((await repo.documents.findById(doc.document_id))?.status).toBe("COMPLETED");
    const movements = await repo.movements.findByDocumentId(doc.document_id);
    expect(movements.filter(m => m.movement_type === "TRANSFER_OUT").map(m => [m.location_id, m.qty_change])).toEqual([["loc-A1", -3], ["loc-transfer-source-b", -2], ["loc-wh-1-unassigned", -1]]);
    expect(await repo.movements.getWarehouseBalance(product.product_id, "wh-1")).toBe(0);
    expect(await repo.movements.getBalance(product.product_id, "wh-05", "DEST")).toBe(6);
    expect((await approve(doc.document_id)).status).toBe(200);
    expect(await repo.movements.findByDocumentId(doc.document_id)).toEqual(movements);
});
