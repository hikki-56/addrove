import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { QueryResultRow } from "pg";
import { readReferenceFile } from "@/app/(dashboard)/stock-counts/_lib/reference-file";
import { productTotals } from "@/lib/count-comparison";
import { PostgresStockRepository } from "@/server/repositories/postgres/stock.repository";
import { query, withDatabaseTransaction } from "@/server/repositories/postgres/database";
import { dailyComparison, importCountReference, productComparison, warehouseReference } from "@/server/services/count-reference.service";
import { countReport, submitCount } from "@/server/services/count-round.service";

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
}, 30000);

afterAll(async () => {
    await mockDb.close();
    if (oldDriver === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = oldDriver;
    if (oldUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldUrl;
});

test("importing the real warehouse CSV stores unmatched codes and compares them when scanned", async () => {
    const warehouse = "wh-ref-csv";
    await query("insert into warehouses(warehouse_id,warehouse_code,warehouse_name) values($1,'REFCSV','CSV reference')", [warehouse]);
    const known = await repo.products.create({
        sku: "0สบ-120-4", product_name: "สบู่ทดสอบ", category: "test", barcode: "0SAB-120-4",
        base_unit: "ชิ้น", minimum_stock: 0, description: "",
    });
    const bytes = fs.readFileSync(path.join(__dirname, "fixtures/warehouse-stock-report-wh5.csv"));
    const rows = await readReferenceFile(new File([bytes], "warehouse-stock-report-wh5.csv"));
    expect(rows).toHaveLength(120);
    expect(rows.find(r => r.code === "KBK-40S3")).toEqual(expect.objectContaining({ row: 81, code: "KBK-40S3", quantity: 2376 }));

    const file = await withDatabaseTransaction(() => importCountReference(warehouse, "warehouse-stock-report-wh5.csv", rows));
    expect(file.row_count).toBe(120);
    expect(file.unmatched_count).toBe(119);
    expect((await warehouseReference(warehouse))?.unmatched_count).toBe(119);

    const knownCmp = await productComparison(warehouse, known.product_id);
    expect(knownCmp.hasReference).toBe(true);
    expect(knownCmp.shelves).toEqual([expect.objectContaining({ expected_qty: 20240 })]);

    const late = await repo.products.create({
        sku: "kbk-40s3", product_name: "กุญแจคีย์ไลค์", category: "test", barcode: "BAR-KBK-40S3-LATE",
        base_unit: "ชุด", minimum_stock: 0, description: "",
    });
    const lateCmp = await productComparison(warehouse, late.product_id);
    expect(lateCmp.shelves).toEqual([expect.objectContaining({ expected_qty: 2376 })]);

    const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
    const report = await dailyComparison(warehouse, day, []);
    expect(report.totals).toHaveLength(120);
    expect(report.totals.find(t => t.product_id === late.product_id)).toEqual(expect.objectContaining({ expected: 2376, sku: "kbk-40s3" }));
    expect(report.totals.filter(t => /kbk-40s3/i.test(t.sku))).toHaveLength(1);
    expect(report.totals.find(t => t.product_id === known.product_id)).toEqual(expect.objectContaining({ expected: 20240 }));
});

test("ambiguous file codes are stored and do not crash or double-count daily totals", async () => {
    const warehouse = "wh-ref-ambig";
    await query("insert into warehouses(warehouse_id,warehouse_code,warehouse_name) values($1,'REFAMB','Ambiguous reference')", [warehouse]);
    const first = await repo.products.create({
        sku: "FOO-AMB", product_name: "Foo", category: "test", barcode: "AMB-CODE",
        base_unit: "ชิ้น", minimum_stock: 0, description: "",
    });
    const second = await repo.products.create({
        sku: "AMB-CODE", product_name: "Bar", category: "test", barcode: "BAR-AMB",
        base_unit: "ชิ้น", minimum_stock: 0, description: "",
    });
    const file = await withDatabaseTransaction(() => importCountReference(warehouse, "ambig.csv", [
        { row: 2, code: "AMB-CODE", shelf: "", quantity: 10 },
        { row: 3, code: "  unique-1 ", shelf: "", quantity: 4 },
    ]));
    expect(file).toEqual(expect.objectContaining({ row_count: 2, unmatched_count: 2 }));

    const unique = await repo.products.create({
        sku: "UNIQUE-1", product_name: "Unique", category: "test", barcode: "U1",
        base_unit: "ชิ้น", minimum_stock: 0, description: "",
    });
    expect((await productComparison(warehouse, unique.product_id)).shelves).toEqual([
        expect.objectContaining({ expected_qty: 4 }),
    ]);
    expect((await productComparison(warehouse, first.product_id)).shelves).toEqual([
        expect.objectContaining({ expected_qty: 10 }),
    ]);
    expect((await productComparison(warehouse, second.product_id)).shelves).toEqual([
        expect.objectContaining({ expected_qty: 10 }),
    ]);

    const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
    const report = await dailyComparison(warehouse, day, []);
    expect(report.totals.filter(t => t.expected === 10)).toEqual([
        expect.objectContaining({ product_id: "AMB-CODE", sku: "AMB-CODE", expected: 10 }),
    ]);
    expect(report.totals.find(t => t.product_id === unique.product_id)?.expected).toBe(4);
});

test("comparison includes scans recorded before the reference file is uploaded", async () => {
    const warehouse = "wh-late-cmp";
    await query("insert into warehouses(warehouse_id,warehouse_code,warehouse_name) values($1,'LATECMP','Late comparison')", [warehouse]);
    await query("insert into locations(location_id,warehouse_id,location_code) values('late-cmp-a',$1,'A')", [warehouse]);
    const product = await repo.products.create({
        sku: "LATE-SKU", product_name: "นับก่อนไฟล์", category: "test", barcode: "LATE-BAR",
        base_unit: "ชิ้น", minimum_stock: 0, description: "",
    });
    const actor = { id: "late-staff", username: "Counter", role: "ADMIN" as const, correlationId: randomUUID() };
    const saved = await submitCount({
        action: "submit", warehouse, product: product.product_id, shelf: "A", quantity: 5, request: randomUUID(),
    }, actor);
    expect(saved.totals).toBeNull();

    const file = await withDatabaseTransaction(() => importCountReference(warehouse, "late.csv", [
        { row: 2, code: "LATE-SKU", shelf: "", quantity: 8 },
    ]));
    expect(file.unmatched_count).toBe(0);

    const comparison = await productComparison(warehouse, product.product_id);
    expect(comparison.hasReference).toBe(true);
    expect(productTotals(comparison)).toEqual({ expected: 8, counted: 5 });

    const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
    const report = await dailyComparison(warehouse, day, await countReport(warehouse, day));
    expect(report.reference?.id).toBe(file.id);
    expect(report.totals).toEqual([expect.objectContaining({ sku: "LATE-SKU", expected: 8, counted: 5 })]);

    const replaced = await withDatabaseTransaction(() => importCountReference(warehouse, "late-replaced.csv", [
        { row: 2, code: "LATE-SKU", shelf: "", quantity: 10 },
    ]));
    const afterReplace = await dailyComparison(warehouse, day, await countReport(warehouse, day));
    expect(afterReplace.reference?.id).toBe(replaced.id);
    expect(afterReplace.totals).toEqual([expect.objectContaining({ sku: "LATE-SKU", expected: 10, counted: 5 })]);
});

test("a later upload still compares against earlier scans in the open round on a previous date", async () => {
    const warehouse = "wh-late-yday";
    await query("insert into warehouses(warehouse_id,warehouse_code,warehouse_name) values($1,'LATEYDAY','Late yesterday')", [warehouse]);
    await query("insert into locations(location_id,warehouse_id,location_code) values('late-yday-a',$1,'A')", [warehouse]);
    const product = await repo.products.create({
        sku: "YDAY-SKU", product_name: "นับเมื่อวาน", category: "test", barcode: "YDAY-BAR",
        base_unit: "ชิ้น", minimum_stock: 0, description: "",
    });
    const actor = { id: "yday-staff", username: "Counter", role: "ADMIN" as const, correlationId: randomUUID() };
    await submitCount({
        action: "submit", warehouse, product: product.product_id, shelf: "A", quantity: 3, request: randomUUID(),
    }, actor);
    await query(`update stock_count_entries set counted_at = (((now() at time zone 'Asia/Bangkok')::date - 1)::timestamp at time zone 'Asia/Bangkok')
      where product_id=$1`, [product.product_id]);

    await withDatabaseTransaction(() => importCountReference(warehouse, "yday.csv", [
        { row: 2, code: "YDAY-SKU", shelf: "", quantity: 7 },
    ]));

    const bangkok = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
    const [y, m, d] = bangkok.split("-").map(Number);
    const ydayDate = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
    ydayDate.setUTCDate(ydayDate.getUTCDate() - 1);
    const yday = ydayDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });

    const todayReport = await dailyComparison(warehouse, bangkok, await countReport(warehouse, bangkok));
    expect(todayReport.entries).toHaveLength(0);
    expect(todayReport.totals).toEqual([expect.objectContaining({ sku: "YDAY-SKU", expected: 7, counted: 3 })]);

    const ydayReport = await dailyComparison(warehouse, yday, await countReport(warehouse, yday));
    expect(ydayReport.entries).toHaveLength(1);
    expect(ydayReport.totals).toEqual([expect.objectContaining({ sku: "YDAY-SKU", expected: 7, counted: 3 })]);

    const live = await productComparison(warehouse, product.product_id);
    expect(productTotals(live)).toEqual({ expected: 7, counted: 3 });
});
