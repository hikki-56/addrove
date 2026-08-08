/**
 * Repository factory.
 * Returns all repositories backed by Google Sheets or In-Memory.
 * In future, swap this to return Postgres/Supabase-backed repositories
 * by changing only this file.
 */
import type { IStockRepository } from "./interfaces";
import { SheetsWarehouseRepository } from "./sheets/warehouse.repository";
import { SheetsLocationRepository } from "./sheets/location.repository";
import { SheetsShelfRepository } from "./sheets/shelf.repository";
import { SheetsProductRepository } from "./sheets/product.repository";
import { SheetsDocumentRepository } from "./sheets/document.repository";
import { SheetsStockMovementRepository } from "./sheets/stock-movement.repository";
import { SheetsStockSummaryRepository } from "./sheets/stock-summary.repository";
import { SheetsStockCountRepository } from "./sheets/stock-count.repository";
import { SheetsUserRepository } from "./sheets/user.repository";
import { SheetsDashboardRepository } from "./sheets/dashboard.repository";
import { SheetsIdempotencyRepository } from "./sheets/idempotency.sheets-repository";
import { SheetsAuditRepository } from "./sheets/audit.sheets-repository";
import { SheetsWarehouseSyncRepository } from "./sheets/warehouse-sync.sheets-repository";
import { SheetsOperationJournalRepository } from "./sheets/operation-journal.sheets-repository";
import { InMemoryStockRepository } from "./in-memory/in-memory-stock.repository";

export * from "./interfaces";
export * from "./in-memory/in-memory-stock.repository";

let instance: IStockRepository | null = null;

export function getRepository(): IStockRepository {
  if (!instance) {
    instance = {
      warehouses: new SheetsWarehouseRepository(),
      locations: new SheetsLocationRepository(),
      shelves: new SheetsShelfRepository(),
      products: new SheetsProductRepository(),
      documents: new SheetsDocumentRepository(),
      movements: new SheetsStockMovementRepository(),
      stockSummary: new SheetsStockSummaryRepository(),
      stockCounts: new SheetsStockCountRepository(),
      users: new SheetsUserRepository(),
      dashboard: new SheetsDashboardRepository(),
      idempotency: new SheetsIdempotencyRepository(),
      audit: new SheetsAuditRepository(),
      journal: new SheetsOperationJournalRepository(),
      warehouseSync: new SheetsWarehouseSyncRepository(),
    };
  }
  return instance;
}

export function createInMemoryRepository(): IStockRepository {
  return new InMemoryStockRepository();
}
