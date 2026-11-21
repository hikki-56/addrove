import { canManageUserMenus } from "@/lib/menu-visibility";
import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, serverErrorResponse, successResponse, unauthorizedResponse, zodErrorResponse } from "@/server/api-response";
import { authorize, createActorFromSession, isAuthorized, PERMISSIONS, SecurityError, type Actor, ForbiddenError } from "@/server/security";
import { query } from "@/server/repositories/postgres/database";
import { getStorageDriver } from "@/server/repositories/storage-driver";
import { withMaintenanceGuard } from "@/server/storage-transaction";
import { countSubmission, CountProblem, findCountProduct, findCountLocation, countReport, submitCount } from "@/server/services/count-round.service";

async function handle(req: NextRequest, action: (actor: Actor, reviewer: boolean) => Promise<unknown>) {
  try {
    const actor = await createActorFromSession(req);
    if (!actor) return unauthorizedResponse();
    if (getStorageDriver() !== "postgres") return errorResponse("เมนูตรวจนับต้องใช้ฐานข้อมูล PostgreSQL", 503);
    const [user] = await query<{ email: string; full_name: string }>("select email, full_name from users where active and user_id=$1", [actor.id]);
    if (!user) return unauthorizedResponse();
    const reviewer = canManageUserMenus(user.email);
    authorize(actor, reviewer ? PERMISSIONS.STOCK_COUNT_VIEW : PERMISSIONS.STOCK_COUNT);
    return successResponse(await action({ ...actor, username: user.full_name }, reviewer));
  } catch (error) {
    if (error instanceof CountProblem) return errorResponse(error.message, error.status);
    if (error instanceof SecurityError) return errorResponse(error.message, error.statusCode);
    if (error instanceof z.ZodError) return zodErrorResponse(error);
    if (error instanceof SyntaxError) return errorResponse("รูปแบบข้อมูลไม่ถูกต้อง");
    if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
      return errorResponse("ยังไม่ได้ติดตั้งตารางตรวจนับในฐานข้อมูล", 503);
    }
    return serverErrorResponse(error);
  }
}

export function GET(req: NextRequest) {
  return handle(req, async (actor, reviewer) => {
    const params = req.nextUrl.searchParams;
    const warehouse = params.get("warehouse");
    const permission = reviewer ? PERMISSIONS.STOCK_COUNT_VIEW : PERMISSIONS.STOCK_COUNT;
    if (!warehouse) {
      const rows = await query<{ warehouse_id: string; warehouse_name: string }>("select warehouse_id, warehouse_name from warehouses where active order by warehouse_code");
      return { warehouses: rows.filter(row => isAuthorized(actor, permission, row.warehouse_id)), userId: actor.id, reviewer };
    }
    authorize(actor, permission, warehouse);
    if (params.has("date")) {
      if (!reviewer) throw new ForbiddenError();
      return countReport(warehouse, z.iso.date().parse(params.get("date")));
    }
    if (reviewer) throw new ForbiddenError();
    const code = z.string().trim().min(1).max(200);
    if (params.has("product")) return findCountProduct(code.parse(params.get("product")));
    if (params.has("location")) return findCountLocation(warehouse, code.parse(params.get("location")));
    throw new CountProblem("กรุณาเปิดหน้าตรวจนับใหม่", 400);
  });
}

export const POST = withMaintenanceGuard((req: NextRequest) =>
  handle(req, async (actor, reviewer) => {
    if (reviewer) throw new ForbiddenError();
    return submitCount(countSubmission.parse(await req.json()), actor);
  }));
