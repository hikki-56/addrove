import type { StockMovement, MovementWithDetails } from "@/types/models";
import type { MovementFilterInput } from "@/types/api";

export interface IStockMovementRepository {
  findByDocumentId(documentId: string): Promise<StockMovement[]>;
  findAll(filters?: MovementFilterInput): Promise<{ data: MovementWithDetails[]; total: number }>;
  getBalance(productId: string, warehouseId: string, locationId: string): Promise<number>;
  getWarehouseBalance(productId: string, warehouseId: string): Promise<number>;
  existsByIdempotencyKey(key: string): Promise<boolean>;
  batchCreate(movements: Omit<StockMovement, "movement_id" | "created_at">[]): Promise<StockMovement[]>;
}
