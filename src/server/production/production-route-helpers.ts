// Helper กลางสำหรับ API routes ระบบผลิต — จบเรื่อง auth + zod + error mapping ในที่เดียว
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/server/security";
import type { Permission } from "@/server/security";
import {
  unauthorizedResponse,
  forbiddenResponse,
  zodErrorResponse,
} from "@/server/api-response";
import { ProductionError } from "@/server/production/production-job.service";
import type { ProductionActor } from "@/server/production/production-job.service";
import type { ZodSchema } from "zod";

export interface GuardedRoute {
  ok: true;
  actor: ProductionActor;
}
export interface GuardedFail {
  ok: false;
  response: NextResponse;
}

/** ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ทุกครั้ง — ไม่ใช่แค่ซ่อนปุ่ม */
export async function guardProductionRoute(
  req: NextRequest,
  permission: Permission
): Promise<GuardedRoute | GuardedFail> {
  const session = await getAuthSession(req);
  const sessionActor = await createActorFromSession(req, session);
  if (!sessionActor) {
    return { ok: false, response: unauthorizedResponse() };
  }
  try {
    authorize(sessionActor, permission);
  } catch (authErr: unknown) {
    if (
      authErr &&
      typeof authErr === "object" &&
      "statusCode" in authErr &&
      (authErr as { statusCode?: number }).statusCode === 401
    ) {
      return {
        ok: false,
        response: unauthorizedResponse(
          (authErr as { message?: string }).message || "กรุณาเข้าสู่ระบบก่อนดำเนินการ"
        ),
      };
    }
    return {
      ok: false,
      response: forbiddenResponse(
        authErr instanceof Error ? authErr.message : "คุณไม่มีสิทธิ์ใช้งานส่วนนี้"
      ),
    };
  }
  const actor: ProductionActor = {
    id: sessionActor.id,
    name:
      session?.user?.name ||
      (sessionActor as { username?: string }).username ||
      session?.user?.email?.split("@")[0] ||
      "ผู้ใช้งาน",
    role: sessionActor.role,
  };
  return { ok: true, actor };
}

/** แปลง ProductionError / error ทั่วไป เป็น NextResponse */
export function productionErrorResponse(err: unknown): NextResponse {
  if (err instanceof ProductionError) {
    return NextResponse.json(
      { success: false, message: err.message },
      { status: err.statusCode }
    );
  }
  console.error("[ProductionRoute] error:", err);
  return NextResponse.json(
    { success: false, message: err instanceof Error ? err.message : "เกิดข้อผิดพลาดในระบบผลิต" },
    { status: 500 }
  );
}

export async function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: zodErrorResponse(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

export { PERMISSIONS };
