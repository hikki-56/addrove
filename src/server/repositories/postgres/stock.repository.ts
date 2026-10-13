import { randomUUID } from "node:crypto";
import type { IStockRepository, DocumentMutator, ProductSyncInfo } from "@/server/repositories/interfaces";
import type { CreateLocationInput, CreateProductInput, CreateShelfInput, CreateStockCountInput, CreateWarehouseInput, MovementFilterInput, UpdateLocationInput, UpdateProductInput, UpdateShelfInput } from "@/types/api";
import type { Document, DocumentType, Location, Product, Shelf, StockCount, StockMovement, StockSummary, User, Warehouse, MovementWithDetails } from "@/types/models";
import type { IdempotencyRecord } from "@/server/repositories/interfaces/idempotency.repository.interface";
import type { OperationRecord } from "@/server/repositories/interfaces/operation-journal.repository.interface";
import type { AuditLogEntry } from "@/server/repositories/interfaces/audit.repository.interface";
import { SheetsDashboardRepository } from "@/server/repositories/sheets/dashboard.repository";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";
import type { QueryResultRow } from "pg";
import { insertRow as insertDatabaseRow, query as queryDatabase, updateRecord as updateDatabaseRecord, withDatabaseTransaction } from "./database";
import { InsufficientStockError, StockNotFoundError, InvalidStockLocationError, StockValidationError } from "@/server/services/stock/stock-errors";
function domainRow<T extends QueryResultRow>(row: T): T {
    const result = { ...row };
    for (const key of ["source_row", "source_cells", "legacy_ids", "migrated", "opening_quantity", "listed_in_warehouse", "deleted_at"])
        delete result[key];
    return result;
}
async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
    return (await queryDatabase<T>(sql, values)).map(domainRow);
}
async function insertRow<T extends QueryResultRow>(table: string, row: Record<string, unknown>): Promise<T> {
    return domainRow(await insertDatabaseRow<T>(table, row));
}
async function updateRecord<T extends QueryResultRow>(table: string, key: string, id: string, changes: Record<string, unknown>, allowed: readonly string[]): Promise<T | null> {
    const row = await updateDatabaseRecord<T>(table, key, id, changes, allowed);
    return row ? domainRow(row) : null;
}
const id = (prefix: string) => `${prefix}-${randomUUID()}`;
const compactWh = (value: string) => normalizeWarehouseId(value).replace(/^wh-0/, "wh-");
const prefixes: Record<DocumentType, string> = { OPENING: "OP", RECEIVE: "RCV", RECEIVE_PLAN: "PLN", ISSUE: "ISS", MOVE: "MOV", TRANSFER: "TRF", ADJUST: "ADJ", REVERSAL: "REV", OUTBOUND_ORDER: "BIL", OUTBOUND_BOX: "BX", SHIPMENT: "SHP", WORK_ORDER: "TV" };
export async function resolveWarehouseId(value: string): Promise<string> {
    const [row] = await query("SELECT warehouse_id FROM warehouses WHERE warehouse_id=$1 OR regexp_replace(lower(warehouse_id),'^wh-0*','wh-')=$2 OR lower(warehouse_code)=lower($1) LIMIT 1", [value, compactWh(value)]);
    if (!row)
        throw new StockNotFoundError(`ไม่พบโกดัง ${value}`);
    return row.warehouse_id;
}
export async function resolveProductId(value: string): Promise<string> {
    const [row] = await query("SELECT product_id FROM products WHERE lower(product_id)=lower($1) OR lower(sku)=lower($2) OR lower(barcode)=lower($2) OR legacy_ids ? $1 ORDER BY (product_id=$1) DESC LIMIT 1", [value, value.replace(/^prod-/, "")]);
    if (!row)
        throw new StockNotFoundError(`ไม่พบสินค้า ${value}`);
    return row.product_id;
}
export async function resolveLocationId(warehouseId: string, value: string, create = false): Promise<string | null> {
    const code = value.trim().replace(/^loc-/, "");
    const [row] = await query("SELECT location_id FROM locations WHERE warehouse_id=$1 AND (location_id=$2 OR lower(location_code)=lower($3) OR legacy_ids ? $2) ORDER BY (location_id=$2) DESC,source_row LIMIT 1", [warehouseId, value, code]);
    if (row)
        return row.location_id;
    if (!create)
        return null;
    if (code)
        throw new InvalidStockLocationError(`ไม่พบตำแหน่ง ${value} ในโกดัง ${warehouseId}`);
    await query("INSERT INTO locations(location_id,warehouse_id,location_code,location_name) VALUES($1,$2,'','ไม่ระบุ') ON CONFLICT (warehouse_id,location_code) DO NOTHING", [`loc-${warehouseId}-unassigned`, warehouseId]);
    return (await query("SELECT location_id FROM locations WHERE warehouse_id=$1 AND location_code=''", [warehouseId]))[0].location_id;
}
export class PostgresWarehouseRepository {
    async findAll(): Promise<Warehouse[]> { return query("SELECT * FROM warehouses ORDER BY source_row"); }
    async findById(value: string): Promise<Warehouse | null> { return (await query<Warehouse>("SELECT * FROM warehouses WHERE warehouse_id=$1 OR regexp_replace(lower(warehouse_id),'^wh-0*','wh-')=$2 LIMIT 1", [value, compactWh(value)]))[0] ?? null; }
    async findByCode(value: string): Promise<Warehouse | null> { return (await query<Warehouse>("SELECT * FROM warehouses WHERE lower(warehouse_code)=lower($1)", [value]))[0] ?? null; }
    async create(input: CreateWarehouseInput): Promise<Warehouse> { return insertRow("warehouses", { ...input, warehouse_id: id("wh") }); }
}
export class PostgresLocationRepository {
    async findAll(warehouseId?: string): Promise<Location[]> { return query("SELECT l.*,s.shelf_code,s.shelf_name FROM locations l LEFT JOIN LATERAL (SELECT shelf_code,shelf_name FROM shelves WHERE location_id=l.location_id AND active=true ORDER BY source_row LIMIT 1) s ON true WHERE ($1::text IS NULL OR l.warehouse_id=$1) ORDER BY l.source_row", [warehouseId ? await resolveWarehouseId(warehouseId) : null]); }
    async findById(value: string): Promise<Location | null> { return (await query<Location>("SELECT * FROM locations WHERE location_id=$1", [value]))[0] ?? null; }
    async findByCode(value: string): Promise<Location | null> { return (await query<Location>("SELECT * FROM locations WHERE lower(location_code)=lower($1) ORDER BY source_row LIMIT 1", [value]))[0] ?? null; }
    async create(input: CreateLocationInput): Promise<Location> { return insertRow("locations", { ...input, warehouse_id: await resolveWarehouseId(input.warehouse_id), location_id: id("loc"), location_code: input.location_code || [input.zone, input.aisle, input.rack, input.shelf, input.bin].filter(Boolean).join("-") || id("LOC") }); }
    async update(value: string, input: UpdateLocationInput): Promise<Location | null> { return updateRecord("locations", "location_id", value, { ...input, ...(input.warehouse_id ? { warehouse_id: await resolveWarehouseId(input.warehouse_id) } : {}) }, ["warehouse_id", "location_code", "location_name", "zone", "aisle", "rack", "shelf", "bin", "description", "active"]); }
}
export class PostgresShelfRepository {
    async findAll(locationId?: string): Promise<Shelf[]> { return query("SELECT * FROM shelves WHERE ($1::text IS NULL OR location_id=$1) ORDER BY source_row", [locationId ?? null]); }
    async findById(value: string): Promise<Shelf | null> { return (await query<Shelf>("SELECT * FROM shelves WHERE shelf_id=$1", [value]))[0] ?? null; }
    async findByCode(value: string): Promise<Shelf | null> { return (await query<Shelf>("SELECT * FROM shelves WHERE lower(shelf_code)=lower($1) ORDER BY source_row LIMIT 1", [value]))[0] ?? null; }
    async create(input: CreateShelfInput): Promise<Shelf> { return insertRow("shelves", { ...input, shelf_id: id("sh") }); }
    async update(value: string, input: UpdateShelfInput): Promise<Shelf | null> { return updateRecord("shelves", "shelf_id", value, input, ["location_id", "shelf_code", "shelf_name", "shelf_level", "active"]); }
}
export class PostgresProductRepository {
    async findAll(opts?: {
        activeOnly?: boolean;
    }): Promise<Product[]> { return query("SELECT * FROM products WHERE ($1=false OR active=true) ORDER BY source_row", [Boolean(opts?.activeOnly)]); }
    async findById(value: string): Promise<Product | null> { return (await query<Product>("SELECT * FROM products WHERE lower(product_id)=lower($1) OR lower(sku)=lower($2) OR lower(barcode)=lower($2) OR legacy_ids ? $1 ORDER BY (product_id=$1) DESC LIMIT 1", [value, value.replace(/^prod-/, "")]))[0] ?? null; }
    async findBySku(value: string): Promise<Product | null> { return (await query<Product>("SELECT * FROM products WHERE lower(sku)=lower($1)", [value]))[0] ?? null; }
    async findByBarcode(value: string): Promise<Product | null> { return (await query<Product>("SELECT * FROM products WHERE lower(barcode)=lower($1)", [value]))[0] ?? null; }
    async create(input: CreateProductInput): Promise<Product> {
        const { warehouse_id: _warehouse, initial_quantity: _initial, ...master } = input;
        return insertRow("products", { product_id: `prod-${input.sku}`, ...master, barcode: input.barcode || input.sku });
    }
    async update(value: string, input: UpdateProductInput): Promise<Product | null> { return updateRecord("products", "product_id", await resolveProductId(value), input, ["sku", "barcode", "product_name", "category", "base_unit", "minimum_stock", "description", "supplier", "location", "active", "created_by", "created_by_name"]); }
    async hasMovements(value: string): Promise<boolean> { return (await query("SELECT EXISTS(SELECT 1 FROM stock_movements WHERE product_id=$1) AS found", [await resolveProductId(value)]))[0].found; }
}
function documentFromRow(row: Record<string, unknown>): Document {
    const { transfer_progress, ...fields } = row;
    const doc = fields as unknown as Document;
    if (doc.document_type === "TRANSFER" && doc.status === "PENDING" && transfer_progress) {
        const progress = transfer_progress as Record<string, unknown>;
        let note: Record<string, unknown>;
        try {
            note = JSON.parse(doc.note || "{}");
        }
        catch {
            note = { original_note: doc.note };
        }
        if (Number(progress.current_step) >= (Number(note.current_step) || 0))
            return { ...doc, note: JSON.stringify({ ...note, current_step: progress.current_step, current_step_text: progress.current_step_text, last_active_at: progress.last_active_at, last_active_user_id: progress.last_active_user_id }) };
    }
    return doc;
}
export class PostgresDocumentRepository {
    async findAll(filters?: MovementFilterInput): Promise<{
        data: Document[];
        total: number;
    }> {
        const args: unknown[] = [];
        const terms: string[] = [];
        for (const [column, value, operator] of [["document_type", filters?.document_type, "="], ["document_no", filters?.document_no, "ILIKE"], ["document_date", filters?.date_from, ">="], ["document_date", filters?.date_to, "<="]] as const) {
            if (value) {
                args.push(operator === "ILIKE" ? `%${value}%` : value);
                terms.push(`${column} ${operator} $${args.length}`);
            }
        }
        const where = terms.length ? `WHERE ${terms.join(" AND ")}` : "";
        const [{ total }] = await query(`SELECT count(*)::integer AS total FROM documents ${where}`, args);
        const limit = filters?.limit ?? 100;
        const offset = ((filters?.page ?? 1) - 1) * limit;
        const rows = await query(`SELECT * FROM documents ${where} ORDER BY created_at DESC,source_row DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, limit, offset]);
        return { data: rows.map(documentFromRow), total };
    }
    async findById(value: string): Promise<Document | null> { const [row] = await query("SELECT * FROM documents WHERE document_id=$1", [value]); return row ? documentFromRow(row) : null; }
    async findByNo(value: string): Promise<Document | null> { const [row] = await query("SELECT * FROM documents WHERE document_no=$1 ORDER BY source_row LIMIT 1", [value]); return row ? documentFromRow(row) : null; }
    async existsByIdempotencyKey(key: string): Promise<boolean> {
        return (await query("SELECT note FROM documents WHERE note LIKE '{%' ")).some(row => {
            try {
                return JSON.parse(row.note).idempotency_key === key;
            }
            catch {
                return false;
            }
        });
    }
    async create(input: Omit<Document, "document_id" | "document_no" | "created_at">): Promise<Document> {
        return withDatabaseTransaction(async () => {
            // Production services supply stable IDs and document numbers for posting.
            const supplied = input as Partial<Document>;
            if (supplied.document_no && await this.findByNo(supplied.document_no))
                throw new Error("เลขเอกสารนี้ถูกใช้แล้ว");
            return documentFromRow(await insertRow("documents", { ...input, document_id: supplied.document_id || id("doc"), document_no: supplied.document_no || await this.generateDocumentNo(input.document_type), ...(supplied.created_at ? { created_at: supplied.created_at } : {}) }));
        });
    }
    async updateStatus(value: string, status: Document["status"]): Promise<void> { await this.updateDoc(value, { status }); }
    async updateNote(value: string, note: string): Promise<void> { await this.updateDoc(value, { note }); }
    async updateDoc(value: string, updates: Partial<Document>): Promise<void> {
        const found = await this.findById(value) ?? await this.findByNo(value);
        if (!found)
            throw new Error(`ไม่พบเอกสาร ${value}`);
        await updateRecord("documents", "document_id", found.document_id, updates, ["reference_no", "document_date", "status", "note", "assigned_to_user_id", "assigned_to_name", "assigned_by_user_id", "created_by_name"]);
    }
    async mutate(value: string, mutator: DocumentMutator): Promise<Document | null> {
        return withDatabaseTransaction(async () => {
            const [row] = await query("SELECT * FROM documents WHERE lower(document_id)=lower($1) OR lower(document_no)=lower($1) FOR UPDATE", [value.trim()]);
            if (!row)
                return null;
            const changes = await mutator({ ...documentFromRow(row) });
            if (changes)
                await this.updateDoc(row.document_id, changes);
            return this.findById(row.document_id);
        });
    }
    async mutateTransferProgress(value: string, mutator: DocumentMutator): Promise<Document | null> {
        return withDatabaseTransaction(async () => {
            const doc = await this.findById(value) ?? await this.findByNo(value);
            if (!doc || doc.document_type !== "TRANSFER" || doc.status !== "PENDING")
                return doc;
            const changes = await mutator({ ...doc });
            if (changes?.note) {
                const meta = JSON.parse(changes.note);
                await query("UPDATE documents SET transfer_progress=$2::jsonb WHERE document_id=$1 AND status='PENDING'", [doc.document_id, JSON.stringify({ kind: "stockify-transfer-progress-v1", current_step: meta.current_step, current_step_text: meta.current_step_text, last_active_at: meta.last_active_at, last_active_user_id: meta.last_active_user_id })]);
            }
            return this.findById(doc.document_id);
        });
    }
    async generateDocumentNo(type: DocumentType): Promise<string> {
        const [{ last_value }] = await query("INSERT INTO document_sequences(document_type,last_value) VALUES($1,1) ON CONFLICT(document_type) DO UPDATE SET last_value=document_sequences.last_value+1 RETURNING last_value", [type]);
        const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
        return `${prefixes[type]}-${date}-${String(last_value).padStart(6, "0")}`;
    }
}
export class PostgresStockMovementRepository {
    async findByDocumentId(value: string): Promise<StockMovement[]> { return query("SELECT * FROM stock_movements WHERE document_id=$1 ORDER BY source_row", [value]); }
    async findAll(filters?: MovementFilterInput): Promise<{
        data: MovementWithDetails[];
        total: number;
    }> {
        const values: unknown[] = [];
        const conditions: string[] = [];
        const terms: [
            string,
            unknown,
            string
        ][] = [["m.warehouse_id", filters?.warehouse_id ? await resolveWarehouseId(filters.warehouse_id) : null, "="], ["m.product_id", filters?.product_id ? await resolveProductId(filters.product_id) : null, "="], ["d.document_type", filters?.document_type, "="], ["d.document_no", filters?.document_no ? `%${filters.document_no}%` : null, "ILIKE"], ["m.created_at", filters?.date_from, ">="], ["m.created_at", filters?.date_to ? `${filters.date_to}T23:59:59.999+07:00` : null, "<="]];
        for (const [column, value, op] of terms)
            if (value) {
                values.push(value);
                conditions.push(`${column} ${op} $${values.length}`);
            }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const joins = "FROM stock_movements m JOIN documents d USING(document_id) JOIN products p USING(product_id) JOIN warehouses w USING(warehouse_id) JOIN locations l ON l.location_id=m.location_id LEFT JOIN users u ON u.user_id=m.created_by";
        const [{ total }] = await query(`SELECT count(*)::integer AS total ${joins} ${where}`, values);
        const limit = filters?.limit ?? 100;
        const offset = ((filters?.page ?? 1) - 1) * limit;
        const data = await query<MovementWithDetails & Record<string, unknown>>(`SELECT m.*,d.document_no,d.document_type,p.product_name,p.sku,w.warehouse_name,l.location_code,coalesce(u.full_name,m.created_by) AS created_by_name ${joins} ${where} ORDER BY m.created_at DESC,m.source_row DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
        return { data, total };
    }
    async getBalance(productId: string, warehouseId: string, locationId: string): Promise<number> {
        const wh = await resolveWarehouseId(warehouseId);
        const prod = await resolveProductId(productId);
        const loc = await resolveLocationId(wh, locationId);
        if (!loc)
            return 0;
        return (await query("SELECT quantity FROM stock_summary WHERE product_id=$1 AND warehouse_id=$2 AND location_id=$3", [prod, wh, loc]))[0]?.quantity ?? 0;
    }
    async getWarehouseBalance(productId: string, warehouseId: string): Promise<number> { return (await query("SELECT coalesce(sum(quantity),0) AS quantity FROM stock_summary WHERE product_id=$1 AND warehouse_id=$2", [await resolveProductId(productId), await resolveWarehouseId(warehouseId)]))[0].quantity; }
    async existsByIdempotencyKey(key: string): Promise<boolean> { return (await query("SELECT EXISTS(SELECT 1 FROM stock_movements WHERE idempotency_key=$1) AS found", [key]))[0].found; }
    async batchCreate(inputs: Omit<StockMovement, "movement_id" | "created_at">[]): Promise<StockMovement[]> {
        return withDatabaseTransaction(async () => {
            const result: StockMovement[] = [];
            for (const input of inputs) {
                const wh = await resolveWarehouseId(input.warehouse_id);
                result.push(await insertRow("stock_movements", { ...input, movement_id: id("mov"), product_id: await resolveProductId(input.product_id), warehouse_id: wh, location_id: await resolveLocationId(wh, input.location_id, true) }));
            }
            return result;
        });
    }
}
export class PostgresStockSummaryRepository {
    async findAll(warehouseId?: string): Promise<StockSummary[]> { return query("SELECT * FROM stock_summary WHERE ($1::text IS NULL OR warehouse_id=$1) ORDER BY source_row", [warehouseId ? await resolveWarehouseId(warehouseId) : null]); }
    async findByProductAndLocation(productId: string, warehouseId: string, locationId: string): Promise<StockSummary | null> {
        const wh = await resolveWarehouseId(warehouseId);
        const loc = await resolveLocationId(wh, locationId);
        if (!loc)
            return null;
        return (await query<StockSummary>("SELECT * FROM stock_summary WHERE product_id=$1 AND warehouse_id=$2 AND location_id=$3", [await resolveProductId(productId), wh, loc]))[0] ?? null;
    }
    async applyChanges(changes: {
        productId: string;
        warehouseId: string;
        locationId: string;
        delta: number;
    }[]): Promise<void> {
        await withDatabaseTransaction(async () => {
            for (const change of changes) {
                if (!Number.isFinite(change.delta))
                    throw new StockValidationError("Invalid stock delta");
                const wh = await resolveWarehouseId(change.warehouseId);
                const prod = await resolveProductId(change.productId);
                const loc = await resolveLocationId(wh, change.locationId, true);
                // Insert zero first: a negative proposed INSERT is checked before conflict handling.
                await query("INSERT INTO stock_summary(product_id,warehouse_id,location_id,quantity) VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING", [prod, wh, loc]);
                const rows = await query("UPDATE stock_summary SET quantity=quantity+$4,last_updated=now(),listed_in_warehouse=true WHERE product_id=$1 AND warehouse_id=$2 AND location_id=$3 AND quantity+$4>=0 RETURNING quantity", [prod, wh, loc, change.delta]);
                if (!rows.length)
                    throw new InsufficientStockError("สต็อกไม่เพียงพอ ไม่สามารถทำให้ยอดติดลบได้");
            }
        });
    }
    async rebuild(): Promise<void> {
        await withDatabaseTransaction(async () => {
            await query("UPDATE stock_summary s SET quantity=s.opening_quantity+coalesce((SELECT sum(m.qty_change) FROM stock_movements m WHERE m.product_id=s.product_id AND m.warehouse_id=s.warehouse_id AND m.location_id=s.location_id),0),last_updated=now()");
            await query("INSERT INTO stock_summary(product_id,warehouse_id,location_id,quantity) SELECT product_id,warehouse_id,location_id,sum(qty_change) FROM stock_movements GROUP BY product_id,warehouse_id,location_id ON CONFLICT DO NOTHING");
        });
    }
}
export class PostgresStockCountRepository {
    async findAll(warehouseId?: string): Promise<StockCount[]> { return query("SELECT * FROM stock_counts WHERE ($1::text IS NULL OR warehouse_id=$1) ORDER BY source_row", [warehouseId ? await resolveWarehouseId(warehouseId) : null]); }
    async findById(value: string): Promise<StockCount | null> { return (await query<StockCount>("SELECT * FROM stock_counts WHERE count_id=$1", [value]))[0] ?? null; }
    async create(input: CreateStockCountInput & {
        system_qty: number;
        count_no: string;
    }): Promise<StockCount> { const wh = await resolveWarehouseId(input.warehouse_id); return insertRow("stock_counts", { ...input, count_id: id("cnt"), warehouse_id: wh, product_id: await resolveProductId(input.product_id), location_id: await resolveLocationId(wh, input.location_id, true) }); }
    async update(value: string, changes: Partial<StockCount>): Promise<StockCount | null> { return updateRecord("stock_counts", "count_id", value, changes, ["counted_qty", "difference", "status", "counted_by", "counted_at", "approved_by", "approved_at"]); }
}
function userFromRow(row: Record<string, unknown>): User { return { ...row, warehouse_access: JSON.stringify(row.warehouse_access) } as unknown as User; }
export class PostgresUserRepository {
    async findAll(): Promise<User[]> { return (await query("SELECT * FROM users ORDER BY source_row")).map(userFromRow); }
    async findById(value: string): Promise<User | null> { const [row] = await query("SELECT * FROM users WHERE user_id=$1", [value]); return row ? userFromRow(row) : null; }
    async findByEmail(value: string): Promise<User | null> { const [row] = await query("SELECT * FROM users WHERE lower(email)=lower($1)", [value]); return row ? userFromRow(row) : null; }
    async create(input: Omit<User, "user_id" | "created_at" | "updated_at">): Promise<User> { return userFromRow(await insertRow("users", { ...input, user_id: id("usr"), warehouse_access: input.warehouse_access || "[]" })); }
    async update(value: string, changes: Partial<User>): Promise<User | null> { const row = await updateRecord("users", "user_id", value, changes, ["full_name", "email", "password_hash", "pin_hash", "role", "warehouse_access", "menu_hrefs", "active"]); return row ? userFromRow(row) : null; }
}
export class PostgresIdempotencyRepository {
    async findByKey(key: string): Promise<IdempotencyRecord | null> { return (await query<IdempotencyRecord>("SELECT * FROM idempotency_records WHERE key=$1", [key]))[0] ?? null; }
    async create(input: Omit<IdempotencyRecord, "created_at" | "updated_at">): Promise<IdempotencyRecord> { return insertRow("idempotency_records", input); }
    async update(key: string, changes: Partial<Pick<IdempotencyRecord, "status" | "response_payload" | "error_message" | "payload_hash">>): Promise<IdempotencyRecord | null> { return updateRecord("idempotency_records", "key", key, changes, ["status", "response_payload", "error_message", "payload_hash"]); }
}
export class PostgresAuditRepository {
    async append(input: Omit<AuditLogEntry, "audit_id" | "timestamp">): Promise<AuditLogEntry> { return insertRow("audit_logs", { ...input, audit_id: id("audit") }); }
    async findAll(filters?: {
        actor_id?: string;
        warehouse_id?: string;
        action?: string;
        date_from?: string;
        date_to?: string;
        limit?: number;
    }): Promise<AuditLogEntry[]> {
        const values: unknown[] = [];
        const conditions: string[] = [];
        for (const column of ["actor_id", "warehouse_id", "action"] as const)
            if (filters?.[column]) {
                values.push(filters[column]);
                conditions.push(`${column}=$${values.length}`);
            }
        if (filters?.date_from) {
            values.push(filters.date_from);
            conditions.push(`timestamp >= $${values.length}`);
        }
        if (filters?.date_to) {
            values.push(`${filters.date_to}T23:59:59.999+07:00`);
            conditions.push(`timestamp <= $${values.length}`);
        }
        values.push(filters?.limit ?? 1000);
        return query(`SELECT * FROM audit_logs ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY timestamp DESC LIMIT $${values.length}`, values);
    }
}
export class PostgresOperationJournalRepository {
    async findById(value: string): Promise<OperationRecord | null> { return (await query<OperationRecord>("SELECT * FROM operation_journal WHERE operation_id=$1", [value]))[0] ?? null; }
    async findByIdempotencyKey(value: string): Promise<OperationRecord | null> { return (await query<OperationRecord>("SELECT * FROM operation_journal WHERE idempotency_key=$1", [value]))[0] ?? null; }
    async create(input: Omit<OperationRecord, "created_at" | "updated_at">): Promise<OperationRecord> { return insertRow("operation_journal", input); }
    async update(value: string, changes: Partial<Pick<OperationRecord, "steps" | "completed_steps" | "status" | "retry_count" | "last_error">>): Promise<OperationRecord | null> { return updateRecord("operation_journal", "operation_id", value, changes, ["steps", "completed_steps", "status", "retry_count", "last_error"]); }
    async findPendingRecovery(): Promise<OperationRecord[]> { return query("SELECT * FROM operation_journal WHERE status IN ('PENDING','IN_PROGRESS','RECOVERABLE','COMPENSATING') ORDER BY created_at"); }
}
export class PostgresWarehouseSyncRepository {
    async syncDeduct(_warehouseId: string, productId: string, _qty: number, _locationId?: string): Promise<ProductSyncInfo | null> {
        const product = await new PostgresProductRepository().findById(productId);
        if (!product)
            return null;
        return { sku: product.sku, barcode: product.barcode, product_name: product.product_name, category: product.category, base_unit: product.base_unit, supplier: product.supplier || "" };
    }
    async syncAdd(_warehouseId: string, _product: ProductSyncInfo, _qty: number, _locationId?: string): Promise<void> { }
    async syncMove(_warehouseId: string, _productId: string, _qty: number, _fromLocationId?: string, _toLocationId?: string): Promise<void> { }
}
export class PostgresStockRepository implements IStockRepository {
    warehouses = new PostgresWarehouseRepository();
    locations = new PostgresLocationRepository();
    shelves = new PostgresShelfRepository();
    products = new PostgresProductRepository();
    documents = new PostgresDocumentRepository();
    movements = new PostgresStockMovementRepository();
    stockSummary = new PostgresStockSummaryRepository();
    stockCounts = new PostgresStockCountRepository();
    users = new PostgresUserRepository();
    dashboard = new SheetsDashboardRepository(this.products);
    idempotency = new PostgresIdempotencyRepository();
    audit = new PostgresAuditRepository();
    journal = new PostgresOperationJournalRepository();
    warehouseSync = new PostgresWarehouseSyncRepository();
}
