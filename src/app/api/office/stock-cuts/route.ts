import type { NextRequest } from "next/server";
import { isOfficeWarehouse } from "@/lib/office";
import { forbiddenResponse, successResponse, unauthorizedResponse } from "@/server/api-response";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { authorize, createActorFromSession, PERMISSIONS, SecurityError } from "@/server/security";
import { cutOfficeStock, OfficeStockCutSchema } from "@/server/services/office-stock-cut.service";
import { getOfficeProducts } from "@/server/services/office.service";
import { mapStockErrorToResponse } from "@/server/services/stock/stock-error-mapper";
import { StockNotFoundError } from "@/server/services/stock/stock-errors";
import { withStorageRequest } from "@/server/storage-transaction";

export const maxDuration = 60;

async function handle(req: NextRequest) {
  try {
    const actor = await createActorFromSession(req, await getAuthSession(req));
    if (!actor) return unauthorizedResponse();
    authorize(actor, PERMISSIONS.OFFICE_STOCK_CUT);
    const repo = getRepository();
    const office = (await repo.warehouses.findAll()).find(w => w.active && isOfficeWarehouse(w));
    if (!office) throw new StockNotFoundError("ไม่พบคลังสำนักงานใหญ่ที่เปิดใช้งาน");
    authorize(actor, PERMISSIONS.OFFICE_STOCK_CUT, office.warehouse_id);
    if (req.method === "GET") return successResponse(await getOfficeProducts(repo, office.warehouse_id, true));
    const input = OfficeStockCutSchema.parse(await req.json().catch(() => null));
    const doc = await cutOfficeStock(repo, office.warehouse_id, input, actor);
    return successResponse(doc, "ตัดสต็อกสำนักงานใหญ่แล้ว", 201);
  } catch (error) {
    if (error instanceof SecurityError) return forbiddenResponse(error.message);
    return mapStockErrorToResponse(error);
  }
}

export const GET = handle;
export const POST = withStorageRequest(handle);
