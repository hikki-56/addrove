import type { NextRequest } from "next/server";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession } from "@/server/security";
import { getRepository } from "@/server/repositories";
import { canApproveAssignLocation, canAssignLocation } from "@/lib/assign-location";

/** ระบุตัวผู้ใช้ + สิทธิ์ (role/email ยืนยันจาก DB) สำหรับ API คำขอระบุตำแหน่ง */
export async function assignRequestActor(req: NextRequest) {
  const session = await getAuthSession(req);
  const actor = await createActorFromSession(req, session);
  if (!session?.user?.id || !actor) return null;
  const dbUser = await getRepository().users.findById(session.user.id).catch(() => null);
  if (!dbUser?.active) return null;
  const email = dbUser.email || null;
  return {
    actor,
    email,
    canRequest: canAssignLocation(actor.role, email),
    // ผู้อนุมัติ = role ADMIN ตาม DB (ไม่ใช้ role จาก session)
    canApprove: canApproveAssignLocation(dbUser.role),
  };
}
