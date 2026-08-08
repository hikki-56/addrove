import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { cancelTransfer, mapStockErrorToResponse, CancelTransferSchema } from "@/lib/services/stock";
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
      authorize(actor, PERMISSIONS.STOCK_TRANSFER_CANCEL);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = CancelTransferSchema.safeParse(body);

    const repo = getRepository();
    const doc = await cancelTransfer(
      { repo },
      id,
      parsed.success ? parsed.data.note : undefined,
      actor.id,
      actor.role,
      actor.warehouseAccess
    );

    return successResponse(doc, "ยกเลิกใบย้ายสินค้าเรียบร้อยแล้ว");
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
