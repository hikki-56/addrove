import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { MovementFilterSchema } from "@/types/api";
import {
  successResponse, unauthorizedResponse, forbiddenResponse, serverErrorResponse,
  getAccessibleWarehouseIds, hasWarehouseAccess,
} from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const rawFilters = Object.fromEntries(searchParams.entries());
    const filters = MovementFilterSchema.parse(rawFilters);
    const accessibleWarehouses = getAccessibleWarehouseIds(session.user.warehouse_access);
    if (session.user.role !== "ADMIN" && accessibleWarehouses !== null && !filters.warehouse_id) {
      return forbiddenResponse("กรุณาระบุโกดังเพื่อดูประวัติการเคลื่อนไหว");
    }
    if (
      filters.warehouse_id &&
      session.user.role !== "ADMIN" &&
      !hasWarehouseAccess(session.user.warehouse_access, filters.warehouse_id)
    ) return forbiddenResponse("คุณไม่มีสิทธิ์ดูประวัติโกดังนี้");
    const repo = getRepository();
    const result = await repo.movements.findAll(filters);
    return successResponse(result, "โหลดประวัติสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
