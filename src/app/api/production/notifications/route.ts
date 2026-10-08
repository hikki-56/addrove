import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/server/security";
import {
  guardProductionRoute,
  productionErrorResponse,
} from "@/lib/production/production-route-helpers";
import { listNotifications, markNotificationsRead } from "@/lib/production/production-job.service";

export const maxDuration = 60;

// GET /api/production/notifications — แจ้งเตือนตามบทบาทผู้ใช้ (ADMIN/APPROVER) + จำนวนยังไม่อ่าน
export async function GET(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_VIEW);
    if (!guard.ok) return guard.response;

    const role = guard.actor.role === "ADMIN" ? "ADMIN" : "APPROVER";
    const result = await listNotifications(role, guard.actor.id);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return productionErrorResponse(error);
  }
}

// PATCH /api/production/notifications — ทำเครื่องหมายอ่านแล้ว (body: { ids: string[] } หรือ { ids: "all" })
export async function PATCH(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_VIEW);
    if (!guard.ok) return guard.response;

    const body = await req.json().catch(() => ({}));
    const ids = body?.ids;
    if (ids !== "all" && !Array.isArray(ids)) {
      return NextResponse.json(
        { success: false, message: "รูปแบบไม่ถูกต้อง (ids ต้องเป็นรายการหรือ \"all\")" },
        { status: 400 }
      );
    }
    const role = guard.actor.role === "ADMIN" ? "ADMIN" : "APPROVER";
    await markNotificationsRead(role, guard.actor.id, ids);
    return NextResponse.json({ success: true, message: "ทำเครื่องหมายอ่านแล้วเรียบร้อย" });
  } catch (error) {
    return productionErrorResponse(error);
  }
}
