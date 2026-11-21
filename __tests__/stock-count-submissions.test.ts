import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { PGlite } from "@electric-sql/pglite";
import { GET, POST } from "@/app/api/stock-counts/rounds/route";
import type { Actor } from "@/server/security";

let mockDb: PGlite;
let mockActor: Actor;
jest.mock("@/server/security", () => ({
  ...jest.requireActual("@/server/security"),
  createActorFromSession: async () => mockActor,
}));
jest.mock("@/server/repositories/storage-driver", () => ({ getStorageDriver: () => "postgres" }));
jest.mock("@/server/repositories/postgres/database", () => ({
  query: async (sql: string, values: unknown[]) => {
    const result = await mockDb.query<Record<string, unknown>>(sql, values);
    // Match the application's pg parsers for numeric and timestamptz.
    return result.rows.map(row => Object.fromEntries(result.fields.map(field => {
      const value = row[field.name];
      return [field.name, field.dataTypeID === 1700 ? Number(value) : value instanceof Date ? value.toISOString() : value];
    })));
  },
  withDatabaseTransaction: (action: () => Promise<unknown>) => action(),
}));

const endpoint = "http://localhost/api/stock-counts/rounds";
const get = (params: string) => GET(new NextRequest(endpoint + "?" + params));
const submission = { action: "submit", warehouse: "wh-01", shelf: "A1", product: "p1", quantity: 3.5, request: randomUUID() };
const post = (body: typeof submission) => POST(new NextRequest(endpoint, { method: "POST", body: JSON.stringify(body) }));

function signIn(id: string, role: Actor["role"]) {
  mockActor = { id, role, username: "session name", warehouseAccess: "wh-01", correlationId: "test" };
}

beforeAll(async () => {
  mockDb = new PGlite();
  await mockDb.exec("create role anon; create role authenticated; create role stockify_app;");
  const migrations = path.join(__dirname, "../supabase/migrations");
  for (const file of fs.readdirSync(migrations).filter(f => f.endsWith(".sql")).sort()) {
    await mockDb.exec(fs.readFileSync(path.join(migrations, file), "utf8").replace("create extension if not exists pgcrypto;", ""));
  }
  await mockDb.exec(`insert into warehouses(warehouse_id,warehouse_code,warehouse_name) values ('wh-01','WH1','โกดัง 1');
    insert into locations(location_id,warehouse_id,location_code) values ('loc-A','wh-01','A1');
    insert into products(product_id,sku,barcode,product_name,base_unit) values ('p1','SKU','12345678','สินค้า','ชิ้น');
    insert into users(user_id,full_name,email,password_hash,role) values
      ('ty','Owner','ty@stockify.com','x','ADMIN'),('a','Alice','a@example.com','x','STAFF'),('b','Bob','b@example.com','x','ADMIN');`);
}, 60000);
afterAll(async () => { await mockDb?.close(); });

test("staff scan, confirm and retry; TY sees each person's entered quantity on the Bangkok submission date", async () => {
  signIn("a", "STAFF");
  expect((await (await get("")).json()).data.reviewer).toBe(false);
  expect((await (await get("warehouse=wh-01&product=12345678")).json()).data.sku).toBe("SKU");
  expect((await (await get("warehouse=wh-01&location=a1")).json()).data).toBe("A1");
  expect((await get("warehouse=wh-01&location=missing")).status).toBe(400);
  expect((await get("warehouse=wh-02&location=A1")).status).toBe(403);
  expect((await get("warehouse=wh-01&date=2026-11-21")).status).toBe(403);
  expect((await post(submission)).status).toBe(200);
  expect((await post(submission)).status).toBe(200);
  expect((await post({ ...submission, quantity: 8 })).status).toBe(409);
  signIn("b", "ADMIN");
  expect((await get("warehouse=wh-01&date=2026-11-21")).status).toBe(403);
  expect((await post({ ...submission, quantity: 0, request: randomUUID() })).status).toBe(200);
  signIn("ty", "ADMIN");
  expect((await (await get("")).json()).data.reviewer).toBe(true);
  expect((await post(submission)).status).toBe(403);
  await mockDb.exec(`update stock_count_rounds set opened_at='2026-11-19T00:00:00Z';
    update stock_count_entries set counted_at='2026-11-20T17:00:00Z';`);
  const report = async (date: string) => (await (await get("warehouse=wh-01&date=" + date)).json()).data;
  expect(await report("2026-11-20")).toEqual([]);
  const rows = await report("2026-11-21");
  expect(rows).toHaveLength(2);
  expect(rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ counter_name: "Alice", quantity: 3.5, shelf_code: "A1", sku: "SKU" }),
    expect.objectContaining({ counter_name: "Bob", quantity: 0, shelf_code: "A1", sku: "SKU" }),
  ]));
});
