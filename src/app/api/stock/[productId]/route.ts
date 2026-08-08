import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { getStockBalances } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  notFoundResponse,
  serverErrorResponse,
  getAccessibleWarehouseIds,
  hasWarehouseAccess,
} from "@/lib/api-response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const { productId } = await params;
    const repo = getRepository();
    const product = await repo.products.findById(productId);
    if (!product) return notFoundResponse("ไม่พบสินค้า");

    const all = await getStockBalances({ repo });
    let found = all.find((b) => b.product_id === productId);
    const accessibleWarehouses = getAccessibleWarehouseIds(session.user.warehouse_access);
    if (found && session.user.role !== "ADMIN" && accessibleWarehouses !== null) {
      const byWarehouse = found.by_warehouse.filter((entry) =>
        hasWarehouseAccess(session.user.warehouse_access, entry.warehouse_id)
      );
      const totalQuantity = byWarehouse.reduce((sum, entry) => sum + entry.quantity, 0);
      const status =
        totalQuantity < 0
          ? ("NEGATIVE" as const)
          : totalQuantity === 0
          ? ("OUT" as const)
          : totalQuantity <= found.minimum_stock
          ? ("LOW" as const)
          : ("NORMAL" as const);
      found = { ...found, by_warehouse: byWarehouse, total_quantity: totalQuantity, status };
    }
    return successResponse(
      found ?? { product_id: productId, total_quantity: 0, by_warehouse: [] },
      "โหลดยอดคงเหลือสำเร็จ"
    );
  } catch (e) {
    return serverErrorResponse(e);
  }
}
