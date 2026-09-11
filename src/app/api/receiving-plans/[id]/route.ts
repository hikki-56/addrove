import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { getReceivingPlan, mapStockErrorToResponse } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    try {
      authorize(actor, PERMISSIONS.DOCUMENT_VIEW);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const { id } = await params;
    const plan = await getReceivingPlan({ repo: getRepository() }, id);

    // พนักงานเห็นได้เฉพาะแผนของโกดังที่ตนมีสิทธิ์เท่านั้น
    try {
      authorize(actor, PERMISSIONS.STOCK_VIEW, plan.warehouse_id);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    return successResponse(plan, "ดึงข้อมูลแผนรับสินค้าสำเร็จ");
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
