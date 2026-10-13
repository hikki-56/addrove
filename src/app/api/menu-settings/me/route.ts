import { NextRequest } from "next/server";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { canManageUserMenus, parseMenuHrefs } from "@/lib/menu-visibility";
import { successResponse, unauthorizedResponse, serverErrorResponse } from "@/server/api-response";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const user = await getRepository().users.findById(session.user.id);
    if (!user?.active) return unauthorizedResponse();
    return successResponse({ menu_hrefs: parseMenuHrefs(user.menu_hrefs), can_manage: canManageUserMenus(user.email) });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
