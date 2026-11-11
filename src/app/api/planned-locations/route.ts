import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession, authorize, SecurityError, PERMISSIONS } from "@/server/security";
import { getStorageDriver } from "@/server/repositories/storage-driver";
import { getPlannedLocations } from "@/server/services/planned-location.service";
import { successResponse, unauthorizedResponse, forbiddenResponse, errorResponse, serverErrorResponse,
  getAccessibleWarehouseIds, normalizeWarehouseAccessId, zodErrorResponse } from "@/server/api-response";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const actor = await createActorFromSession(req, await getAuthSession(req));
    if (!actor) return unauthorizedResponse();
    authorize(actor, PERMISSIONS.PLANNED_LOCATION_VIEW);
    const warehouseId = z.string().regex(/^wh-0?[1-6]$/i, "รหัสโกดังไม่ถูกต้อง").optional()
      .parse(req.nextUrl.searchParams.get("warehouse_id") ?? undefined);
    if (warehouseId) authorize(actor, PERMISSIONS.STOCK_VIEW, warehouseId);
    if (getStorageDriver() !== "postgres") return errorResponse("ยังไม่พร้อมโหลดตำแหน่งชุดใหม่ กรุณาติดต่อผู้ดูแลระบบ", 503);
    const accessible = warehouseId ? [normalizeWarehouseAccessId(warehouseId)]
      : actor.role === "ADMIN" ? null : getAccessibleWarehouseIds(actor.warehouseAccess);
    return successResponse(await getPlannedLocations(accessible));
  } catch (error) {
    if (error instanceof SecurityError) return forbiddenResponse(error.message);
    if (error instanceof z.ZodError) return zodErrorResponse(error);
    if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
      return errorResponse("ยังไม่ได้เตรียมรายการตำแหน่งชุดใหม่ กรุณาติดต่อผู้ดูแลระบบ", 503);
    }
    return serverErrorResponse(error);
  }
}
