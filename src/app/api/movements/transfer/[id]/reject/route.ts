import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { cancelTransfer, mapStockErrorToResponse } from "@/lib/services/stock";
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

    if (actor.role !== "ADMIN" && actor.role !== "MANAGER" && actor.role !== "APPROVER") {
      return forbiddenResponse("เฉพาะ Admin, Manager หรือผู้อนุมัติ เท่านั้นที่สามารถปฏิเสธรายการได้");
    }

    try {
      authorize(actor, PERMISSIONS.STOCK_TRANSFER_CANCEL);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const note = body.note || "ปฏิเสธโดย Admin";

    const repo = getRepository();
    const doc = await cancelTransfer(
      { repo },
      id,
      note,
      actor.id,
      actor.role,
      actor.warehouseAccess
    );

    return successResponse(doc, "ปฏิเสธรายการย้ายสินค้าเรียบร้อยแล้ว");
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
