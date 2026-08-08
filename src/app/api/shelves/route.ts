import { NextRequest } from "next/server";
import { getRepository } from "@/lib/repositories";
import { CreateShelfSchema } from "@/types/api";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  hasWarehouseAccess,
  zodErrorResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { ZodError } from "zod";
import { getAuthSession } from "@/lib/auth-session";

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

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่สร้างชั้นวางได้");
    const body = await req.json();
    const input = CreateShelfSchema.parse(body);
    const repo = getRepository();
    const shelf = await repo.shelves.create(input);
    return successResponse(shelf, "สร้างชั้นวางสินค้าสำเร็จ", 201);
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
