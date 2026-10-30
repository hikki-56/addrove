import type { NextRequest } from "next/server";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession } from "@/server/security";
import { getRepository } from "@/server/repositories";
import { getAssignLocationAccess } from "@/lib/assign-location";
import { parseMenuHrefs } from "@/lib/menu-visibility";

/** ระบุตัวผู้ใช้ + สิทธิ์ (role/email ยืนยันจาก DB) สำหรับ API คำขอระบุตำแหน่ง */
export async function assignRequestActor(req: NextRequest) {
  const session = await getAuthSession(req);
  const actor = await createActorFromSession(req, session);
  if (!session?.user?.id || !actor) return null;
  const dbUser = await getRepository().users.findById(session.user.id).catch(() => null);
  if (!dbUser?.active) return null;
  const email = dbUser.email || null;
  // role/email/เมนูที่ ty ตั้งให้ อ่านจาก DB ทั้งหมด (ไม่เชื่อ session)
  const access = getAssignLocationAccess(dbUser.role, email, parseMenuHrefs(dbUser.menu_hrefs));
  return {
    actor,
    email,
    canRequest: access.assign,
    // ผู้อนุมัติ = ADMIN ตาม DB หรือผู้ที่ได้รับเมนู "คำขอระบุตำแหน่ง"
    canApprove: access.approve,
    canViewRequests: access.requests || access.approve,
  };
}
