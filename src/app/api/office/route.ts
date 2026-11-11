import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession, authorize, PERMISSIONS, SecurityError } from "@/server/security";
import { getRepository } from "@/server/repositories";
import { successResponse, unauthorizedResponse, forbiddenResponse, hasWarehouseAccess } from "@/server/api-response";
import { getOfficeSetup, getOfficeProducts, getOfficeHistory, transferToOffice, OfficeTransferSchema } from "@/server/services/office.service";
import { mapStockErrorToResponse } from "@/server/services/stock/stock-error-mapper";
import { StockNotFoundError } from "@/server/services/stock/stock-errors";
import { withStorageRequest } from "@/server/storage-transaction";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    authorize(actor, PERMISSIONS.STOCK_VIEW);
    const repo = getRepository();
    const setup = await getOfficeSetup(repo);
    const canAccess = (id: string) => actor.role === "ADMIN" || hasWarehouseAccess(actor.warehouseAccess || "", id);
    const view = z.enum(["setup", "products", "history"]).parse(req.nextUrl.searchParams.get("view") || "products");
    if (view === "setup") return successResponse({ ...setup, warehouses: setup.warehouses.filter((w) => canAccess(w.warehouse_id)) });
    if (view === "history") {
      authorize(actor, PERMISSIONS.DOCUMENT_VIEW);
      const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(req.nextUrl.searchParams.get("date_from") ?? undefined);
      return successResponse((await getOfficeHistory(repo, from)).filter((row) => canAccess(row.from_warehouse_id)));
    }
    const sourceId = req.nextUrl.searchParams.get("warehouse_id");
    const warehouseId = sourceId || setup.office?.warehouse_id;
    if (!warehouseId) throw new StockNotFoundError("ยังไม่มีออฟฟิศที่เปิดใช้งาน");
    // This menu grants employees a view of the fixed office warehouse, even
    // when their daily warehouse assignment is elsewhere. Source pickers keep
    // the normal warehouse restrictions.
    if (sourceId) authorize(actor, PERMISSIONS.STOCK_VIEW, warehouseId);
    else authorize(actor, PERMISSIONS.OFFICE_VIEW);
    return successResponse(await getOfficeProducts(repo, warehouseId, !!sourceId));
  } catch (error) {
    if (error instanceof SecurityError) return forbiddenResponse(error.message);
    return mapStockErrorToResponse(error);
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    const input = OfficeTransferSchema.parse(await req.json().catch(() => ({})));
    authorize(actor, PERMISSIONS.OFFICE_TRANSFER, input.from_warehouse_id);
    const repo = getRepository();
    const { office } = await getOfficeSetup(repo);
    if (!office) throw new StockNotFoundError("ยังไม่มีออฟฟิศที่เปิดใช้งาน");
    authorize(actor, PERMISSIONS.OFFICE_TRANSFER, office.warehouse_id);
    const doc = await transferToOffice(repo, input, { id: actor.id, name: session?.user.name || actor.username, role: actor.role, correlationId: actor.correlationId });
    return successResponse(doc, "เบิกไปออฟฟิศเรียบร้อยแล้ว", 201);
  } catch (error) {
    if (error instanceof SecurityError) return forbiddenResponse(error.message);
    return mapStockErrorToResponse(error);
  }
}

export const POST = withStorageRequest(handlePOST);
