import type { IStockRepository } from "../interfaces";
import { assertPostgresRepositoryConfig } from "./config";
import { PostgresStockRepository } from "./stock.repository";
export { PostgresStockRepository } from "./stock.repository";

export function createPostgresRepository(): IStockRepository {
  assertPostgresRepositoryConfig();
  return new PostgresStockRepository();
}
