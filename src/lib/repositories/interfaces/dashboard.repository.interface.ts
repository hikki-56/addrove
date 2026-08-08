import type { DashboardStats } from "@/types/models";

export interface IDashboardRepository {
  getStats(warehouseId?: string, days?: number): Promise<DashboardStats>;
}
