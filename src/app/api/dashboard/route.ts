import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import {
  successResponse, unauthorizedResponse, serverErrorResponse,
} from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouse_id") ?? undefined;
    const days = parseInt(searchParams.get("days") ?? "7");
    const repo = getRepository();
    const stats = await repo.dashboard.getStats(warehouseId, days);
    return successResponse(stats, "โหลดข้อมูล Dashboard สำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
