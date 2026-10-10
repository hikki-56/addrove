import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { submitTransferMove, mapStockErrorToResponse, SubmitTransferSchema } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { finishStockWorkflowTiming } from "@/lib/stock-workflow-timing";

export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = performance.now();
  let itemCount: number | undefined;
  const finish = (response: Response) =>
    finishStockWorkflowTiming(response, startedAt, {
      operation: "stock-transfer-submit",
      itemCount,
    });

  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return finish(unauthorizedResponse());

    // Read-only users must not be able to submit (and thereby take over) transfer tasks
    if (actor.role === "VIEWER") {
      return finish(forbiddenResponse("ผู้ใช้งานแบบดูอย่างเดียวไม่สามารถส่งงานย้ายสินค้าได้"));
    }

    const resolvedParams = await params;
    const docId = resolvedParams.id;
    const body = await req.json().catch(() => ({}));
    itemCount = Array.isArray(body.source_allocations) ? body.source_allocations.length : 1;

    const parsed = SubmitTransferSchema.safeParse(body);
    if (!parsed.success) {
      return finish(mapStockErrorToResponse(parsed.error));
    }

    const repo = getRepository();
    const doc = await submitTransferMove(
      { repo },
      docId,
      {
        fromLocationId: parsed.data.from_location_id,
        toLocationId: parsed.data.to_location_id || parsed.data.completed_location_id,
        sourceAllocations: parsed.data.source_allocations,
        userId: actor.id,
        userName: session?.user?.name || actor.id,
        userRole: actor.role,
      }
    );

    return finish(successResponse(doc, "ย้ายสินค้าและส่งเรื่องให้ Admin อนุมัติการนำข้อมูลเข้าระบบเรียบร้อยแล้ว"));
  } catch (e) {
    return finish(mapStockErrorToResponse(e) || serverErrorResponse(e));
  }
}
