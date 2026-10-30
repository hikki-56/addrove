import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { hasGrantedPermission, PERMISSIONS } from "@/server/security";
import { getRepository } from "@/server/repositories";
import { CreateShelfSchema } from "@/types/api";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  hasWarehouseAccess,
  zodErrorResponse,
  serverErrorResponse,
} from "@/server/api-response";
import { ZodError } from "zod";
import { getAuthSession } from "@/server/auth-session";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const locationId = searchParams.get("location_id") || undefined;
    const repo = getRepository();
    if (locationId && session.user.role !== "ADMIN") {
      const location = await repo.locations.findById(locationId);
      if (!location || !hasWarehouseAccess(session.user.warehouse_access, location.warehouse_id)) {
        return forbiddenResponse("คุณไม่มีสิทธิ์ดูชั้นวางในโกดังนี้");
      }
    }
    let shelves = await repo.shelves.findAll(locationId);
    if (!locationId && session.user.role !== "ADMIN") {
      const locations = await repo.locations.findAll();
      const allowedLocationIds = new Set(
        locations
          .filter((location) => hasWarehouseAccess(session.user.warehouse_access, location.warehouse_id))
          .map((location) => location.location_id)
      );
      shelves = shelves.filter((shelf) => allowedLocationIds.has(shelf.location_id));
    }
    return successResponse(shelves);
  } catch (e) {
    return serverErrorResponse(e);
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const isAdmin = session.user.role === "ADMIN";
    if (!isAdmin && !(await hasGrantedPermission(session.user.id, session.user.role, PERMISSIONS.LOCATION_MANAGE))) {
      return forbiddenResponse("เฉพาะ Admin หรือผู้ที่ได้รับเมนูนี้เท่านั้นที่สร้างชั้นวางได้");
    }
    const body = await req.json();
    const input = CreateShelfSchema.parse(body);
    const repo = getRepository();
    if (!isAdmin) {
      const location = await repo.locations.findById(input.location_id);
      if (!location || !hasWarehouseAccess(session.user.warehouse_access, location.warehouse_id)) {
        return forbiddenResponse("คุณไม่มีสิทธิ์สร้างชั้นวางในโกดังนี้");
      }
    }
    const shelf = await repo.shelves.create(input);
    return successResponse(shelf, "สร้างชั้นวางสินค้าสำเร็จ", 201);
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}

export const POST = withStorageRequest(handlePOST);
