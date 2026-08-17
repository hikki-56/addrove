import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { CreateWarehouseSchema } from "@/types/api";
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
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const repo = getRepository();
    const allWarehouses = await repo.warehouses.findAll().catch(() => []);
    const warehouses = allWarehouses;
    return successResponse(warehouses, "โหลดข้อมูลโกดังสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่สามารถเพิ่มโกดัง");
    const body = await req.json();
    const input = CreateWarehouseSchema.parse(body);
    const repo = getRepository();
    const existing = await repo.warehouses.findByCode(input.warehouse_code);
    if (existing) return errorResponse("รหัสโกดังนี้มีอยู่ในระบบแล้ว");
    const warehouse = await repo.warehouses.create(input);
    return successResponse(warehouse, "เพิ่มโกดังสำเร็จ", 201);
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
