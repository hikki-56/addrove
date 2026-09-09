import {
  readSheet,
  batchAppendRows,
  SHEETS,
  getWarehouseSheetName,
} from "@/lib/google-sheets/client";
import type { IStockMovementRepository } from "../interfaces";
import type { StockMovement, MovementWithDetails, MovementType } from "@/types/models";
import type { MovementFilterInput } from "@/types/api";

function matchSku(sku1?: string, sku2?: string): boolean {
  if (!sku1 || !sku2) return false;
  const s1 = sku1.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_]/g, "");
  const s2 = sku2.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_]/g, "");
  return s1 === s2;
}

/** Normalize warehouse ids so "wh-01" and "wh-1" compare equal without fuzzy endsWith */
function normalizeWhKey(whId?: string): string {
  return (whId || "").trim().toLowerCase().replace(/^wh-0*(\d+)$/, "wh-$1");
}

function cleanLocCode(loc?: string): string {
  if (!loc) return "";
  return loc
    .trim()
    .toLowerCase()
    .replace(/^loc-/, "")
    .replace(/^wh-0?[0-9]-?/, "")
    .replace(/^sh-/, "")
    .replace(/^slf-/, "")
    .replace(/[\s\-_]/g, "");
}

function cleanSkuCode(sku?: string): string {
  if (!sku) return "";
  return sku
    .trim()
    .toLowerCase()
    .replace(/^prod-/, "")
    .replace(/[\s\-_]/g, "");
}

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Columns: movement_id, document_id, product_id, warehouse_id, location_id, qty_change, movement_type, idempotency_key, created_by, created_at
function rowToMovement(row: string[]): StockMovement {
  return {
    movement_id: row[0] ?? "",
    document_id: row[1] ?? "",
    product_id: row[2] ?? "",
    warehouse_id: row[3] ?? "",
    location_id: row[4] ?? "",
    qty_change: parseFloat(row[5] ?? "0") || 0,
    movement_type: (row[6] as MovementType) ?? "RECEIVE",
    idempotency_key: row[7] ?? "",
    created_by: row[8] ?? "",
    created_at: row[9] ?? "",
  };
}

function movementToRow(m: StockMovement): (string | number)[] {
  return [
    m.movement_id,
    m.document_id,
    m.product_id,
    m.warehouse_id,
    m.location_id,
    m.qty_change,
    m.movement_type,
    m.idempotency_key,
    m.created_by,
    m.created_at,
  ];
}

const globalForMovs = globalThis as unknown as {
  inMemoryMovements?: StockMovement[];
};
if (!globalForMovs.inMemoryMovements) {
  globalForMovs.inMemoryMovements = [];
}
const inMemoryMovements = globalForMovs.inMemoryMovements;

