import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { cancelReceivingPlan, mapStockErrorToResponse, CancelReceivingPlanSchema } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export const maxDuration = 60;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    try {
      authorize(actor, PERMISSIONS.RECEIVE_PLAN_CANCEL);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = CancelReceivingPlanSchema.safeParse(body);

    const view = await cancelReceivingPlan(
      { repo: getRepository() },
      {
        plan_id: id,
        reason: parsed.success ? parsed.data.reason : "",
        user_id: actor.id,
        user_name: (session?.user?.name as string) || "ผู้ดูแลระบบ (Admin)",
        role: actor.role,
        correlation_id: actor.correlationId,
      }
    );

    return successResponse(view, "ยกเลิกแผนรับสินค้าเรียบร้อยแล้ว");
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
