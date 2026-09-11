import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import {
  listReceivingPlans,
  createReceivingPlan,
  mapStockErrorToResponse,
  ReceivingPlanCreateSchema,
} from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { hasWarehouseAccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouse_id") || undefined;
    const status = searchParams.get("status") || undefined;

    try {
      authorize(actor, PERMISSIONS.STOCK_VIEW, warehouseId);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const plans = await listReceivingPlans({ repo: getRepository() }, { warehouse_id: warehouseId, status });

    // ไม่ได้ระบุโกดัง (เช่น badge บน sidebar) — พนักงานเห็นได้เฉพาะแผนของโกดังที่ตนมีสิทธิ์
    let visiblePlans = plans;
    if (actor.role !== "ADMIN" && !warehouseId) {
      visiblePlans = plans.filter((p) => hasWarehouseAccess(actor.warehouseAccess || "", p.warehouse_id));
    }

    return successResponse(visiblePlans, "ดึงรายการแผนรับสินค้าสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    const body = await req.json().catch(() => ({}));
    const parsed = ReceivingPlanCreateSchema.safeParse(body);
    if (!parsed.success) {
      return mapStockErrorToResponse(parsed.error);
    }

    try {
      authorize(actor, PERMISSIONS.RECEIVE_PLAN_CREATE, parsed.data.warehouse_id);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const view = await createReceivingPlan(
      { repo: getRepository() },
      {
        ...parsed.data,
        user_id: actor.id,
        role: actor.role,
        correlation_id: actor.correlationId,
        created_by_name:
          (session?.user?.name as string) ||
          (actor.role === "ADMIN" ? "ผู้ดูแลระบบ (Admin)" : "ผู้สร้างแผนรับสินค้า"),
      }
    );

    return successResponse(view, "สร้างแผนรับสินค้าสำเร็จ", 201);
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
