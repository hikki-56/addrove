import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { QueryResultRow } from "pg";
import { PostgresStockRepository } from "@/server/repositories/postgres/stock.repository";
import { query } from "@/server/repositories/postgres/database";
import { getOfficeHistory, getOfficeProducts, getOfficeSetup, transferToOffice } from "@/server/services/office.service";
import { hasOfficeBarcode, matchesOfficeSearch } from "@/lib/office";

let mockDb: PGlite;
let mockConnectionTail = Promise.resolve();
jest.mock("pg", () => {
  const actual = jest.requireActual<typeof import("pg")>("pg");
  const execute = async (sql: string, values?: unknown[]) => {
    const result = await mockDb.query<QueryResultRow>(sql, values);
    return { rows: result.rows.map((row) => Object.fromEntries(result.fields.map((field) => {
      const value = row[field.name];
      return [field.name, value instanceof Date ? value.toISOString() : typeof value === "string" ? actual.types.getTypeParser(field.dataTypeID)(value) : value];
    }))) };
  };
  return { ...actual, Pool: class {
    query = execute;
    on() { return this; }
    async connect() {
      const previous = mockConnectionTail;
      let release!: () => void;
      mockConnectionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      return { query: execute, release };
    }
  } };
});

const repo = new PostgresStockRepository();
const actor = { id: "office-test-admin", name: "ผู้ทดสอบ", role: "ADMIN" };
const oldDriver = process.env.STORAGE_DRIVER;
const oldUrl = process.env.DATABASE_URL;

beforeAll(async () => {
  process.env.STORAGE_DRIVER = "postgres";
  process.env.DATABASE_URL = "postgresql://test:test@localhost/office-test";
  mockDb = new PGlite();
  await mockDb.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE stockify_app;");
  const migrations = path.join(__dirname, "../supabase/migrations");
  for (const file of fs.readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    await mockDb.exec(fs.readFileSync(path.join(migrations, file), "utf8").replace("create extension if not exists pgcrypto;", ""));
  }
  await query("INSERT INTO warehouses(warehouse_id,warehouse_code,warehouse_name) VALUES('wh-1','WH01','โกดัง 1'),('wh-2','WH02','โกดัง 2'),('wh-6','WH06','สำนักงานใหญ่')");
  await query("INSERT INTO locations(location_id,warehouse_id,location_code) VALUES('loc-A','wh-1','A1'),('loc-B','wh-1','A2'),('office-A','wh-6','OF-A-01'),('other-A','wh-2','OTHER')");
  await query("INSERT INTO locations(location_id,warehouse_id,location_code,active) VALUES('office-inactive','wh-6','OF-CLOSED',false)");
  await query("INSERT INTO products(product_id,sku,barcode,product_name,base_unit) VALUES('p13','KT-101','8851234510103','ก๊อกอ่างล้างจาน','ชิ้น'),('p8','SHORT','12345678','บาร์โค้ดสั้น','ชิ้น'),('pAlpha','ALPHA','A851234510103','ตัวอักษร','ชิ้น')");
}, 60000);

beforeEach(async () => {
  await query("DELETE FROM stock_movements");
  await query("DELETE FROM stock_summary");
  await query("DELETE FROM documents");
  await query("DELETE FROM idempotency_records");
  await query("DELETE FROM operation_journal");
  await query("INSERT INTO stock_summary(product_id,warehouse_id,location_id,quantity) VALUES('p13','wh-1','loc-A',10),('p13','wh-1','loc-B',15),('p13','wh-6','office-A',2),('p8','wh-1','loc-A',100),('p8','wh-6','office-A',20),('pAlpha','wh-6','office-A',30)");
});

