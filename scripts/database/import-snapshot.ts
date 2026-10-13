import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { buildMigrationModel, type Snapshot, type MigrationModel } from "./migration-model";
import { identifier } from "@/server/repositories/postgres/database";
type Execute = (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;
export const IMPORT_ORDER = ["warehouses", "products", "locations", "shelves", "users", "documents", "stock_movements", "stock_summary", "stock_counts", "idempotency_records", "audit_logs", "operation_journal", "login_logs", "bom_formulas", "bom_formula_items", "production_jobs", "production_reports", "production_history", "production_notifications"];
export async function importSnapshot(snapshot: Snapshot, model: MigrationModel, execute: Execute): Promise<void> {
    if (model.errors.length)
        throw new Error("Source preflight has errors; import is blocked");
    const previous = await execute("SELECT verified_at FROM migration_snapshots WHERE snapshot_id=$1", [snapshot.checksum]);
    if (previous[0]?.verified_at)
        return;
    for (const table of IMPORT_ORDER) {
        const [{ count }] = await execute(`SELECT count(*)::integer AS count FROM ${identifier(table)}`);
        if (Number(count) > 0)
            throw new Error(`Target table ${table} is not empty; refusing to overwrite existing data`);
    }
    await execute("INSERT INTO migration_snapshots(snapshot_id,source_id,checksum,manifest) VALUES($1,$2,$1,$3::jsonb)", [snapshot.checksum, snapshot.sourceId, JSON.stringify({ capturedAt: snapshot.capturedAt, sourceCounts: model.sourceCounts, stockTotals: model.stockTotals, warnings: model.warnings })]);
    for (const table of IMPORT_ORDER) {
        const rows = model.tables[table] || [];
        if (!rows.length)
            continue;
        let next = Math.max(1, ...rows.map(r => Number(r.source_row) || 0)) + 1;
        const normalized = rows.map(row => ({ ...row, source_row: row.source_row ?? next++ }));
        const names = [...new Set(normalized.flatMap(row => Object.keys(row)))];
        const projection = names.map(identifier).join(",");
        for (let i = 0; i < normalized.length; i += 300) {
            await execute(`INSERT INTO ${identifier(table)} (${projection}) SELECT ${projection} FROM jsonb_populate_recordset(NULL::${identifier(table)},$1::jsonb)`, [JSON.stringify(normalized.slice(i, i + 300))]);
        }
        await execute(`SELECT setval(pg_get_serial_sequence($1,'source_row'),(SELECT greatest(coalesce(max(source_row),1),1) FROM ${identifier(table)}),true)`, [table]);
        if (table === "bom_formula_items")
            await execute("SELECT setval(pg_get_serial_sequence('bom_formula_items','bom_item_id'),(SELECT greatest(coalesce(max(bom_item_id),1),1) FROM bom_formula_items),true)");
    }
    // Every original cell and formula is archived, including skipped/duplicate rows.
    for (const tab of snapshot.tabs) {
        const [{ tab_id }] = await execute("INSERT INTO storage_tabs(name,headers,source_name) VALUES($1,$2::jsonb,$1) RETURNING tab_id", [tab.name, JSON.stringify(tab.values[0] || [])]);
        const rows = tab.values.slice(1).map((cells, i) => ({ row_no: i + 2, cells, formulas: tab.formulas[i + 1] || [] }));
        for (let i = 0; i < rows.length; i += 500)
            await execute("INSERT INTO storage_rows(tab_id,row_no,cells,formulas) SELECT $1,row_no,cells,formulas FROM jsonb_to_recordset($2::jsonb) AS r(row_no integer,cells jsonb,formulas jsonb)", [tab_id, JSON.stringify(rows.slice(i, i + 500))]);
    }
    await execute("INSERT INTO document_sequences(document_type,last_value) SELECT document_type::text,max(coalesce(substring(document_no from '-([0-9]+)$')::bigint,0)) FROM documents WHERE document_no ~ '^[A-Z]+-[0-9]{8}-[0-9]+$' GROUP BY document_type ON CONFLICT(document_type) DO UPDATE SET last_value=greatest(document_sequences.last_value,excluded.last_value)");
    await verifySnapshot(snapshot, model, execute);
    await execute("UPDATE migration_snapshots SET verified_at=now() WHERE snapshot_id=$1", [snapshot.checksum]);
}
export async function verifySnapshot(snapshot: Snapshot, model: MigrationModel, execute: Execute): Promise<void> {
    for (const table of IMPORT_ORDER) {
        const [{ count }] = await execute(`SELECT count(*)::integer AS count FROM ${identifier(table)}`);
        if (Number(count) !== (model.tables[table]?.length || 0))
            throw new Error(`Verification failed: ${table} count`);
    }
    for (const [warehouseId, quantity] of Object.entries(model.stockTotals)) {
        const [{ total }] = await execute("SELECT coalesce(sum(quantity),0)::text AS total FROM stock_summary WHERE warehouse_id=$1", [warehouseId]);
        if (Math.abs(Number(total) - quantity) > 0.0001)
            throw new Error("Verification failed: warehouse stock total");
    }
    for (const tab of snapshot.tabs) {
        const [row] = await execute("SELECT tab_id,headers FROM storage_tabs WHERE name=$1", [tab.name]);
        if (JSON.stringify(row.headers) !== JSON.stringify(tab.values[0] || []))
            throw new Error("Verification failed: original headers");
        const stored = await execute("SELECT row_no,cells,formulas FROM storage_rows WHERE tab_id=$1 ORDER BY row_no", [row.tab_id]);
        if (stored.length !== Math.max(0, tab.values.length - 1))
            throw new Error("Verification failed: original row count");
        stored.forEach((r, i) => {
            if (Number(r.row_no) !== i + 2 || JSON.stringify(r.cells) !== JSON.stringify(tab.values[i + 1]) || JSON.stringify(r.formulas) !== JSON.stringify(tab.formulas[i + 1] || []))
                throw new Error("Verification failed: original cells/formulas");
        });
    }
}
async function main() {
    loadEnvConfig(process.cwd());
    // Use an isolated connection file during preparation, before changing .env.local.
    process.loadEnvFile(".env.supabase.local");
    const snapshot = JSON.parse(readFileSync(process.argv.find(a => a.endsWith(".json")) || "data/migrations/sheets-snapshot.json", "utf8")) as Snapshot;
    const model = buildMigrationModel(snapshot);
    console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "APPLY" : "PREFLIGHT", tableCounts: Object.fromEntries(IMPORT_ORDER.map(t => [t, model.tables[t]?.length || 0])), warnings: model.warnings, errorCount: model.errors.length }));
    if (model.errors.length)
        throw new Error("Source preflight has errors");
    if (!process.argv.includes("--apply"))
        return;
    const { query, withDatabaseTransaction, getDatabasePool } = await import("@/server/repositories/postgres/database");
    try {
        await withDatabaseTransaction(() => importSnapshot(snapshot, model, query));
        console.log(JSON.stringify({ status: "IMPORTED_AND_VERIFIED", checksum: snapshot.checksum, stockTotals: model.stockTotals }));
    }
    finally {
        await getDatabasePool().end();
    }
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/import-snapshot.ts"))
    void main().catch(error => {
        const details = error as {
            code?: string;
            constraint?: string;
            table?: string;
        };
        console.error(JSON.stringify({ status: "IMPORT_FAILED", code: details.code || "VALIDATION", constraint: details.constraint, table: details.table }));
        process.exitCode = 1;
    });
