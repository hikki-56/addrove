import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getPlannedLocations } from "@/server/services/planned-location.service";

let mockPlannedQuery: (sql: string, values: unknown[]) => Promise<unknown[]>;
jest.mock("@/server/repositories/postgres/database", () => ({
    query: (sql: string, values: unknown[]) => mockPlannedQuery(sql, values),
}));

let db: PGlite;
const migrationsDir = path.join(__dirname, "../supabase/migrations");
const migration = fs.readFileSync(path.join(migrationsDir, "20261111015526_planned_locations.sql"), "utf8");
const insert = `INSERT INTO planned_locations
    (warehouse_id, warehouse_prefix, block_number, rack_side, shelf_level)
    VALUES ($1, $2, $3, $4, $5) RETURNING *`;

beforeAll(async () => {
    db = new PGlite();
    mockPlannedQuery = async (sql, values) => (await db.query(sql, values)).rows;
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE stockify_app;");
    for (const file of fs.readdirSync(migrationsDir).filter(file => file.endsWith(".sql")).sort()) {
        await db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8")
            .replace("create extension if not exists pgcrypto;", ""));
    }
    for (let number = 1; number <= 6; number++) {
        await db.query("INSERT INTO warehouses(warehouse_id,warehouse_code,warehouse_name) VALUES($1,$2,$3)",
            [`wh-0${number}`, `WH-${number}`, `Warehouse ${number}`]);
    }
    await db.exec("INSERT INTO locations(location_id,warehouse_id,location_code) VALUES('legacy-location','wh-06','OLD-OFFICE')");
}, 30000);

afterEach(async () => {
    await db.exec("RESET ROLE; DELETE FROM planned_locations;");
});
afterAll(async () => { await db.close(); });

test("the barcode catalogue reads only planned rows and filters actual warehouse access", async () => {
    await db.query(`INSERT INTO planned_locations (warehouse_id,warehouse_prefix,block_number,rack_side,shelf_level,description)
        VALUES ('wh-01','K1',22,'A',1,''),('wh-06','K6',22,'A',1,'ชั้นอาคาร 2 | ชั้นวาง L1'),('wh-06','K6',31,'B',3,'ชั้นอาคาร 3 | ชั้นวาง L3')`);
    const before = (await db.query("SELECT * FROM planned_locations ORDER BY location_code")).rows;
    const all = await getPlannedLocations(null);
    expect(all.map(row => row.location_code)).toEqual(["K1-22-AL1", "K6-22-AL1", "K6-31-BL3"]);
    expect(all[1]).toMatchObject({ warehouse_name: "ออฟฟิศ", building_floor: 2, shelf_level: 1 });
    expect(all[0].building_floor).toBeNull();
    expect((await getPlannedLocations(["wh-6"])).map(row => row.location_code)).toEqual(["K6-22-AL1", "K6-31-BL3"]);
    expect(await getPlannedLocations([])).toEqual([]);
    expect((await db.query("SELECT * FROM planned_locations ORDER BY location_code")).rows).toEqual(before);
    expect((await db.query("SELECT location_code FROM locations")).rows).toEqual([{ location_code: "OLD-OFFICE" }]);
    expect((await db.query("SELECT * FROM stock_movements")).rows).toEqual([]);
});

test("migration starts empty and replay preserves planned and current location data", async () => {
    expect((await db.query("SELECT * FROM planned_locations")).rows).toEqual([]);
    const planned = (await db.query(insert, ["wh-06", "K6", 22, "A", 1])).rows;
    const current = (await db.query("SELECT * FROM locations")).rows;
    const stock = (await db.query("SELECT * FROM stock_summary")).rows;
    await db.exec(migration);
    expect((await db.query("SELECT * FROM planned_locations")).rows).toEqual(planned);
    expect((await db.query("SELECT * FROM locations")).rows).toEqual(current);
    expect((await db.query("SELECT * FROM stock_summary")).rows).toEqual(stock);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ location_code: "OLD-OFFICE" });
});

test("supports every warehouse, side and shelf, and derives the office example", async () => {
    for (let number = 1; number <= 6; number++) {
        for (const side of ["A", "B", "C"]) {
            for (let level = 1; level <= 3; level++) {
                const result = await db.query(insert, [`wh-0${number}`, `K${number}`, 22, side, level]);
                expect(result.rows[0]).toMatchObject({ location_code: `K${number}-22-${side}L${level}` });
            }
        }
    }
    expect((await db.query("SELECT * FROM planned_locations")).rows).toHaveLength(54);
    expect((await db.query("SELECT location_code FROM locations")).rows).toEqual([{ location_code: "OLD-OFFICE" }]);
    expect((await db.query("SELECT * FROM stock_summary")).rows).toEqual([]);
    expect((await db.query("SELECT * FROM stock_movements")).rows).toEqual([]);
});

test.each([
    ["wh-06", "K6", 0, "A", 1],
    ["wh-06", "K6", -1, "A", 1],
    ["wh-06", "K6", 22, "D", 1],
    ["wh-06", "K6", 22, "a", 1],
    ["wh-06", "K6", 22, "A", 0],
    ["wh-06", "K6", 22, "A", 4],
    ["wh-06", "6K", 22, "A", 1],
    ["wh-06", "K1", 22, "A", 1],
    ["wh-07", "K7", 22, "A", 1],
    ["wh-06", "K6", null, "A", 1],
])("rejects invalid or mismatched location components: %j %j %j %j %j", async (...values) => {
    await expect(db.query(insert, values)).rejects.toThrow();
});

test("rejects duplicate positions and derives the new code and timestamp after an edit", async () => {
    await db.query(insert, ["wh-06", "K6", 22, "A", 1]);
    await expect(db.query(insert, ["wh-06", "K6", 22, "A", 1])).rejects.toThrow();
    const result = await db.query(`UPDATE planned_locations SET rack_side='C', shelf_level=3,
        updated_at='2000-01-01' RETURNING location_code, updated_at > '2000-01-01'::timestamptz AS timestamp_updated`);
    expect(result.rows).toEqual([{ location_code: "K6-22-CL3", timestamp_updated: true }]);
    await expect(db.exec("UPDATE planned_locations SET location_code='K6-99-AL1'")).rejects.toThrow();
});

test("keeps RLS enabled, denies browser roles and permits the existing server role", async () => {
    const result = await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.planned_locations'::regclass");
    expect(result.rows).toEqual([{ relrowsecurity: true }]);
    for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role}`);
        try {
            await expect(db.query("SELECT * FROM planned_locations")).rejects.toThrow();
            await expect(db.query(insert, ["wh-06", "K6", 22, "A", 1])).rejects.toThrow();
        } finally {
            await db.exec("RESET ROLE");
        }
    }
    await db.exec("SET ROLE stockify_app");
    const inserted = await db.query(insert, ["wh-06", "K6", 22, "A", 1]);
    expect(inserted.rows[0]).toMatchObject({ location_code: "K6-22-AL1" });
    expect((await db.query("SELECT * FROM planned_locations")).rows).toHaveLength(1);
});
