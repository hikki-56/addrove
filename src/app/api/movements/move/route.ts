import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { moveStock, mapStockErrorToResponse, MoveStockSchema } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    const body = await req.json().catch(() => ({}));
    const parsed = MoveStockSchema.safeParse(body);
    if (!parsed.success) {
      return mapStockErrorToResponse(parsed.error);
    }

    try {
      authorize(actor, PERMISSIONS.STOCK_MOVE, parsed.data.warehouse_id);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    console.log("[API Move] Payload received:", parsed.data);

    const repo = getRepository();
    const doc = await moveStock(
      { repo },
      {
        ...parsed.data,
        user_id: actor.id,
        role: actor.role,
        correlation_id: actor.correlationId,
      }
    );

    console.log("[API Move] Success doc:", doc.document_id);
    return successResponse(doc, "ย้ายตำแหน่งสินค้าและอัปเดตสต็อกเรียบร้อยแล้ว", 201);
  } catch (e) {
    console.error("[API Move] Error:", e);
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
