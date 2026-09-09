/**
 * Repository factory.
 * Returns all repositories backed by the configured storage driver.
 */
import type { IStockRepository } from "./interfaces";
import { getStorageDriver, type StorageDriver } from "./storage-driver";
import { createPostgresRepository } from "./postgres";
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
export { DashboardDataError } from "./sheets/dashboard.repository";

let instance: { driver: StorageDriver; repository: IStockRepository } | null = null;

function createSheetsRepository(): IStockRepository {
  return {
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

function createRepositoryForDriver(driver: StorageDriver): IStockRepository {
  if (driver === "postgres") {
    return createPostgresRepository();
  }

  return createSheetsRepository();
}

export function getRepository(): IStockRepository {
  const driver = getStorageDriver();

  if (!instance || instance.driver !== driver) {
    instance = {
      driver,
      repository: createRepositoryForDriver(driver),
    };
  }

  return instance.repository;
}

export function createInMemoryRepository(): IStockRepository {
  return new InMemoryStockRepository();
}
