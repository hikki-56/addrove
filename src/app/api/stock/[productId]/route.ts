import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { InventoryService } from "@/lib/services/inventory.service";
import {
  successResponse, unauthorizedResponse, notFoundResponse, serverErrorResponse,
} from "@/lib/api-response";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    const { productId } = await params;
    const repo = getRepository();
    const product = await repo.products.findById(productId);
    if (!product) return notFoundResponse("ไม่พบสินค้า");
    const service = new InventoryService(repo);
    const all = await service.getStockBalance();
    const found = all.find((b) => b.product_id === productId);
    return successResponse(found ?? { product_id: productId, total_quantity: 0, by_warehouse: [] }, "โหลดยอดคงเหลือสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
