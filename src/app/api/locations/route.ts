import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { hasGrantedPermission, PERMISSIONS } from "@/server/security";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { CreateLocationSchema } from "@/types/api";
import {
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  zodErrorResponse,
  serverErrorResponse,
  hasWarehouseAccess,
} from "@/server/api-response";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouse_id") ?? undefined;
    const repo = getRepository();
    let locations = await repo.locations.findAll(warehouseId).catch(() => []);
    // Filter by access
    if (session.user.role !== "ADMIN") {
      locations = locations.filter((l: any) =>
        hasWarehouseAccess(session.user.warehouse_access, l.warehouse_id)
      );
    }
    return successResponse(locations, "โหลดข้อมูลตำแหน่งสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const isAdmin = session.user.role === "ADMIN";
    // ไม่ใช่แอดมิน: ต้องได้รับเมนู "ตำแหน่งสินค้าในโกดัง" จาก ty และจำกัดเฉพาะโกดังที่มีสิทธิ์
    if (!isAdmin && !(await hasGrantedPermission(session.user.id, session.user.role, PERMISSIONS.LOCATION_MANAGE))) return forbiddenResponse();
    const body = await req.json();
    const input = CreateLocationSchema.parse(body);
    if (!isAdmin && !hasWarehouseAccess(session.user.warehouse_access, input.warehouse_id)) return forbiddenResponse();
    const codeToCheck = input.location_code || (input.zone ? `${input.warehouse_id.substring(0, 4)}-Z${input.zone}-${input.aisle}-R${input.rack}-S${input.shelf}-B${input.bin}` : `LOC-${Date.now().toString().slice(-6)}`);
    const repo = getRepository();
    const existing = await repo.locations.findByCode(codeToCheck);
    if (existing) return errorResponse("รหัสตำแหน่งนี้มีอยู่แล้ว");
    const location = await repo.locations.create(input);
    return successResponse(location, "เพิ่มตำแหน่งสำเร็จ", 201);
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}

export const POST = withStorageRequest(handlePOST);
