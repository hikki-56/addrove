import { createHash } from "node:crypto";
import { TAB_MAPPINGS, cellsToRecord } from "@/server/repositories/postgres/tab-adapter";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";
export type Snapshot = {
    sourceId: string;
    capturedAt: string;
    checksum: string;
    tabs: {
        name: string;
        values: string[][];
        formulas: string[][];
    }[];
};
type Row = Record<string, unknown>;
export type MigrationModel = {
    tables: Record<string, Row[]>;
    warnings: Record<string, number>;
    errors: string[];
    stockTotals: Record<string, number>;
    sourceCounts: Record<string, number>;
};
const now = (snapshot: Snapshot) => snapshot.capturedAt;
const num = (value: unknown): number => {
    const n = Number(String(value ?? "0").replace(/,/g, "").trim() || "0");
    if (!Number.isFinite(n))
        throw new Error("Invalid numeric source cell");
    return n;
};
const active = (value: unknown, fallback = true) => value == null || value === "" ? fallback : /^(true|1|yes|active)$/i.test(String(value));
const whKey = (value: string) => normalizeWarehouseId(value).replace(/^wh-0/, "wh-");
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
const date = (value: unknown, fallback: string): string => {
    const text = String(value || "").trim();
    if (!text)
        return fallback;
    let candidate = text;
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
    if (match) {
        const year = Number(match[3]) > 2400 ? Number(match[3]) - 543 : Number(match[3]);
        candidate = `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}${match[4] || "T00:00:00+07:00"}`;
    }
    const parsed = new Date(candidate);
    if (!Number.isFinite(parsed.getTime()))
        throw new Error("Invalid source timestamp");
    return parsed.toISOString();
};
const calendarDate = (value: unknown, fallback: string): string => {
    const text = String(value || "").trim();
    const local = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (local) {
        const year = Number(local[3]) > 2400 ? Number(local[3]) - 543 : Number(local[3]);
        return `${year}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(text))
        return text.slice(0, 10);
    return date(value, fallback).slice(0, 10);
};
export function buildMigrationModel(snapshot: Snapshot): MigrationModel {
    const { checksum, ...body } = snapshot;
    if (createHash("sha256").update(JSON.stringify(body)).digest("hex") !== checksum)
        throw new Error("Snapshot checksum mismatch");
    const model: MigrationModel = { tables: {}, warnings: {}, errors: [], stockTotals: {}, sourceCounts: {} };
    const warning = (name: string) => { model.warnings[name] = (model.warnings[name] || 0) + 1; };
    const source = (name: string) => snapshot.tabs.find(t => t.name.toLowerCase() === name.toLowerCase())?.values ?? [];
    const table = (name: string) => model.tables[name] ||= [];
    const add = (name: string, row: Row) => table(name).push(row);
    const timestamp = now(snapshot);
    const safe = (label: string, fn: () => void) => {
        try {
            fn();
        }
        catch (error) {
            model.errors.push(`${label}: ${error instanceof Error ? error.message : "invalid source"}`);
        }
    };
    const timed = (row: Row) => {
        for (const name of ["created_at", "updated_at", "timestamp", "at", "reported_at", "login_at", "last_updated"])
            if (name in row)
                row[name] = date(row[name], timestamp);
        return row;
    };
    const sourceRow = (row: Row, cells: string[], position: number): Row => ({ ...row, source_row: position, source_cells: cells });
    for (const tab of snapshot.tabs)
        model.sourceCounts[tab.name] = Math.max(0, tab.values.length - 1);
    const warehouses = new Map<string, Row>();
    source("Warehouses").slice(1).forEach((r, i) => safe(`Warehouses row ${i + 2}`, () => {
        if (!r[0])
            return;
        const row = sourceRow({ warehouse_id: r[0], warehouse_code: r[1] || r[0], warehouse_name: r[2] || r[1] || r[0], address: r[3] || "", active: active(r[4]), created_at: date(r[5], timestamp), updated_at: date(r[6], timestamp) }, r, i + 2);
        warehouses.set(whKey(r[0]), row);
        add("warehouses", row);
    }));
    const warehouseId = (value: string): string => {
        const row = warehouses.get(whKey(value));
        if (!row)
            throw new Error("Source references an unknown warehouse");
        return String(row.warehouse_id);
    };
    const products = new Map<string, Row>();
    const legacyProducts = new Map<string, Row>();
    source("PRODUCTS").slice(1).forEach((r, i) => safe(`PRODUCTS row ${i + 2}`, () => {
        if (!r.some(c => c.trim()))
            return;
        if (["ลำดับ", "SKU", "รหัสสินค้า", "product_id"].includes(r[0])) {
            warning("embedded_product_headers");
            return;
        }
        // Use the authoritative header even when a product name is blank.
        const modern = source("PRODUCTS")[0]?.[2] === "รหัสสินค้า" || (r.length >= 7 && r[0] !== "" && Number.isFinite(Number(r[0])) && Number(r[0]) < 10000 && Boolean(r[2]));
        const sku = (modern ? r[2] : r[0])?.trim();
        if (!sku) {
            warning("empty_product_rows");
            return;
        }
        const barcode = (modern ? r[6] : r[1])?.trim() || sku;
        const row = sourceRow({ product_id: `prod-${sku}`, sku, barcode: barcode === "-" ? sku : barcode, product_name: (modern ? r[4] : r[2])?.trim() || sku, category: (modern ? r[5] : r[3]) || "ทั่วไป", base_unit: modern ? "ชิ้น" : r[4] || "ชิ้น", minimum_stock: 0, supplier: (modern ? r[1] : r[7]) || "", description: "", active: true, created_at: timestamp, updated_at: timestamp }, r, i + 2);
        const oldModern = r.length >= 7 && r[0] !== "" && Number.isFinite(Number(r[0])) && Number(r[0]) < 10000 && (r[3]?.trim() === r[2]?.slice(0, 4) || Boolean(r[2] && r[4]?.trim()));
        const oldSku = oldModern ? r[2] : r[0];
        row.legacy_ids = oldSku && oldSku !== sku ? [`prod-${oldSku}`, oldSku] : [];
        if (oldSku && oldSku !== sku) {
            legacyProducts.set(oldSku, row);
            legacyProducts.set(`prod-${oldSku}`, row);
            warning("header_based_product_identity_corrections");
        }
        if (products.has(sku)) {
            warning("duplicate_product_rows_archived");
            return;
        }
        products.set(sku, row);
        add("products", row);
    }));
    const ensureProduct = (value: string, details?: {
        name?: string;
        barcode?: string;
        unit?: string;
        category?: string;
        supplier?: string;
    }): string => {
        const clean = value.replace(/^prod-/, "").trim();
        if (!clean)
            throw new Error("Empty product reference");
        const existing = products.get(clean) || legacyProducts.get(value) || legacyProducts.get(clean) || [...products.values()].find(p => String(p.product_id).toLowerCase() === value.toLowerCase() || String(p.sku).toLowerCase() === clean.toLowerCase() || String(p.barcode).toLowerCase() === clean.toLowerCase());
        if (existing)
            return String(existing.product_id);
        const row = { product_id: `prod-${clean}`, sku: clean, barcode: details?.barcode || clean, product_name: details?.name || clean, category: details?.category || "ทั่วไป", base_unit: details?.unit || "ชิ้น", minimum_stock: 0, supplier: details?.supplier || "", description: "Legacy reference preserved during migration", active: true, created_at: timestamp, updated_at: timestamp, legacy_ids: [] };
        products.set(clean, row);
        add("products", row);
        warning("products_from_legacy_references");
        return String(row.product_id);
    };
    const locations = new Map<string, Row>();
    const locationIds = new Map<string, string>();
    const warehouseLocationIds = new Map<string, string>();
    source("Locations").slice(1).forEach((r, i) => safe(`Locations row ${i + 2}`, () => {
        if (!r[0])
            return;
        const legacy = r.length >= 12 && Boolean(r[7]);
        const wh = warehouseId(r[1]);
        const code = legacy ? r[7] : r[2] || "";
        const key = `${wh}\0${code.toLowerCase()}`;
        if (locations.has(key)) {
            const existing = locations.get(key)!;
            existing.legacy_ids = [...new Set([...(Array.isArray(existing.legacy_ids) ? existing.legacy_ids : []), r[0]])];
            if (!warehouseLocationIds.has(`${wh}\0${r[0]}`))
                warehouseLocationIds.set(`${wh}\0${r[0]}`, String(existing.location_id));
            if (!locationIds.has(r[0]))
                locationIds.set(r[0], String(existing.location_id));
            warning("duplicate_locations_archived");
            return;
        }
        const canonicalId = table("locations").some(l => l.location_id === r[0]) ? `loc-import-${hash(key)}` : r[0];
        if (canonicalId !== r[0])
            warning("duplicate_location_ids_disambiguated_by_warehouse");
        const row = sourceRow({ location_id: canonicalId, warehouse_id: wh, location_code: code, location_name: (legacy ? r[7] : r[3]) || code, description: (legacy ? r[8] : r[4]) || "", active: active(legacy ? r[9] : r[5]), created_at: date(legacy ? r[10] : r[6], timestamp), updated_at: date(legacy ? r[11] : r[7], timestamp) }, r, i + 2);
        row.legacy_ids = [r[0]];
        locations.set(key, row);
        if (!warehouseLocationIds.has(`${wh}\0${r[0]}`))
            warehouseLocationIds.set(`${wh}\0${r[0]}`, canonicalId);
        if (!locationIds.has(r[0]))
            locationIds.set(r[0], canonicalId);
        add("locations", row);
    }));
    const ensureLocation = (wh: string, value: string): string => {
        const direct = warehouseLocationIds.get(`${wh}\0${value}`);
        if (direct)
            return direct;
        const code = value.trim().replace(/^loc-/, "");
        const key = `${wh}\0${code.toLowerCase()}`;
        if (locations.has(key))
            return String(locations.get(key)!.location_id);
        const row = { location_id: code ? `loc-import-${hash(key)}` : `loc-${wh}-unassigned`, warehouse_id: wh, location_code: code, location_name: code || "ไม่ระบุ", active: true, created_at: timestamp, updated_at: timestamp, legacy_ids: [] };
        locations.set(key, row);
        add("locations", row);
        warning("locations_from_legacy_references");
        return row.location_id;
    };
    source("Shelves").slice(1).forEach((r, i) => safe(`Shelves row ${i + 2}`, () => {
        if (!r[0])
            return;
        const loc = locationIds.get(r[1]);
        if (!loc)
            throw new Error("Shelf references an unknown location");
        add("shelves", sourceRow({ shelf_id: r[0], location_id: loc, shelf_code: r[2], shelf_name: r[3] || r[2], shelf_level: r[4] || "1", active: active(r[5]), created_at: date(r[6], timestamp), updated_at: date(r[7], timestamp) }, r, i + 2));
    }));
    source("Users").slice(1).forEach((r, i) => safe(`Users row ${i + 2}`, () => {
        if (!r[0])
            return;
        const email = r[6] || r[1];
        if (!email)
            throw new Error("User has no login identifier");
        let access: unknown = [];
        if (r[3] === "ADMIN")
            access = ["*"];
        else if (r[12])
            access = JSON.parse(r[12]);
        add("users", sourceRow({ user_id: r[0], full_name: [r[4], r[5]].filter(Boolean).join(" ") || r[1], email, password_hash: r[2] || "", pin_hash: r[11] || "", role: r[3] || "VIEWER", warehouse_access: access, active: active(r[8], false), created_at: date(r[9], timestamp), updated_at: date(r[10], timestamp) }, r, i + 2));
    }));
    const documents = new Map<string, Row>();
    source("Documents").slice(1).forEach((r, i) => safe(`Documents row ${i + 2}`, () => {
        if (!r[0])
            return;
        const row = timed(cellsToRecord(TAB_MAPPINGS.Documents, r));
        row.document_date = calendarDate(row.document_date, timestamp);
        row.migrated = true;
        if (documents.has(r[0])) {
            warning("duplicate_documents_archived");
            return;
        }
        documents.set(r[0], row);
        add("documents", sourceRow(row, r, i + 2));
    }));
    const movements = new Map<string, Row>();
    const ledger = new Map<string, number>();
    source("StockMovements").slice(1).forEach((r, i) => safe(`StockMovements row ${i + 2}`, () => {
        if (!r[0])
            return;
        const row = timed(cellsToRecord(TAB_MAPPINGS.StockMovements, r));
        row.product_id = ensureProduct(String(row.product_id));
        row.warehouse_id = warehouseId(String(row.warehouse_id));
        row.location_id = ensureLocation(String(row.warehouse_id), String(row.location_id));
        if (movements.has(r[0])) {
            warning("duplicate_movements_archived");
            return;
        }
        if (!documents.has(String(row.document_id))) {
            const movementType = String(row.movement_type);
            const documentType = movementType.startsWith("TRANSFER") ? "TRANSFER" : movementType.startsWith("MOVE") ? "MOVE" : movementType.startsWith("ISSUE") ? "ISSUE" : movementType === "RECEIVE" ? "RECEIVE" : movementType === "OPENING" ? "OPENING" : movementType === "REVERSAL" ? "REVERSAL" : "ADJUST";
            const doc = { document_id: row.document_id, document_no: `LEGACY-${hash(String(row.document_id))}`, document_type: documentType, reference_no: "", document_date: String(row.created_at).slice(0, 10), status: "POSTED", note: '{"kind":"LEGACY_IMPORT_REFERENCE"}', created_by: row.created_by, created_at: row.created_at, migrated: true };
            documents.set(String(row.document_id), doc);
            add("documents", doc);
            warning("documents_from_legacy_references");
        }
        const key = [row.product_id, row.warehouse_id, row.location_id].join("\0");
        ledger.set(key, (ledger.get(key) || 0) + Number(row.qty_change));
        movements.set(r[0], row);
        add("stock_movements", sourceRow(row, r, i + 2));
    }));
    const balances = new Map<string, Row>();
    for (const tab of snapshot.tabs.filter(t => /^(?:โกดัง\s*\d+|สำนักงานใหญ่)$/.test(t.name))) {
        const wh = warehouseId(tab.name === "สำนักงานใหญ่" ? "wh-6" : `wh-${tab.name.match(/\d+/)![0]}`);
        tab.values.slice(1).forEach((r, i) => safe(`${tab.name} row ${i + 2}`, () => {
            if (!r[0]?.trim() || ["รหัสสินค้า", "SKU"].includes(r[0]))
                return;
            // Same effective quantity as the old app; archive the original '-' / '(2.00)'.
            const parsed = parseFloat(String(r[5] || "0").replace(/,/g, ""));
            if (!Number.isFinite(parsed))
                warning("non_numeric_stock_cells_preserved_as_current_app_zero");
            const qty = Number.isFinite(parsed) ? parsed : 0;
            if (qty < 0)
                throw new Error("Negative physical stock must be reconciled before cutover");
            const productId = ensureProduct(r[0], { name: r[2], barcode: r[1], category: r[3], unit: r[4], supplier: r[7] });
            const loc = ensureLocation(wh, r[6] || "");
            const key = [productId, wh, loc].join("\0");
            if (!balances.has(key))
                balances.set(key, { product_id: productId, warehouse_id: wh, location_id: loc, quantity: 0, last_updated: timestamp, listed_in_warehouse: true });
            balances.get(key)!.quantity = Number(balances.get(key)!.quantity) + qty;
            model.stockTotals[wh] = (model.stockTotals[wh] || 0) + qty;
        }));
    }
    // Keep zero locations too. Opening quantities reconcile old ledger differences
    // instead of treating old movements as a complete physical stock history.
    for (const row of table("stock_movements")) {
        const key = [row.product_id, row.warehouse_id, row.location_id].join("\0");
        if (!balances.has(key))
            balances.set(key, { product_id: row.product_id, warehouse_id: row.warehouse_id, location_id: row.location_id, quantity: 0, last_updated: timestamp, listed_in_warehouse: false });
    }
    for (const [key, balance] of balances) {
        balance.opening_quantity = Number(balance.quantity) - (ledger.get(key) || 0);
        add("stock_summary", balance);
    }
    for (const [name, mapping] of Object.entries(TAB_MAPPINGS)) {
        if (["warehouses", "locations", "shelves", "products", "users", "documents", "stock_movements", "stock_summary"].includes(mapping.table))
            continue;
        source(name).slice(1).forEach((r, i) => safe(`${name} row ${i + 2}`, () => {
            if (!r[0])
                return;
            const row = timed(cellsToRecord(mapping, r));
            if (mapping.table === "stock_counts") {
                row.product_id = ensureProduct(String(row.product_id));
                row.warehouse_id = warehouseId(String(row.warehouse_id));
                row.location_id = ensureLocation(String(row.warehouse_id), String(row.location_id));
            }
            if (mapping.table === "production_jobs") {
                row.product_id = ensureProduct(String(row.product_id));
                row.production_date = calendarDate(row.production_date, timestamp);
                for (const field of ["submitted_at", "started_at", "completed_at", "cancelled_at"])
                    if (row[field])
                        row[field] = date(row[field], timestamp);
            }
            if (mapping.key && table(mapping.table).some(old => old[mapping.key] === row[mapping.key])) {
                warning(`duplicate_${mapping.table}_archived`);
                return;
            }
            if (mapping.table === "operation_journal" && table(mapping.table).some(old => old.idempotency_key === row.idempotency_key)) {
                warning("duplicate_journal_idempotency_keys_archived");
                return;
            }
            add(mapping.table, sourceRow(row, r, i + 2));
        }));
    }
    const boms = new Set<string>();
    source("BOM_Headers").slice(1).forEach((r, i) => safe(`BOM_Headers row ${i + 2}`, () => {
        if (!r[0] || !r[1])
            return;
        if (boms.has(r[0])) {
            warning("duplicate_bom_headers_archived");
            return;
        }
        boms.add(r[0]);
        add("bom_formulas", sourceRow({ bom_id: r[0], fg_sku: r[1], fg_barcode: r[2] || "", fg_name: r[3] || r[1], fg_unit: r[4] || "ชุด", base_qty: num(r[5] || "1"), active: active(r[7]), updated_at: date(r[8], timestamp) }, r, i + 2));
    }));
    source("BOM_Items").slice(1).forEach((r, i) => safe(`BOM_Items row ${i + 2}`, () => {
        if (!r[0] || !r[1])
            return;
        if (!boms.has(r[0])) {
            warning("orphan_bom_items_archived");
            return;
        }
        add("bom_formula_items", sourceRow({ bom_id: r[0], rm_sku: r[1], rm_barcode: r[2] || "", rm_name: r[3] || r[1], rm_wh: "โกดัง2", is_primary: num(r[4] || "1"), rm_qty_required: num(r[5] || "1"), rm_unit: r[6] || "ชิ้น", waste_percentage: 0, note: r[7] || "", updated_at: date(r[8], timestamp) }, r, i + 2));
    }));
    // Detect conflicts explicitly; original cells remain available in the archive.
    const seenDocNos = new Set<string>();
    for (const doc of table("documents")) {
        const no = String(doc.document_no);
        if (seenDocNos.has(no))
            warning("duplicate_legacy_document_numbers_preserved");
        seenDocNos.add(no);
    }
    const seenJobNos = new Set<string>();
    for (const job of table("production_jobs")) {
        const original = String(job.job_no);
        if (seenJobNos.has(original)) {
            if (job.status !== "DRAFT" || table("production_reports").some(r => r.job_no === original)) {
                model.errors.push("Duplicate production job numbers with posted reports require reconciliation");
                continue;
            }
            const prefix = original.replace(/\d+$/, "");
            let sequence = Math.max(...table("production_jobs").map(j => Number(String(j.job_no).match(/(\d+)$/)?.[1] || 0))) + 1;
            let replacement = `${prefix}${String(sequence).padStart(6, "0")}`;
            while (seenJobNos.has(replacement))
                replacement = `${prefix}${String(++sequence).padStart(6, "0")}`;
            job.job_no = replacement;
            seenJobNos.add(replacement);
            warning("duplicate_draft_job_numbers_reassigned");
            for (const history of table("production_history")) {
                if (history.job_no !== original)
                    continue;
                let detail: Row;
                try {
                    detail = JSON.parse(String(history.detail));
                }
                catch {
                    continue;
                }
                if (detail.sku === job.sku && Number(detail.target_qty) === Number(job.target_qty) && Number(detail.table_no) === Number(job.table_no))
                    history.job_no = replacement;
            }
        }
        else
            seenJobNos.add(original);
    }
    for (const [name, key] of [["users", "email"], ["products", "barcode"], ["production_reports", "idempotency_key"]]) {
        const seen = new Set<string>();
        for (const row of table(name)) {
            const value = String(row[key] || "").toLowerCase();
            if (!value)
                continue;
            if (seen.has(value))
                model.errors.push(`${name}: duplicate ${key} (source data requires reconciliation)`);
            seen.add(value);
        }
    }
    const fg = new Set<string>();
    for (const row of table("bom_formulas")) {
        if (!row.active)
            continue;
        const sku = String(row.fg_sku);
        if (fg.has(sku))
            model.errors.push("bom_formulas: duplicate active finished-goods SKU");
        fg.add(sku);
    }
    return model;
}