afterAll(async () => {
  await mockDb?.close();
  if (oldDriver === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = oldDriver;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});

const input = (key: string, quantity = 12, location_code = "OF-A-01") => ({ from_warehouse_id: "wh-1", idempotency_key: key, lines: [{ product_id: "p13", quantity, location_code }] });

test("office catalog only includes numeric 13-digit barcodes and is scoped to office stock", async () => {
  const setup = await getOfficeSetup(repo);
  expect(setup.office?.warehouse_id).toBe("wh-6");
  expect(setup.warehouses.map((w) => w.warehouse_id)).toEqual(["wh-1", "wh-2"]);
  expect(setup.locations.map((l) => l.location_code)).toEqual(["OF-A-01"]);
  const products = await getOfficeProducts(repo, "wh-6");
  expect(products).toHaveLength(1);
  expect(products[0]).toMatchObject({ product_id: "p13", quantity: 2, location_code: "OF-A-01", barcode: "8851234510103" });
  for (const search of ["kt-101", "อ่าง", "8851234510103", "0103"]) expect(matchesOfficeSearch(products[0], search)).toBe(true);
  expect(matchesOfficeSearch(products[0], "1234-no-match")).toBe(false);
  expect(matchesOfficeSearch(products[0], "1234")).toBe(false);
  expect(hasOfficeBarcode("12345678")).toBe(false);
  expect(hasOfficeBarcode("A851234510103")).toBe(false);
  expect((await getOfficeProducts(repo, "wh-1", true))[0].quantity).toBe(25);
});

test("confirm immediately transfers from multiple source shelves to the chosen office location", async () => {
  const doc = await transferToOffice(repo, input("office-direct-transfer"), actor);
  expect(doc.status).toBe("COMPLETED");
  expect(await repo.movements.getWarehouseBalance("p13", "wh-1")).toBe(13);
  expect(await repo.movements.getBalance("p13", "wh-6", "office-A")).toBe(14);
  const movements = await repo.movements.findByDocumentId(doc.document_id);
  expect(movements.reduce((sum, movement) => sum + movement.qty_change, 0)).toBe(0);
  expect(movements.filter((m) => m.movement_type === "TRANSFER_OUT")).toHaveLength(2);
  expect(await getOfficeHistory(repo)).toEqual([expect.objectContaining({ product_id: "p13", quantity: 12, location_code: "OF-A-01", created_by_name: "ผู้ทดสอบ" })]);
});

test("manual new location is created and receives stock immediately; retries have only one effect", async () => {
  const request = input("office-new-location", 3, "of-new-01");
  const doc = await transferToOffice(repo, request, actor);
  expect((await transferToOffice(repo, request, actor)).document_id).toBe(doc.document_id);
  expect(await repo.movements.getWarehouseBalance("p13", "wh-1")).toBe(22);
  const locations = (await repo.locations.findAll("wh-6")).filter((l) => l.location_code === "OF-NEW-01");
  expect(locations).toHaveLength(1);
  expect(await repo.movements.getBalance("p13", "wh-6", locations[0].location_id)).toBe(3);
  await expect(transferToOffice(repo, { ...request, lines: [{ ...request.lines[0], quantity: 4 }] }, actor)).rejects.toThrow();
  expect(await repo.movements.getWarehouseBalance("p13", "wh-1")).toBe(22);
});

test("repeated SKUs across different destinations cannot exceed the source balance", async () => {
  await expect(transferToOffice(repo, { ...input("office-oversold-batch"), lines: [
    { product_id: "p13", quantity: 20, location_code: "OF-A-01" },
    { product_id: "p13", quantity: 6, location_code: "OF-NEVER-CREATED" },
  ] }, actor)).rejects.toThrow(/ไม่เพียงพอ/);
  expect(await repo.movements.getWarehouseBalance("p13", "wh-1")).toBe(25);
  expect(await repo.documents.findAll()).toMatchObject({ total: 0 });
  expect((await repo.locations.findAll("wh-6")).some((l) => l.location_code === "OF-NEVER-CREATED")).toBe(false);
});

test("server rejects non-13-digit barcodes, inactive locations and office as the source", async () => {
  await expect(transferToOffice(repo, { ...input("office-invalid-barcode"), lines: [{ product_id: "p8", quantity: 1, location_code: "OF-A-01" }] }, actor)).rejects.toThrow(/13 หลัก/);
  await expect(transferToOffice(repo, input("office-inactive-location", 1, "OF-CLOSED"), actor)).rejects.toThrow(/ปิดใช้งาน/);
  await expect(transferToOffice(repo, { ...input("office-same-warehouse"), from_warehouse_id: "wh-6" }, actor)).rejects.toThrow();
  expect(await repo.movements.getWarehouseBalance("p13", "wh-1")).toBe(25);
});

test("a later write failure rolls back source, destination, movements, document and new location", async () => {
  const add = jest.spyOn(repo.warehouseSync, "syncAdd").mockRejectedValueOnce(new Error("simulated storage failure"));
  await expect(transferToOffice(repo, input("office-rollback-batch", 5, "OF-ROLLBACK"), actor)).rejects.toThrow("simulated storage failure");
  add.mockRestore();
  expect(await repo.movements.getWarehouseBalance("p13", "wh-1")).toBe(25);
  expect(await repo.movements.getBalance("p13", "wh-6", "office-A")).toBe(2);
  expect(await repo.documents.findAll()).toMatchObject({ total: 0 });
  expect((await query("SELECT count(*)::integer AS total FROM stock_movements"))[0].total).toBe(0);
  expect((await repo.locations.findAll("wh-6")).some((l) => l.location_code === "OF-ROLLBACK")).toBe(false);
});
