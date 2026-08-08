import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { completeTransfer, mapStockErrorToResponse, CompleteTransferSchema } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    try {
      authorize(actor, PERMISSIONS.STOCK_TRANSFER_COMPLETE);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = CompleteTransferSchema.safeParse(body);
    if (!parsed.success) {
      return mapStockErrorToResponse(parsed.error);
    }

    const repo = getRepository();
    const doc = await completeTransfer(
      { repo },
      id,
      parsed.data.completed_location_id,
      actor.id,
      actor.role,
      actor.warehouseAccess
    );

    return successResponse(doc, "ยืนยันรับเข้าโกดังปลายทางเรียบร้อยแล้ว");
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
