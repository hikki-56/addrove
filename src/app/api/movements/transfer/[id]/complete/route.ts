import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { completeTransfer, mapStockErrorToResponse, CompleteTransferSchema, StockNotFoundError } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    const resolvedParams = await params;
    const docId = resolvedParams.id;
    const body = await req.json().catch(() => ({}));

    const parsed = CompleteTransferSchema.safeParse(body);
    if (!parsed.success) {
      return mapStockErrorToResponse(parsed.error);
    }

    const repo = getRepository();
    const existingDoc = (await repo.documents.findById(docId)) || (await repo.documents.findByNo(docId));
    if (!existingDoc) {
      return mapStockErrorToResponse(new StockNotFoundError("ไม่พบเอกสารใบย้ายสินค้า"));
    }

    let meta: Record<string, any> = {};
    try {
      meta = JSON.parse(existingDoc.note || "{}");
    } catch {}

    const destinationWh = meta.to_warehouse_id || "wh-2";

    try {
      authorize(actor, PERMISSIONS.STOCK_TRANSFER_COMPLETE, destinationWh);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const targetToLocId = parsed.data.to_location_id || parsed.data.completed_location_id || "";
    const targetFromLocId = parsed.data.from_location_id || "";

    const doc = await completeTransfer(
      { repo },
      docId,
      targetToLocId,
      targetFromLocId,
      actor.id,
      actor.role,
      actor.warehouseAccess,
      parsed.data.source_allocations,
      session?.user?.name || actor.id
    );

    return successResponse(doc, "ดำเนินการย้ายสินค้าและปรับปรุงสต็อกสำเร็จเรียบร้อยแล้ว");
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
