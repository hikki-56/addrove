import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { listBills } from "@/lib/services/outbound/outbound-bill.service";

export const maxDuration = 60;

/** GET /api/outbound/bills — รายการบิลส่งของออกทั้งหมด + นับตามสถานะ */
export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.STOCK_VIEW);
    } catch {
      return forbiddenResponse();
    }

    const repo = getRepository();
    const result = await listBills(repo);
    return successResponse(result);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
