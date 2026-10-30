import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { canManageUserMenus } from "@/lib/menu-visibility";
import { clearMenuGrantCache } from "@/server/security/menu-grants";
import { toUserMenuSettings } from "@/server/services/menu-settings.service";
import { withStorageRequest } from "@/server/storage-transaction";
import { successResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, errorResponse, zodErrorResponse, serverErrorResponse } from "@/server/api-response";

const UpdateMenuSettingsSchema = z.object({
  user_id: z.string().min(1),
  menu_hrefs: z.array(z.string().min(1)).max(100).nullable(),
}).strict();

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const repo = getRepository();
    const actor = await repo.users.findById(session.user.id);
    if (!actor?.active || !canManageUserMenus(actor.email)) return forbiddenResponse();
    return successResponse((await repo.users.findAll()).map(toUserMenuSettings));
  } catch (error) {
    return serverErrorResponse(error);
  }
}

async function handlePATCH(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const repo = getRepository();
    const actor = await repo.users.findById(session.user.id);
    if (!actor?.active || !canManageUserMenus(actor.email)) return forbiddenResponse();
    const input = UpdateMenuSettingsSchema.parse(await req.json());
    const target = await repo.users.findById(input.user_id);
    if (!target) return notFoundResponse("ไม่พบข้อมูลพนักงาน");
    const available = new Set(toUserMenuSettings(target).available_menus.filter(({ locked }) => !locked).map(({ href }) => href));
    if (input.menu_hrefs?.some((href) => !available.has(href))) {
      return errorResponse("มีเมนูที่ไม่อยู่ในสิทธิ์ของพนักงานคนนี้");
    }
    const updated = await repo.users.update(target.user_id, {
      menu_hrefs: input.menu_hrefs === null ? null : [...new Set(input.menu_hrefs)],
    });
    if (!updated) return notFoundResponse("ไม่พบข้อมูลพนักงาน");
    clearMenuGrantCache(target.user_id);
    return successResponse(toUserMenuSettings(updated), "บันทึกเมนูผู้ใช้สำเร็จ");
  } catch (error) {
    if (error instanceof ZodError) return zodErrorResponse(error);
    return serverErrorResponse(error);
  }
}

export const PATCH = withStorageRequest(handlePATCH);
