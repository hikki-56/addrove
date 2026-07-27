import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { InventoryService } from "@/lib/services/inventory.service";
import {
  successResponse, unauthorizedResponse, serverErrorResponse,
} from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouse_id") ?? undefined;
    const repo = getRepository();
    const service = new InventoryService(repo);
    const balances = await service.getStockBalance(warehouseId);
    return successResponse(balances, "โหลดยอดคงเหลือสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
