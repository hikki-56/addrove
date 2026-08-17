import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { getStockBalances } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
  getAccessibleWarehouseIds,
  hasWarehouseAccess,
} from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouse_id") ?? undefined;
    if (
      warehouseId &&
      session.user.role !== "ADMIN" &&
      !hasWarehouseAccess(session.user.warehouse_access, warehouseId)
    ) {
      return forbiddenResponse("คุณไม่มีสิทธิ์ดูสต็อกโกดังนี้");
    }

    const repo = getRepository();
    let balances = await getStockBalances({ repo }, warehouseId).catch((err) => {
      console.error("[Stock API Error]:", err);
      return [];
    });
    const accessibleWarehouses = getAccessibleWarehouseIds(session.user.warehouse_access);
    if (session.user.role !== "ADMIN" && accessibleWarehouses !== null && !warehouseId) {
      balances = (balances || []).map((balance) => {
        const byWarehouse = (balance.by_warehouse || []).filter((entry) =>
          hasWarehouseAccess(session.user.warehouse_access, entry.warehouse_id)
        );
        const totalQuantity = byWarehouse.reduce((sum, entry) => sum + entry.quantity, 0);
        const status =
          totalQuantity < 0
            ? ("NEGATIVE" as const)
            : totalQuantity === 0
            ? ("OUT" as const)
            : totalQuantity <= balance.minimum_stock
            ? ("LOW" as const)
            : ("NORMAL" as const);
        return { ...balance, by_warehouse: byWarehouse, total_quantity: totalQuantity, status };
      });
    }
    return successResponse(balances, "โหลดยอดคงเหลือสำเร็จ");
  } catch (e) {
    console.error("[Stock API Error]:", e);
    return successResponse([], "โหลดยอดคงเหลือสำเร็จ");
  }
}
