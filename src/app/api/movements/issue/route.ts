import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/server/security";
import { getRepository } from "@/server/repositories";
import { issueStock, mapStockErrorToResponse, IssueStockSchema } from "@/server/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/server/api-response";
import { finishStockWorkflowTiming } from "@/server/stock-workflow-timing";

export const maxDuration = 60;

async function handlePOST(req: NextRequest) {
  const startedAt = performance.now();
  let warehouseId: string | undefined;
  let itemCount: number | undefined;
  const finish = (response: Response) =>
    finishStockWorkflowTiming(response, startedAt, {
      operation: "stock-issue",
      warehouseId,
      itemCount,
    });

  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return finish(unauthorizedResponse());

    const body = await req.json().catch(() => ({}));
    warehouseId = typeof body.warehouse_id === "string" ? body.warehouse_id : undefined;
    itemCount = Array.isArray(body.lines) ? body.lines.length : undefined;
    const parsed = IssueStockSchema.safeParse(body);
    if (!parsed.success) {
      return finish(mapStockErrorToResponse(parsed.error));
    }

    try {
      authorize(actor, PERMISSIONS.STOCK_ISSUE, parsed.data.warehouse_id);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return finish(unauthorizedResponse(authErr.message));
      return finish(forbiddenResponse(authErr.message));
    }

    const repo = getRepository();
    const doc = await issueStock(
      { repo },
      {
        ...parsed.data,
        user_id: actor.id,
        role: actor.role,
        correlation_id: actor.correlationId,
      }
    );

    return finish(successResponse(doc, "เบิกสินค้าออกและตัดยอดสต็อกเรียบร้อยแล้ว", 201));
  } catch (e) {
    return finish(mapStockErrorToResponse(e) || serverErrorResponse(e));
  }
}

export const POST = withStorageRequest(handlePOST);
