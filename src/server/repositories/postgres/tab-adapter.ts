import { identifier, insertRow, query, updateRecord, withDatabaseTransaction } from "./database";
import { resolveLocationId, resolveProductId, resolveWarehouseId } from "./stock.repository";
type Cell = string | number | boolean;
type Row = Record<string, unknown>;
type Mapping = {
    table: string;
    key: string;
    columns: string[];
    numeric?: string[];
    boolean?: string[];
    json?: string[];
    nullable?: string[];
};
const columns = (value: string) => value.split(",");
export const TAB_MAPPINGS: Record<string, Mapping> = {
    Warehouses: { table: "warehouses", key: "warehouse_id", columns: columns("warehouse_id,warehouse_code,warehouse_name,address,active,created_at,updated_at"), boolean: ["active"] },
    Locations: { table: "locations", key: "location_id", columns: columns("location_id,warehouse_id,location_code,location_name,description,active,created_at,updated_at"), boolean: ["active"] },
    Shelves: { table: "shelves", key: "shelf_id", columns: columns("shelf_id,location_id,shelf_code,shelf_name,shelf_level,active,created_at,updated_at"), boolean: ["active"] },
    Documents: { table: "documents", key: "document_id", columns: columns("document_id,document_no,document_type,reference_no,document_date,status,note,created_by,created_at,transfer_progress"), json: ["transfer_progress"], nullable: ["transfer_progress"] },
    StockMovements: { table: "stock_movements", key: "movement_id", columns: columns("movement_id,document_id,product_id,warehouse_id,location_id,qty_change,movement_type,idempotency_key,created_by,created_at"), numeric: ["qty_change"] },
    StockSummary: { table: "stock_summary", key: "", columns: columns("product_id,warehouse_id,location_id,quantity,last_updated"), numeric: ["quantity"] },
    StockCounts: { table: "stock_counts", key: "count_id", columns: columns("count_id,count_no,product_id,warehouse_id,location_id,system_qty,counted_qty,difference,status,counted_by,counted_at,approved_by,approved_at"), numeric: ["system_qty", "counted_qty", "difference"], nullable: ["counted_qty", "difference", "counted_by", "counted_at", "approved_by", "approved_at"] },
    Idempotency: { table: "idempotency_records", key: "key", columns: columns("key,operation_type,actor_id,payload_hash,status,response_payload,error_message,created_at,updated_at") },
    AuditLogs: { table: "audit_logs", key: "audit_id", columns: columns("audit_id,correlation_id,idempotency_key,actor_id,actor_role,action,resource_type,resource_id,warehouse_id,timestamp,outcome,error_code,metadata"), json: ["metadata"], nullable: ["metadata"] },
    OperationJournal: { table: "operation_journal", key: "operation_id", columns: columns("operation_id,idempotency_key,operation_type,payload_hash,actor_id,steps,completed_steps,status,retry_count,last_error,created_at,updated_at"), json: ["steps", "completed_steps"], numeric: ["retry_count"] },
    "ประวัติการเข้าระบบ": { table: "login_logs", key: "id", columns: columns("id,user_id,user_name,user_email,user_role,login_method,login_at,ip_address,user_agent") },
    ProductionJobs: { table: "production_jobs", key: "job_id", columns: columns("job_id,job_no,production_date,status,table_no,priority,product_id,sku,product_name,unit,target_qty,note,location,created_by,created_by_name,created_at,submitted_at,started_by_name,started_at,completed_at,cancelled_at,cancelled_by_name,cancel_reason,close_reason,reopen_reason,reopen_count,updated_at"), numeric: ["table_no", "target_qty", "reopen_count"], nullable: ["submitted_at", "started_at", "completed_at", "cancelled_at"] },
    ProductionReports: { table: "production_reports", key: "report_id", columns: columns("report_id,job_no,report_no,kind,report_kind,good_qty,defect_qty,defect_cause,reason,note,photo_url,reported_by,reported_by_name,reported_at,cumulative_good,cumulative_defect,idempotency_key"), numeric: ["report_no", "good_qty", "defect_qty", "cumulative_good", "cumulative_defect"] },
    ProductionHistory: { table: "production_history", key: "history_id", columns: columns("history_id,job_no,action,actor_id,actor_name,at,reason,detail") },
    ProductionNotifications: { table: "production_notifications", key: "notif_id", columns: columns("notif_id,target_role,job_no,message,created_at,created_by_name,read_by"), json: ["read_by"] },
};
export function mappingFor(name: string): Mapping | null {
    const entry = Object.entries(TAB_MAPPINGS).find(([key]) => key.toLowerCase() === name.toLowerCase());
    return entry?.[1] ?? null;
}
export function cellsToRecord(mapping: Mapping, cells: Cell[]): Row {
    const row: Row = {};
    mapping.columns.forEach((name, index) => {
        const value = cells[index] ?? "";
        if (mapping.nullable?.includes(name) && value === "")
            row[name] = null;
        else if (mapping.numeric?.includes(name)) {
            const number = Number(String(value).replace(/,/g, ""));
            if (!Number.isFinite(number))
                throw new Error(`Invalid ${mapping.table}.${name}`);
            row[name] = number;
        }
        else if (mapping.boolean?.includes(name))
            row[name] = /^(true|1|yes|active)$/i.test(String(value));
        else if (mapping.json?.includes(name))
            row[name] = value === "" ? [] : JSON.parse(String(value));
        else
            row[name] = String(value);
    });
    return row;
}
export function recordToCells(mapping: Mapping, row: Row): string[] {
    const cells = Array.isArray(row.source_cells) ? row.source_cells.map(String) : [];
    mapping.columns.forEach((name, i) => { const value = row[name]; cells[i] = value == null ? "" : mapping.json?.includes(name) ? JSON.stringify(value) : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value); });
    return cells;
}
function columnIndex(value: string): number {
    let n = 0;
    for (const c of value.toUpperCase())
        n = n * 26 + c.charCodeAt(0) - 64;
    return n - 1;
}
export function sliceRange(rows: string[][], range?: string): string[][] {
    if (!range)
        return rows.slice(1);
    const match = range.replace(/^.*!/, "").match(/^([A-Z]+)(\d+)?(?::([A-Z]+)?(\d+)?)?$/i);
    if (!match)
        throw new Error(`Unsupported storage range ${range}`);
    const firstRow = Number(match[2] || 1) - 1;
    const lastRow = match[4] ? Number(match[4]) : rows.length;
    const firstColumn = columnIndex(match[1]);
    const lastColumn = match[3] ? columnIndex(match[3]) + 1 : undefined;
    return rows.slice(firstRow, lastRow).map(row => row.slice(firstColumn, lastColumn));
}
const warehouseNumber = (name: string) => name.match(/^(?:โกดัง|WH|Warehouse)\s*-?\s*0*(\d+)$/i)?.[1] ?? (name === "สำนักงานใหญ่" ? "6" : null);
export async function ensurePostgresTab(name: string, headers: string[] = []): Promise<string> {
    await query("INSERT INTO storage_tabs(name,headers) VALUES($1,$2::jsonb) ON CONFLICT(name) DO NOTHING", [name, JSON.stringify(headers)]);
    return name;
}
export async function postgresTabId(name: string): Promise<number | null> { return (await query("SELECT tab_id FROM storage_tabs WHERE name=$1", [name]))[0]?.tab_id ?? null; }
async function warehouseRows(name: string): Promise<string[][]> {
    const wh = await resolveWarehouseId(`wh-${warehouseNumber(name)}`);
    const data = await query("SELECT s.*,p.sku,p.barcode,p.product_name,p.category,p.base_unit,p.supplier,l.location_code FROM stock_summary s JOIN products p USING(product_id) JOIN locations l USING(location_id) WHERE s.warehouse_id=$1 AND (s.listed_in_warehouse OR s.quantity<>0) ORDER BY s.source_row", [wh]);
    return [["รหัสสินค้า", "บาร์โค้ด", "ชื่อสินค้า", "หมวดสินค้า", "หน่วย", "จำนวนคงเหลือ", "ตำแหน่ง", "ผู้จัดจำหน่าย", "อัปเดตเมื่อ"], ...data.map(r => [r.sku, r.barcode, r.product_name, r.category, r.base_unit, String(r.quantity), r.location_code, r.supplier || "", r.last_updated])];
}
export async function readPostgresTab(name: string, range?: string, options?: {
    keepHeader?: boolean;
}): Promise<string[][]> {
    let rows: string[][];
    if (warehouseNumber(name))
        rows = await warehouseRows(name);
    else if (name.toUpperCase() === "PRODUCTS") {
        const data = await query("SELECT * FROM products ORDER BY source_row");
        rows = [["ลำดับ", "ผู้จัดจำหน่าย", "รหัสสินค้า", "รหัสนำหน้า 4 หลัก", "รายละเอียด", "หมวดสินค้า", "บาร์โค้ด"], ...data.map((r, i) => [String(i + 1), r.supplier || "", r.sku, r.sku.slice(0, 4), r.product_name, r.category, r.barcode])];
    }
    else if (name.toLowerCase() === "users") {
        const data = await query("SELECT * FROM users ORDER BY source_row");
        rows = [["user_id", "username", "password_hash", "role", "first_name", "last_name", "email", "phone", "active", "created_at", "updated_at", "pin_hash", "warehouse_access", "menu_hrefs"], ...data.map(r => [r.user_id, r.email.split("@")[0], r.password_hash, r.role, r.full_name.split(" ")[0], r.full_name.split(" ").slice(1).join(" "), r.email, "", r.active ? "TRUE" : "FALSE", r.created_at, r.updated_at, r.pin_hash, JSON.stringify(r.warehouse_access), r.menu_hrefs == null ? "" : JSON.stringify(r.menu_hrefs)])];
    }
    else {
        const mapping = mappingFor(name);
        const [tab] = await query("SELECT * FROM storage_tabs WHERE lower(name)=lower($1) LIMIT 1", [name]);
        if (mapping) {
            const data = await query(`SELECT * FROM ${identifier(mapping.table)} ${mapping.table === "production_jobs" ? "WHERE deleted_at IS NULL" : ""} ORDER BY source_row`);
            rows = [(tab?.headers as string[]) || mapping.columns];
            for (const row of data) {
                while (rows.length < Number(row.source_row))
                    rows.push([]);
                rows[Number(row.source_row) - 1] = recordToCells(mapping, row);
            }
        }
        else {
            if (!tab)
                throw new Error(`Storage tab ${name} was not migrated`);
            rows = [tab.headers];
            const data = await query("SELECT row_no,cells FROM storage_rows WHERE tab_id=$1 ORDER BY row_no", [tab.tab_id]);
            for (const row of data) {
                while (rows.length < row.row_no)
                    rows.push([]);
                rows[row.row_no - 1] = row.cells.map(String);
            }
        }
    }
    return options?.keepHeader ? (range ? sliceRange(rows, range) : rows) : sliceRange(rows, range);
}
async function updateWarehouseRow(name: string, rowNumber: number, cells: Cell[]): Promise<void> {
    const wh = await resolveWarehouseId(`wh-${warehouseNumber(name)}`);
    const rows = await query("SELECT * FROM stock_summary WHERE warehouse_id=$1 AND (listed_in_warehouse OR quantity<>0) ORDER BY source_row", [wh]);
    const product = await resolveProductId(String(cells[0]));
    const loc = await resolveLocationId(wh, String(cells[6] || ""), true);
    const existing = rows[rowNumber - 2];
    if (existing && (existing.product_id !== product || existing.location_id !== loc))
        throw new Error("Warehouse row identity changed; use a stock transfer to change locations");
    const quantity = Number(String(cells[5]).replace(/,/g, ""));
    if (!Number.isFinite(quantity) || quantity < 0)
        throw new Error("Invalid warehouse quantity");
    await query("INSERT INTO stock_summary(product_id,warehouse_id,location_id,quantity) VALUES($1,$2,$3,$4) ON CONFLICT(product_id,warehouse_id,location_id) DO UPDATE SET quantity=excluded.quantity,last_updated=now()", [product, wh, loc, quantity]);
}
export async function appendPostgresRows(name: string, values: Cell[][]): Promise<void> {
    await withDatabaseTransaction(async () => {
        if (warehouseNumber(name)) {
            const rows = await warehouseRows(name);
            for (let i = 0; i < values.length; i++)
                await updateWarehouseRow(name, rows.length + i + 1, values[i]);
            return;
        }
        const mapping = mappingFor(name);
        if (mapping) {
            for (const cells of values)
                await insertRow(mapping.table, { ...cellsToRecord(mapping, cells), source_cells: cells });
            return;
        }
        if (name.toUpperCase() === "PRODUCTS" || name.toLowerCase() === "users")
            throw new Error("Use the typed repository to write master data");
        await ensurePostgresTab(name);
        const tabId = await postgresTabId(name);
        const [{ next }] = await query("SELECT coalesce(max(row_no),1)+1 AS next FROM storage_rows WHERE tab_id=$1", [tabId]);
        for (let i = 0; i < values.length; i++)
            await query("INSERT INTO storage_rows(tab_id,row_no,cells) VALUES($1,$2,$3::jsonb)", [tabId, next + i, JSON.stringify(values[i])]);
    });
}
export async function updatePostgresRows(name: string, updates: {
    rowNumber: number;
    values: Cell[];
}[]): Promise<void> {
    await withDatabaseTransaction(async () => {
        for (const update of updates) {
            if (!Number.isInteger(update.rowNumber) || update.rowNumber < 2)
                throw new Error("Invalid row number");
            if (warehouseNumber(name)) {
                await updateWarehouseRow(name, update.rowNumber, update.values);
                continue;
            }
            const mapping = mappingFor(name);
            if (mapping) {
                const [old] = await query(`SELECT * FROM ${identifier(mapping.table)} WHERE source_row=$1 FOR UPDATE`, [update.rowNumber]);
                if (!old)
                    throw new Error(`Missing ${name} row ${update.rowNumber}`);
                const merged = recordToCells(mapping, old);
                update.values.forEach((v, i) => { merged[i] = String(v); });
                const changes = cellsToRecord(mapping, merged);
                delete changes[mapping.key];
                await updateRecord(mapping.table, mapping.key, String(old[mapping.key]), { ...changes, source_cells: merged }, [...mapping.columns.filter(c => c !== mapping.key), "source_cells"]);
            }
            else {
                const tabId = await postgresTabId(name);
                if (!tabId)
                    throw new Error(`Missing storage tab ${name}`);
                const [old] = await query("SELECT cells FROM storage_rows WHERE tab_id=$1 AND row_no=$2", [tabId, update.rowNumber]);
                const merged: Cell[] = old?.cells || [];
                update.values.forEach((v, i) => { merged[i] = v; });
                await query("INSERT INTO storage_rows(tab_id,row_no,cells) VALUES($1,$2,$3::jsonb) ON CONFLICT(tab_id,row_no) DO UPDATE SET cells=excluded.cells", [tabId, update.rowNumber, JSON.stringify(merged)]);
            }
        }
    });
}
export async function updatePostgresProgress(rowNumber: number, progress: string): Promise<void> { await query("UPDATE documents SET transfer_progress=$2::jsonb WHERE source_row=$1 AND status='PENDING'", [rowNumber, progress]); }
export async function deletePostgresRows(name: string, indices: number[]): Promise<void> {
    await withDatabaseTransaction(async () => {
        const mapping = mappingFor(name);
        if (mapping) {
            if (mapping.table === "production_jobs")
                await query("UPDATE production_jobs SET deleted_at=now() WHERE source_row=ANY($1::bigint[]) AND status='DRAFT'", [indices.map(i => i + 1)]);
            else
                await query(`DELETE FROM ${identifier(mapping.table)} WHERE source_row=ANY($1::bigint[])`, [indices.map(i => i + 1)]);
            return;
        }
        const tabId = await postgresTabId(name);
        if (!tabId)
            throw new Error(`Missing storage tab ${name}`);
        await query("DELETE FROM storage_rows WHERE tab_id=$1 AND row_no=ANY($2::integer[])", [tabId, indices.map(i => i + 1)]);
        // Leave holes: row numbers already read by another operation remain stable.
    });
}
