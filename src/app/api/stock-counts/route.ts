import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { CreateStockCountSchema } from "@/types/api";
import { StockCountService } from "@/lib/services/stock-count.service";
import {
  successResponse, unauthorizedResponse, forbiddenResponse,
  zodErrorResponse, serverErrorResponse,
} from "@/lib/api-response";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouse_id") ?? undefined;
    const repo = getRepository();
    const counts = await repo.stockCounts.findAll(warehouseId);
    return successResponse(counts, "โหลดรายการตรวจนับสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    if (session.user.role === "VIEWER") return forbiddenResponse();
    const body = await req.json();
    const input = CreateStockCountSchema.parse(body);
    const repo = getRepository();
    const svc = new StockCountService(repo);
    const count = await svc.createCount(input, session.user.id);
    return successResponse(count, "เพิ่มรายการตรวจนับสำเร็จ", 201);
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
