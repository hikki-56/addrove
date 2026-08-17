import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import {
  successResponse, unauthorizedResponse, forbiddenResponse, serverErrorResponse,
  getAccessibleWarehouseIds, hasWarehouseAccess,
} from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouse_id") ?? undefined;
    const accessibleWarehouses = getAccessibleWarehouseIds(session.user.warehouse_access);
    if (session.user.role !== "ADMIN" && accessibleWarehouses !== null && !warehouseId) {
      return forbiddenResponse("กรุณาระบุโกดังที่คุณมีสิทธิ์เข้าถึง");
    }
    if (
      warehouseId &&
      session.user.role !== "ADMIN" &&
      !hasWarehouseAccess(session.user.warehouse_access, warehouseId)
    ) return forbiddenResponse("คุณไม่มีสิทธิ์ดูข้อมูลโกดังนี้");
    const days = parseInt(searchParams.get("days") ?? "7");
    const repo = getRepository();
    const stats = await repo.dashboard.getStats(warehouseId, days).catch(() => ({
      total_sku: 0,
      total_quantity: 0,
      low_stock_count: 0,
      out_of_stock_count: 0,
      received_today: 0,
      issued_today: 0,
      recent_movements: [],
      chart_data: [],
    }));
    return successResponse(stats, "โหลดข้อมูล Dashboard สำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
