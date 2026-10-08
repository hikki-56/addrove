import type { StockSummary } from "@/types/models";

export interface IStockSummaryRepository {
  findAll(warehouseId?: string): Promise<StockSummary[]>;
  findByProductAndLocation(
    productId: string,
    warehouseId: string,
    locationId: string
  ): Promise<StockSummary | null>;
  applyChanges(
    changes: { productId: string; warehouseId: string; locationId: string; delta: number }[]
  ): Promise<void>;
  rebuild(): Promise<void>;
}
