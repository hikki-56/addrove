import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { CreateLocationSchema } from "@/types/api";
import {
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  zodErrorResponse,
  serverErrorResponse,
  hasWarehouseAccess,
} from "@/lib/api-response";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouse_id") ?? undefined;
    const repo = getRepository();
    let locations = await repo.locations.findAll(warehouseId);
    // Filter by access
    if (session.user.role !== "ADMIN") {
      locations = locations.filter((l) =>
        hasWarehouseAccess(session.user.warehouse_access, l.warehouse_id)
      );
    }
    return successResponse(locations, "โหลดข้อมูลตำแหน่งสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse();
    const body = await req.json();
    const input = CreateLocationSchema.parse(body);
    const repo = getRepository();
    const existing = await repo.locations.findByCode(
      `${input.warehouse_id.substring(0, 4)}-Z${input.zone}-${input.aisle}-R${input.rack}-S${input.shelf}-B${input.bin}`
    );
    if (existing) return errorResponse("รหัสตำแหน่งนี้มีอยู่แล้ว");
    const location = await repo.locations.create(input);
    return successResponse(location, "เพิ่มตำแหน่งสำเร็จ", 201);
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
