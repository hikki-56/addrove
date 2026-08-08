import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { issueStock, mapStockErrorToResponse, IssueStockSchema } from "@/lib/services/stock";
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
    const parsed = IssueStockSchema.safeParse(body);
    if (!parsed.success) {
      return mapStockErrorToResponse(parsed.error);
    }

    try {
      authorize(actor, PERMISSIONS.STOCK_ISSUE, parsed.data.warehouse_id);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const repo = getRepository();
    const doc = await issueStock(
      { repo },
      {
        ...parsed.data,
        user_id: actor.id,
        role: actor.role,
        correlation_id: actor.correlationId,
      }
    );

    return successResponse(doc, "เบิกสินค้าออกและตัดยอดสต็อกเรียบร้อยแล้ว", 201);
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
