import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { submitTransferMove, mapStockErrorToResponse, SubmitTransferSchema, StockNotFoundError } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    const resolvedParams = await params;
    const docId = resolvedParams.id;
    const body = await req.json().catch(() => ({}));

    const parsed = SubmitTransferSchema.safeParse(body);
    if (!parsed.success) {
      return mapStockErrorToResponse(parsed.error);
    }

    const repo = getRepository();
    const existingDoc = (await repo.documents.findById(docId)) || (await repo.documents.findByNo(docId));
    if (!existingDoc) {
      return mapStockErrorToResponse(new StockNotFoundError("ไม่พบเอกสารใบย้ายสินค้า"));
    }

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

    return successResponse(doc, "ย้ายสินค้าและส่งเรื่องให้ Admin อนุมัติการนำข้อมูลเข้าระบบเรียบร้อยแล้ว");
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
