import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { hasGrantedPermission, PERMISSIONS } from "@/server/security";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { UpdateLocationSchema } from "@/types/api";
import {
  successResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  hasWarehouseAccess,
  zodErrorResponse,
  serverErrorResponse,
} from "@/server/api-response";
import { ZodError } from "zod";

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const isAdmin = session.user.role === "ADMIN";
    if (!isAdmin && !(await hasGrantedPermission(session.user.id, session.user.role, PERMISSIONS.LOCATION_MANAGE))) return forbiddenResponse();
    const { id } = await params;
    const body = await req.json();
    const input = UpdateLocationSchema.parse(body);
    const repo = getRepository();
    if (!isAdmin) {
      const current = await repo.locations.findById(id);
      if (!current) return notFoundResponse("ไม่พบตำแหน่ง");
      if (!hasWarehouseAccess(session.user.warehouse_access, current.warehouse_id)) return forbiddenResponse();
      if (input.warehouse_id && !hasWarehouseAccess(session.user.warehouse_access, input.warehouse_id)) return forbiddenResponse();
    }
    const updated = await repo.locations.update(id, input);
    if (!updated) return notFoundResponse("ไม่พบตำแหน่ง");
    return successResponse(updated, "อัปเดตตำแหน่งสำเร็จ");
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}

export const PATCH = withStorageRequest(handlePATCH);
