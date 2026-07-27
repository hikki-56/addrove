/**
 * Repository factory.
 * Returns all repositories backed by Google Sheets.
 * In future, swap this to return Postgres-backed repositories
 * by changing only this file.
 */
import type { IStockRepository } from "./interfaces";
import { SheetsWarehouseRepository } from "./sheets/warehouse.repository";
import { SheetsLocationRepository } from "./sheets/location.repository";
import { SheetsProductRepository } from "./sheets/product.repository";
import { SheetsDocumentRepository } from "./sheets/document.repository";
import { SheetsStockMovementRepository } from "./sheets/movement.repository";
import { SheetsStockSummaryRepository } from "./sheets/stock-summary.repository";
import { SheetsStockCountRepository } from "./sheets/stock-count.repository";
import { SheetsUserRepository } from "./sheets/user.repository";
import { SheetsDashboardRepository } from "./sheets/dashboard.repository";

let instance: IStockRepository | null = null;

export function getRepository(): IStockRepository {
  if (!instance) {
    instance = {
      warehouses: new SheetsWarehouseRepository(),
      locations: new SheetsLocationRepository(),
      products: new SheetsProductRepository(),
      documents: new SheetsDocumentRepository(),
      movements: new SheetsStockMovementRepository(),
      stockSummary: new SheetsStockSummaryRepository(),
      stockCounts: new SheetsStockCountRepository(),
      users: new SheetsUserRepository(),
      dashboard: new SheetsDashboardRepository(),
    };
  }
  return instance;
}
