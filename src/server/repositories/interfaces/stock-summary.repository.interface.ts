import type { StockSummary } from "@/types/models";

export interface IStockSummaryRepository {
  findAll(warehouseId?: string): Promise<StockSummary[]>;
  findByProductAndLocation(
    productId: string,
    warehouseId: string,
    locationId: string
  ): Promise<StockSummary | null>;
  allocateTransferSources?(
    productId: string,
    warehouseId: string,
    qty: number,
    preferredLocation: string
  ): Promise<Array<{ location_id: string; qty: number }>>;
  /** บันทึกจำนวนราง (stock_summary.rack_count) ของสินค้า ณ ตำแหน่ง */
  setRackCount?(productId: string, warehouseId: string, locationId: string, rackCount: number | null): Promise<void>;
  applyChanges(
    changes: { productId: string; warehouseId: string; locationId: string; delta: number }[]
  ): Promise<void>;
  rebuild(): Promise<void>;
}
