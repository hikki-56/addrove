import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository, DashboardDataError } from "@/lib/repositories";
import {
  successResponse, unauthorizedResponse, forbiddenResponse, serverErrorResponse,
  errorResponse, getAccessibleWarehouseIds, hasWarehouseAccess,
} from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    let stats;
    try {
      stats = await repo.dashboard.getStats(warehouseId, days);
    } catch (err) {
      if (err instanceof DashboardDataError) {
        console.error(
          `[Dashboard API] โหลดข้อมูลไม่สำเร็จ — sheet: ${err.sheet}, operation: ${err.operation}`,
          err
        );
        return errorResponse(
          "โหลดข้อมูล Dashboard ไม่สำเร็จ: อ่านข้อมูลจาก Google Sheets ไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง",
          503
        );
      }
      throw err;
    }
    return successResponse(stats, "โหลดข้อมูล Dashboard สำเร็จ");
  } catch (e) {
    console.error("[Dashboard API] unexpected error:", e);
    return serverErrorResponse(e);
  }
}
