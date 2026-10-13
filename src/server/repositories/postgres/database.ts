import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { SUPABASE_DATABASE_CA } from "./supabase-ca";
// Keep the domain's numeric and ISO-string contracts instead of pg's defaults.
types.setTypeParser(1700, Number);
types.setTypeParser(20, Number);
types.setTypeParser(1082, value => value);
types.setTypeParser(1184, value => new Date(value).toISOString());
type Transaction = {
    client: PoolClient;
    active: boolean;
    failed: boolean;
};
const transactions = new AsyncLocalStorage<Transaction>();
const state = globalThis as typeof globalThis & {
    stockifyPgPool?: Pool;
    stockifyPgUrl?: string;
};
export function getDatabasePool(): Pool {
    const url = process.env.DATABASE_URL?.trim();
    if (!url)
        throw new Error("DATABASE_URL is required for PostgreSQL storage");
    if (!state.stockifyPgPool || state.stockifyPgUrl !== url) {
        const parsed = new URL(url);
        const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
        // Do not let sslmode=require silently replace certificate verification.
        for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
            parsed.searchParams.delete(name);
        state.stockifyPgPool = new Pool({
            connectionString: parsed.toString(),
            ssl: local ? undefined : {
                rejectUnauthorized: true,
                ca: process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n") || (parsed.hostname.endsWith(".supabase.com") || parsed.hostname.endsWith(".supabase.co") ? SUPABASE_DATABASE_CA : undefined),
            },
            max: 3,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 10000,
            allowExitOnIdle: true,
        });
        state.stockifyPgUrl = url;
        state.stockifyPgPool.on("error", () => console.error("[Postgres] Idle connection failed"));
    }
    return state.stockifyPgPool;
}
export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
    const tx = transactions.getStore();
    if (tx && !tx.active)
        throw new Error("Database operation outlived its transaction; await all writes");
    try {
        const result = await (tx?.client ?? getDatabasePool()).query<T>(sql, values);
        return result.rows;
    }
    catch (error) {
        if (tx)
            tx.failed = true;
        throw error;
    }
}
/** All nested repository and tab writes share one connection and one commit. */
export async function withDatabaseTransaction<T>(action: () => Promise<T>): Promise<T> {
    const parent = transactions.getStore();
    if (parent) {
        if (!parent.active)
            throw new Error("Database transaction has ended");
        try {
            return await action();
        }
        catch (error) {
            parent.failed = true;
            throw error;
        }
    }
    const client = await getDatabasePool().connect();
    const tx: Transaction = { client, active: true, failed: false };
    try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '15s'");
        await client.query("SET LOCAL statement_timeout = '45s'");
        // One ordered writer protects legacy row positions and cross-domain workflows
        // across serverless instances during migration. Reads remain concurrent.
        await client.query("SELECT pg_advisory_xact_lock(1937006964, 1)");
        const result = await transactions.run(tx, action);
        if (tx.failed)
            throw new Error("Database transaction failed; no changes were committed");
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    }
    finally {
        tx.active = false;
        client.release();
    }
}
export async function insertRow<T extends QueryResultRow>(table: string, row: Record<string, unknown>): Promise<T> {
    const entries = Object.entries(row).filter(([, value]) => value !== undefined);
    const columns = entries.map(([key]) => identifier(key)).join(", ");
    const params = entries.map((_, i) => `$${i + 1}`).join(", ");
    const [result] = await query<T>(`INSERT INTO ${identifier(table)} (${columns}) VALUES (${params}) RETURNING *`, entries.map(([, v]) => jsonValue(v)));
    return result;
}
export async function updateRecord<T extends QueryResultRow>(table: string, key: string, id: string, changes: Record<string, unknown>, allowed: readonly string[]): Promise<T | null> {
    const entries = Object.entries(changes).filter(([name, value]) => allowed.includes(name) && value !== undefined);
    if (!entries.length)
        return (await query<T>(`SELECT * FROM ${identifier(table)} WHERE ${identifier(key)} = $1`, [id]))[0] ?? null;
    const sets = entries.map(([name], i) => `${identifier(name)} = $${i + 2}`).join(", ");
    return (await query<T>(`UPDATE ${identifier(table)} SET ${sets} WHERE ${identifier(key)} = $1 RETURNING *`, [id, ...entries.map(([, v]) => jsonValue(v))]))[0] ?? null;
}
export function identifier(value: string): string {
    if (!/^[a-z_][a-z0-9_]*$/.test(value))
        throw new Error("Invalid database identifier");
    return `"${value}"`;
}
function jsonValue(value: unknown): unknown {
    return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
}
