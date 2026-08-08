import {
  readSheet,
  appendRows,
  updateRow,
  SHEETS,
} from "@/lib/google-sheets/client";
import type { IStockCountRepository } from "../interfaces";
import type { StockCount, StockCountStatus } from "@/types/models";
import type { CreateStockCountInput } from "@/types/api";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Columns: count_id, count_no, product_id, warehouse_id, location_id, system_qty, counted_qty, difference, status, counted_by, counted_at, approved_by, approved_at
function rowToCount(row: string[]): StockCount {
  return {
    count_id: row[0] ?? "",
    count_no: row[1] ?? "",
    product_id: row[2] ?? "",
    warehouse_id: row[3] ?? "",
    location_id: row[4] ?? "",
    system_qty: parseFloat(row[5] ?? "0") || 0,
    counted_qty: row[6] ? parseFloat(row[6]) : null,
    difference: row[7] ? parseFloat(row[7]) : null,
    status: (row[8] as StockCountStatus) ?? "PENDING",
    counted_by: row[9] || null,
    counted_at: row[10] || null,
    approved_by: row[11] || null,
    approved_at: row[12] || null,
  };
}

function countToRow(c: StockCount): (string | number)[] {
  return [
    c.count_id,
    c.count_no,
    c.product_id,
    c.warehouse_id,
    c.location_id,
    c.system_qty,
    c.counted_qty ?? "",
    c.difference ?? "",
    c.status,
    c.counted_by ?? "",
    c.counted_at ?? "",
    c.approved_by ?? "",
    c.approved_at ?? "",
  ];
}

export class SheetsStockCountRepository implements IStockCountRepository {
  private async getAllRows(): Promise<string[][]> {
    return readSheet(SHEETS.STOCK_COUNTS, "A2:M");
  }

  async findAll(warehouseId?: string): Promise<StockCount[]> {
    const rows = await this.getAllRows();
    const counts = rows.filter((r) => r[0]).map(rowToCount);
    return warehouseId
      ? counts.filter((c) => c.warehouse_id === warehouseId)
      : counts;
  }

  async findById(id: string): Promise<StockCount | null> {
    const rows = await this.getAllRows();
    const row = rows.find((r) => r[0] === id);
    return row ? rowToCount(row) : null;
  }

  async create(
    input: CreateStockCountInput & { system_qty: number; count_no: string }
  ): Promise<StockCount> {
    const newCount: StockCount = {
      count_id: `cnt-${generateUuid()}`,
      count_no: input.count_no,
      product_id: input.product_id,
      warehouse_id: input.warehouse_id,
      location_id: input.location_id,
      system_qty: input.system_qty,
      counted_qty: input.counted_qty,
      difference: input.counted_qty - input.system_qty,
      status: "COUNTED",
      counted_by: null,
      counted_at: new Date().toISOString(),
      approved_by: null,
      approved_at: null,
    };
    await appendRows(SHEETS.STOCK_COUNTS, [countToRow(newCount)]);
    return newCount;
  }

  async update(
    id: string,
    updates: Partial<StockCount>
  ): Promise<StockCount | null> {
    const rows = await this.getAllRows();
    const idx = rows.findIndex((r) => r[0] === id);
    if (idx === -1) return null;
    const count = rowToCount(rows[idx]);
    const updated: StockCount = { ...count, ...updates };
    await updateRow(SHEETS.STOCK_COUNTS, idx + 2, countToRow(updated));
    return updated;
  }
}
