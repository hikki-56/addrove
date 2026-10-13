import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PostgresUserRepository } from "@/server/repositories/postgres/stock.repository";
import { query } from "@/server/repositories/postgres/database";
import type { QueryResultRow } from "pg";

let mockDb: PGlite;
jest.mock("pg", () => {
  const actual = jest.requireActual<typeof import("pg")>("pg");
  return { ...actual, Pool: class {
    async query(sql: string, values?: unknown[]) { return mockDb.query<QueryResultRow>(sql, values); }
    on() { return this; }
  } };
});
const repo = new PostgresUserRepository();
const oldUrl = process.env.DATABASE_URL;
const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261013000000_user_menu_visibility.sql"), "utf8");

beforeAll(async () => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/menu-test";
  mockDb = new PGlite();
  await mockDb.exec(`create table users (
    user_id text primary key, full_name text, email text, role text, active boolean,
    password_hash text, pin_hash text, warehouse_access jsonb,
    source_row bigint generated always as identity, created_at timestamptz default now(), updated_at timestamptz default now()
  );`);
  await mockDb.exec(migration);
}, 30000);
afterAll(async () => {
  await mockDb.close();
  if (oldUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldUrl;
});

test("migration is rerunnable and default menus remain null", async () => {
  await mockDb.exec(migration);
  const user = await repo.create({ full_name: "Staff", email: "staff@stockify.com", role: "WAREHOUSE_STAFF", active: true, password_hash: "hash", pin_hash: "pin", warehouse_access: '["wh-1"]' });
  expect(user.menu_hrefs).toBeNull();
});

test("JSONB menu lists survive updates, clearing and resetting", async () => {
  const user = await repo.create({ full_name: "Staff 2", email: "staff2@stockify.com", role: "WAREHOUSE_STAFF", active: true, password_hash: "hash", pin_hash: "pin", warehouse_access: '["wh-1"]', menu_hrefs: ["/staff/receive"] });
  expect((await repo.findById(user.user_id))?.menu_hrefs).toEqual(["/staff/receive"]);
  await repo.update(user.user_id, { full_name: "Renamed" });
  expect((await repo.findById(user.user_id))?.menu_hrefs).toEqual(["/staff/receive"]);
  await repo.update(user.user_id, { menu_hrefs: [] });
  expect((await repo.findById(user.user_id))?.menu_hrefs).toEqual([]);
  await repo.update(user.user_id, { menu_hrefs: null });
  expect((await repo.findById(user.user_id))?.menu_hrefs).toBeNull();
  expect((await query("SELECT password_hash,pin_hash FROM users WHERE user_id=$1", [user.user_id]))[0]).toEqual({ password_hash: "hash", pin_hash: "pin" });
});
