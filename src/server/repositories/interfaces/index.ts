export * from "./product.repository.interface";
export * from "./warehouse.repository.interface";
export * from "./location.repository.interface";
export * from "./shelf.repository.interface";
export * from "./document.repository.interface";
export * from "./movement.repository.interface";
export * from "./stock-summary.repository.interface";
export * from "./stock-count.repository.interface";
export * from "./user.repository.interface";
export * from "./dashboard.repository.interface";
export * from "./idempotency.repository.interface";
export * from "./audit.repository.interface";
export * from "./operation-journal.repository.interface";
export * from "./warehouse-sync.repository.interface";

import type { IWarehouseRepository } from "./warehouse.repository.interface";
import type { ILocationRepository } from "./location.repository.interface";
import type { IShelfRepository } from "./shelf.repository.interface";
import type { IProductRepository } from "./product.repository.interface";
import type { IDocumentRepository } from "./document.repository.interface";
import type { IStockMovementRepository } from "./movement.repository.interface";
import type { IStockSummaryRepository } from "./stock-summary.repository.interface";
import type { IStockCountRepository } from "./stock-count.repository.interface";
import type { IUserRepository } from "./user.repository.interface";
import type { IDashboardRepository } from "./dashboard.repository.interface";
import type { IIdempotencyRepository } from "./idempotency.repository.interface";
import type { IAuditRepository } from "./audit.repository.interface";
import type { IOperationJournalRepository } from "./operation-journal.repository.interface";
import type { IWarehouseSyncRepository } from "./warehouse-sync.repository.interface";

export interface IStockRepository {
  warehouses: IWarehouseRepository;
  locations: ILocationRepository;
  shelves: IShelfRepository;
  products: IProductRepository;
  documents: IDocumentRepository;
  movements: IStockMovementRepository;
  stockSummary: IStockSummaryRepository;
  stockCounts: IStockCountRepository;
  users: IUserRepository;
  dashboard: IDashboardRepository;
  idempotency: IIdempotencyRepository;
  audit: IAuditRepository;
  journal: IOperationJournalRepository;
  warehouseSync: IWarehouseSyncRepository;
}
