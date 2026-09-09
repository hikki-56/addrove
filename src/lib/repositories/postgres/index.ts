import type { IStockRepository } from "../interfaces";
import { assertPostgresRepositoryConfig } from "./config";
import {
  PostgresAuditRepository,
  PostgresDashboardRepository,
  PostgresDocumentRepository,
  PostgresIdempotencyRepository,
  PostgresLocationRepository,
  PostgresOperationJournalRepository,
  PostgresProductRepository,
  PostgresShelfRepository,
  PostgresStockCountRepository,
  PostgresStockMovementRepository,
  PostgresStockSummaryRepository,
  PostgresUserRepository,
  PostgresWarehouseRepository,
  PostgresWarehouseSyncRepository,
} from "./scaffold.repository";

export class PostgresStockRepository implements IStockRepository {
  warehouses = new PostgresWarehouseRepository();
  locations = new PostgresLocationRepository();
  shelves = new PostgresShelfRepository();
  products = new PostgresProductRepository();
  documents = new PostgresDocumentRepository();
  movements = new PostgresStockMovementRepository();
  stockSummary = new PostgresStockSummaryRepository();
  stockCounts = new PostgresStockCountRepository();
  users = new PostgresUserRepository();
  dashboard = new PostgresDashboardRepository();
  idempotency = new PostgresIdempotencyRepository();
  audit = new PostgresAuditRepository();
  journal = new PostgresOperationJournalRepository();
  warehouseSync = new PostgresWarehouseSyncRepository();
}

export function createPostgresRepository(): IStockRepository {
  assertPostgresRepositoryConfig();
  return new PostgresStockRepository();
}
