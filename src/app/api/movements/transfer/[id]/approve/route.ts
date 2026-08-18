import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { completeTransfer, mapStockErrorToResponse, StockNotFoundError } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
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

    if (actor.role !== "ADMIN" && actor.role !== "MANAGER") {
      return forbiddenResponse("เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถอนุมัติการย้ายสินค้าได้");
    }

    const { id: docId } = await params;
    const body = await req.json().catch(() => ({}));

    const repo = getRepository();
    let existingDoc = (await repo.documents.findById(docId)) || (await repo.documents.findByNo(docId));
    if (!existingDoc) {
      const allDocs = await repo.documents.findAll({ page: 1, limit: 9999, document_type: "TRANSFER" as any });
      const cleanTargetId = docId.trim().toLowerCase();
      existingDoc = allDocs.data.find(
        (d) =>
          d.document_id.trim().toLowerCase() === cleanTargetId ||
          d.document_no.trim().toLowerCase() === cleanTargetId
      ) || null;
    }
    if (!existingDoc) {
      return mapStockErrorToResponse(new StockNotFoundError("ไม่พบเอกสารใบย้ายสินค้า"));
    }

    let meta: Record<string, any> = {};
    try {
      meta = JSON.parse(existingDoc.note || "{}");
    } catch {}

    const destinationWh = meta.to_warehouse_id || "wh-2";

    try {
      authorize(actor, PERMISSIONS.STOCK_TRANSFER_COMPLETE, destinationWh);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const targetToLocId = body.to_location_id || meta.to_location_id || "";
    const targetFromLocId = body.from_location_id || meta.from_location_id || "";
    const allocations = Array.isArray(body.source_allocations) && body.source_allocations.length > 0
      ? body.source_allocations
      : meta.source_allocations;

    const doc = await completeTransfer(
      { repo },
      docId,
      targetToLocId,
      targetFromLocId,
      actor.id,
      actor.role,
      actor.warehouseAccess,
      allocations
    );

    return successResponse(doc, "อนุมัติการย้ายสินค้าและบันทึกข้อมูลเข้าระบบเรียบร้อยแล้ว");
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
