import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, serverErrorResponse, successResponse, unauthorizedResponse, zodErrorResponse } from "@/server/api-response";
import { authorize, createActorFromSession, isAuthorized, PERMISSIONS, SecurityError, type Actor } from "@/server/security";
import { query } from "@/server/repositories/postgres/database";
import { getStorageDriver } from "@/server/repositories/storage-driver";
import { withMaintenanceGuard } from "@/server/storage-transaction";
import { countCommand, CountProblem, findCountProduct, listRounds, roundReport, runCountCommand } from "@/server/services/count-round.service";

async function handle(req: NextRequest, action: (actor: Actor) => Promise<unknown>) {
  try {
    const actor = await createActorFromSession(req);
    if (!actor) return unauthorizedResponse();
    authorize(actor, PERMISSIONS.STOCK_COUNT);
    if (getStorageDriver() !== "postgres") return errorResponse("เมนูตรวจนับต้องใช้ฐานข้อมูล PostgreSQL", 503);
    return successResponse(await action(actor));
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
  return handle(req, async actor => {
    const params = req.nextUrl.searchParams;
    const warehouse = params.get("warehouse");
    if (!warehouse) {
      const rows = await query<{ warehouse_id: string; warehouse_name: string }>("select warehouse_id, warehouse_name from warehouses where active order by warehouse_code");
      return { warehouses: rows.filter(row => isAuthorized(actor, PERMISSIONS.STOCK_COUNT, row.warehouse_id)),
        userId: actor.id, canCloseAll: isAuthorized(actor, PERMISSIONS.STOCK_COUNT_APPROVE) };
    }
    authorize(actor, PERMISSIONS.STOCK_COUNT, warehouse);
    if (params.has("product")) return findCountProduct(z.string().trim().min(1).max(200).parse(params.get("product")));
    if (params.has("round")) return roundReport(warehouse, z.uuid().parse(params.get("round")));
    return listRounds(warehouse);
  });
}

export const POST = withMaintenanceGuard((req: NextRequest) =>
  handle(req, async actor => runCountCommand(countCommand.parse(await req.json()), actor)));
