import {
  readSheet,
  appendRows,
  batchUpdateRows,
  deleteRows,
  SHEETS,
} from "@/lib/google-sheets/client";
import type { IStockSummaryRepository } from "../interfaces";
import type { StockSummary } from "@/types/models";
import { withKeyedLock } from "@/lib/keyed-lock";

// Columns: product_id, warehouse_id, location_id, quantity, last_updated
function rowToSummary(row: string[]): StockSummary {
  return {
    product_id: row[0] ?? "",
    warehouse_id: row[1] ?? "",
    location_id: row[2] ?? "",
    quantity: parseFloat(row[3] ?? "0") || 0,
    last_updated: row[4] ?? "",
  };
}

export class SheetsStockSummaryRepository implements IStockSummaryRepository {
  private async getAllRows(): Promise<string[][]> {
    return readSheet(SHEETS.STOCK_SUMMARY, "A2:E");
  }

  async findAll(warehouseId?: string): Promise<StockSummary[]> {
    const rows = await this.getAllRows();
    const summaries = rows.filter((r) => r[0]).map(rowToSummary);
    return warehouseId
      ? summaries.filter((s) => s.warehouse_id === warehouseId)
      : summaries;
  }

  async findByProductAndLocation(
    productId: string,
    warehouseId: string,
    locationId: string
  ): Promise<StockSummary | null> {
    const rows = await this.getAllRows();
    const row = rows.find(
      (r) => r[0] === productId && r[1] === warehouseId && r[2] === locationId
    );
    return row ? rowToSummary(row) : null;
  }

  async applyChanges(
    changes: {
      productId: string;
      warehouseId: string;
      locationId: string;
      delta: number;
    }[]
  ): Promise<void> {
    try {
      await withKeyedLock("stock-summary", async () => {
        const rows = await this.getAllRows().catch(() => []);
        const now = new Date().toISOString();
        const updates: { rowNumber: number; values: (string | number)[] }[] = [];
        const newRows: (string | number)[][] = [];

        const aggregated = new Map<
          string,
          { productId: string; warehouseId: string; locationId: string; delta: number }
        >();
        for (const change of changes) {
          const key = `${change.productId}|${change.warehouseId}|${change.locationId}`;
          const current = aggregated.get(key);
          if (current) current.delta += change.delta;
          else aggregated.set(key, { ...change });
        }

        for (const change of aggregated.values()) {
          const idx = rows.findIndex(
            (r) =>
              r[0] === change.productId &&
              r[1] === change.warehouseId &&
              r[2] === change.locationId
          );
          if (idx !== -1) {
            const current = parseFloat(rows[idx][3] ?? "0") || 0;
            const newQty = current + change.delta;
            rows[idx][3] = String(newQty);
            rows[idx][4] = now;
            updates.push({
              rowNumber: idx + 2,
              values: [
                change.productId,
                change.warehouseId,
                change.locationId,
                newQty,
                now,
              ],
            });
          } else {
            newRows.push([
              change.productId,
              change.warehouseId,
              change.locationId,
              change.delta,
              now,
            ]);
          }
        }

        if (updates.length > 0) {
          await batchUpdateRows(SHEETS.STOCK_SUMMARY, updates).catch(() => {});
        }
        if (newRows.length > 0) {
          await appendRows(SHEETS.STOCK_SUMMARY, newRows).catch(() => {});
        }
      });
    } catch (err) {
      console.warn("[SheetsStockSummaryRepository] applyChanges warning:", err);
    }
  }

  async rebuild(): Promise<void> {
    // Read all movements and recompute
    const movRows = await readSheet(SHEETS.STOCK_MOVEMENTS, "A2:J");
    const balanceMap = new Map<string, number>();
    const now = new Date().toISOString();

    for (const row of movRows.filter((r) => r[0])) {
      const key = `${row[2]}|${row[3]}|${row[4]}`;
      const qty = parseFloat(row[5] ?? "0") || 0;
      balanceMap.set(key, (balanceMap.get(key) ?? 0) + qty);
    }

    const newSummaries: (string | number)[][] = Array.from(
      balanceMap.entries()
    ).map(([key, qty]) => {
      const [productId, warehouseId, locationId] = key.split("|");
      return [productId, warehouseId, locationId, qty, now];
    });

    // Clear and rewrite (use a dummy first row to maintain header)
    const currentRows = await this.getAllRows();
    if (currentRows.length > 0) {
      await deleteRows(
        SHEETS.STOCK_SUMMARY,
        currentRows.map((_, index) => index + 1)
      );
    }
    if (newSummaries.length > 0) {
      await appendRows(SHEETS.STOCK_SUMMARY, newSummaries);
    }
  }
}
