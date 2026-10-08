import type { StockCount } from "@/types/models";
import type { CreateStockCountInput } from "@/types/api";

export interface IStockCountRepository {
  findAll(warehouseId?: string): Promise<StockCount[]>;
  findById(id: string): Promise<StockCount | null>;
  create(input: CreateStockCountInput & { system_qty: number; count_no: string }): Promise<StockCount>;
  update(id: string, updates: Partial<StockCount>): Promise<StockCount | null>;
}