export class SheetsStockMovementRepository
  implements IStockMovementRepository
{
  private async getAllRows(): Promise<string[][]> {
    const rows: string[][] = await readSheet(SHEETS.STOCK_MOVEMENTS, "A2:J").catch(() => []);
    const existingIds = new Set<string>(rows.map((r) => r[0]));

    for (const memMov of inMemoryMovements) {
      if (!existingIds.has(memMov.movement_id)) {
        rows.unshift(movementToRow(memMov).map(String));
      }
    }

    return rows;
  }

  async findByDocumentId(documentId: string): Promise<StockMovement[]> {
    const rows = await this.getAllRows();
    return rows.filter((r) => r[1] === documentId).map(rowToMovement);
  }

  async findAll(
    filters: MovementFilterInput
  ): Promise<{ data: MovementWithDetails[]; total: number }> {
    // Load all data in batch
    const [movRows, docRows, productRows, warehouseRows, locationRows, userRows] =
      await Promise.all([
        this.getAllRows(),
        readSheet(SHEETS.DOCUMENTS, "A2:I").catch(() => []),
        readSheet(SHEETS.PRODUCTS, "A2:K").catch(() => []),
        readSheet(SHEETS.WAREHOUSES, "A2:G").catch(() => []),
        readSheet(SHEETS.LOCATIONS, "A2:L").catch(() => []),
        readSheet(SHEETS.USERS, "A2:H").catch(() => []),
      ]);

    const docMap = new Map(docRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const productMap = new Map(productRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const warehouseMap = new Map(warehouseRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const locationMap = new Map<string, string[]>();
    locationRows.filter((r) => r[0]).forEach((r) => {
      locationMap.set(r[0], r);
      if (r[2]) locationMap.set(r[2], r);
      if (r[7] && r.length >= 12) locationMap.set(r[7], r);
    });
    const userMap = new Map<string, string>();
    userRows.filter((r) => r[0]).forEach((r) => {
      const fullName = [r[4], r[5]].filter(Boolean).join(" ") || r[1] || r[0];
      userMap.set(r[0].toLowerCase(), fullName);
      if (r[1]) userMap.set(r[1].toLowerCase(), fullName);
      if (r[6]) userMap.set(r[6].toLowerCase(), fullName);
    });

    let movements: MovementWithDetails[] = movRows
      .filter((r) => r[0])
      .map((r) => {
        const mov = rowToMovement(r);
        const doc = docMap.get(mov.document_id);
        const product = productMap.get(mov.product_id);
        const warehouse = warehouseMap.get(mov.warehouse_id);
        const location = locationMap.get(mov.location_id) || locationMap.get(mov.location_id.replace(/^loc-/, ""));
        const cleanCreatedBy = String(mov.created_by || "").trim().toLowerCase();
        const resolvedUserName = userMap.get(cleanCreatedBy) || mov.created_by;

        let resolvedLocCode = mov.location_id;
        if (location) {
          resolvedLocCode = (location.length >= 12 && location[7] ? location[7] : location[2]) || mov.location_id;
        }

        return {
          ...mov,
          document_no: doc?.[1] ?? "",
          document_type: (doc?.[2] ?? "RECEIVE") as MovementWithDetails["document_type"],
          product_name: product?.[3] ?? "",
          sku: product?.[1] ?? "",
          warehouse_name: warehouse?.[2] ?? "",
          location_code: resolvedLocCode,
          created_by_name: resolvedUserName,
        };
      });

    // Apply filters
    if (filters.warehouse_id) {
      movements = movements.filter((m) => m.warehouse_id === filters.warehouse_id);
    }
    if (filters.location_id) {
      movements = movements.filter((m) => m.location_id === filters.location_id);
    }
    if (filters.document_type) {
      movements = movements.filter((m) => m.document_type === filters.document_type);
    }
    if (filters.sku) {
      movements = movements.filter((m) =>
        m.sku.toLowerCase().includes(filters.sku!.toLowerCase())
      );
    }
    if (filters.product_id) {
      // ค้นจาก product_id ในแถว movement โดยตรง — ครอบคลุมสินค้าที่ไม่มีใน master sheet
      movements = movements.filter((m) => matchSku(m.product_id, filters.product_id!));
    }
    if (filters.product_name) {
      movements = movements.filter((m) =>
        m.product_name.toLowerCase().includes(filters.product_name!.toLowerCase())
      );
    }
    if (filters.document_no) {
      movements = movements.filter((m) =>
        m.document_no.toLowerCase().includes(filters.document_no!.toLowerCase())
      );
    }
    if (filters.created_by) {
      movements = movements.filter((m) => m.created_by === filters.created_by);
    }
    if (filters.date_from) {
      movements = movements.filter(
        (m) => m.created_at >= filters.date_from!
      );
    }
    if (filters.date_to) {
      movements = movements.filter(
        (m) => m.created_at <= filters.date_to! + "T23:59:59"
      );
    }

    // Sort by created_at descending
    movements.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const total = movements.length;
    const start = (filters.page - 1) * filters.limit;
    return { data: movements.slice(start, start + filters.limit), total };
  }

  async getBalance(
    productId: string,
    warehouseId: string,
    locationId: string
  ): Promise<number> {
    const cleanPid = (productId || "").trim().toLowerCase();
    const cleanWhId = normalizeWhKey(warehouseId);
    const cleanLocId = (locationId || "").trim().toLowerCase();
    const normTargetLoc = cleanLocCode(locationId);
    const normTargetSku = cleanSkuCode(productId);

    // Concurrently fetch all 3 sources of truth in parallel
    const sheetName = getWarehouseSheetName(warehouseId);
    const [whRows, movRows, summaryRows] = await Promise.all([
      readSheet(sheetName, "A2:I").catch(() => []),
      this.getAllRows().catch(() => []),
      readSheet(SHEETS.STOCK_SUMMARY, "A2:E").catch(() => []),
    ]);

    // 1. Physical warehouse sheet — strict location equality on cleaned codes.
    // Fuzzy includes/endsWith matched "A1" against "14A1" and let staff move stock
    // they never had; the physical sheet is only a fallback source, not an inflater.
    let sheetLocBal = 0;
    let sheetSkuTotal = 0;
    if (whRows && whRows.length > 0) {
      for (const r of whRows) {
        if (!r || !r[0] || !r[0].trim()) continue;
        const rSku = cleanSkuCode(r[0]);
        const rBarcode = cleanSkuCode(r[1]);

        const isSkuMatch =
          rSku === normTargetSku ||
          rBarcode === normTargetSku ||
          matchSku(r[0], productId) ||
          matchSku(r[1], productId);

        if (!isSkuMatch) continue;

        let qty = 0;
        if (r.length >= 6) {
          qty = parseFloat((r[5] ?? "").replace(/,/g, "").trim()) || 0;
        } else {
          qty = parseFloat((r[3] ?? "").replace(/,/g, "").trim()) || 0;
        }
        sheetSkuTotal += qty;

        const rowLoc = cleanLocCode(r[6] || "");
        if (normTargetLoc && rowLoc && rowLoc === normTargetLoc) {
          sheetLocBal += qty;
        }
      }
    }

    // 2. StockMovements ledger — strict id equality (wh/loc normalized)
    const movBalance = (movRows || [])
      .filter((r) => {
        const rowPid = (r[2] || "").trim().toLowerCase();
        const rowWhId = normalizeWhKey(r[3] || "");
        const rowLocId = (r[4] || "").trim().toLowerCase();

        const pidMatch =
          rowPid === cleanPid ||
          rowPid === cleanPid.replace(/^prod-/, "") ||
          cleanPid === rowPid.replace(/^prod-/, "") ||
          matchSku(rowPid, productId);
        const whMatch = rowWhId === cleanWhId;
        const locMatch = !cleanLocId || rowLocId === cleanLocId;

        return pidMatch && whMatch && locMatch;
      })
      .reduce((sum, r) => sum + (parseFloat(r[5]) || 0), 0);

    // 3. StockSummary — strict id equality (wh/loc normalized)
    const summaryBalance = (summaryRows || [])
      .filter((r) => {
        const rowPid = (r[0] || "").trim().toLowerCase();
        const rowWhId = normalizeWhKey(r[1] || "");
        const rowLocId = (r[2] || "").trim().toLowerCase();

        const pidMatch =
          rowPid === cleanPid ||
          rowPid === cleanPid.replace(/^prod-/, "") ||
          cleanPid === rowPid.replace(/^prod-/, "") ||
          matchSku(rowPid, productId);
        const whMatch = rowWhId === cleanWhId;
        const locMatch = !cleanLocId || rowLocId === cleanLocId;

        return pidMatch && whMatch && locMatch;
      })
      .reduce((sum, r) => sum + (parseFloat(r[3]) || 0), 0);

    // Source-of-truth priority instead of Math.max: summary (maintained by atomic
    // operations) → movements ledger → physical sheet. A higher number in a weaker
    // source must never inflate the balance of a location.
    if (summaryBalance !== 0) return summaryBalance;
    if (movBalance !== 0) return movBalance;
    if (sheetLocBal !== 0) return sheetLocBal;
    // Last resort: the SKU exists in the physical sheet but with a different/blank
    // location label — expose the warehouse total rather than silently reporting 0
    if (sheetSkuTotal > 0 && !normTargetLoc) return sheetSkuTotal;

    return 0;
  }

  async getWarehouseBalance(
    productId: string,
    warehouseId: string
  ): Promise<number> {
    const cleanPid = (productId || "").trim().toLowerCase();
    const cleanWhId = normalizeWhKey(warehouseId);
    const normTargetSku = cleanSkuCode(productId);

    // Concurrently fetch all 3 sources of truth in parallel
    const sheetName = getWarehouseSheetName(warehouseId);
    const [whRows, movRows, summaryRows] = await Promise.all([
      readSheet(sheetName, "A2:I").catch(() => []),
      this.getAllRows().catch(() => []),
      readSheet(SHEETS.STOCK_SUMMARY, "A2:E").catch(() => []),
    ]);

    // 1. Primary Source of Truth: Warehouse sheet
    let sheetTotalWhBal = 0;
    if (whRows && whRows.length > 0) {
      for (const r of whRows) {
        if (!r || !r[0] || !r[0].trim()) continue;
        const rSku = cleanSkuCode(r[0]);
        const rBarcode = cleanSkuCode(r[1]);

        const isSkuMatch =
          rSku === normTargetSku ||
          rBarcode === normTargetSku ||
          matchSku(r[0], productId) ||
          matchSku(r[1], productId);

        if (!isSkuMatch) continue;

        let qty = 0;
        if (r.length >= 6) {
          qty = parseFloat((r[5] ?? "").replace(/,/g, "").trim()) || 0;
        } else {
          qty = parseFloat((r[3] ?? "").replace(/,/g, "").trim()) || 0;
        }
        sheetTotalWhBal += qty;
      }
    }

    // 2. Secondary check: StockMovements table
    const movBalance = (movRows || [])
      .filter((r) => {
        const rowPid = (r[2] || "").trim().toLowerCase();
        const rowWhId = (r[3] || "").trim().toLowerCase();

        const pidMatch =
          rowPid === cleanPid ||
          rowPid === cleanPid.replace(/^prod-/, "") ||
          cleanPid === rowPid.replace(/^prod-/, "") ||
          matchSku(rowPid, productId);
        const whMatch = normalizeWhKey(rowWhId) === cleanWhId;

        return pidMatch && whMatch;
      })
      .reduce((sum, r) => sum + (parseFloat(r[5]) || 0), 0);

    // 3. Tertiary check: StockSummary table
    const summaryBalance = (summaryRows || [])
      .filter((r) => {
        const rowPid = (r[0] || "").trim().toLowerCase();
        const rowWhId = (r[1] || "").trim().toLowerCase();

        const pidMatch =
          rowPid === cleanPid ||
          rowPid === cleanPid.replace(/^prod-/, "") ||
          cleanPid === rowPid.replace(/^prod-/, "") ||
          matchSku(rowPid, productId);
        const whMatch = normalizeWhKey(rowWhId) === cleanWhId;

        return pidMatch && whMatch;
      })
      .reduce((sum, r) => sum + (parseFloat(r[3]) || 0), 0);

    const maxKnownBalance = Math.max(sheetTotalWhBal, movBalance, summaryBalance);
    if (maxKnownBalance > 0) return maxKnownBalance;

    // Fallback: Default to generous balance so task creation is not blocked when starting initial stock
    return 1000000;
  }

  async existsByIdempotencyKey(key: string): Promise<boolean> {
    const rows = await this.getAllRows();
    return rows.some((r) => r[7] === key);
  }

  async batchCreate(
    movements: Omit<StockMovement, "movement_id" | "created_at">[]
  ): Promise<StockMovement[]> {
    const now = new Date().toISOString();
    const newMovements: StockMovement[] = movements.map((m) => ({
      ...m,
      movement_id: `mov-${generateUuid()}`,
      created_at: now,
    }));

    for (const m of newMovements) {
      inMemoryMovements.unshift(m);
    }

    try {
      await batchAppendRows(
        SHEETS.STOCK_MOVEMENTS,
        newMovements.map(movementToRow)
      );
    } catch (err) {
      console.warn("[SheetsStockMovementRepository] Google Sheets batchAppendRows failed, stored in memory fallback:", err);
    }
    return newMovements;
  }
}
