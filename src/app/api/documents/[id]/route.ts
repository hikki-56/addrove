import { NextRequest } from "next/server";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { hasWarehouseAccess } from "@/server/api-response";
import type { StockMovement } from "@/types/models";
import {
  successResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/server/api-response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();

    const { id } = await params;
    const repo = getRepository();
    const doc = await repo.documents.findById(id);
    if (!doc) return notFoundResponse("ไม่พบเอกสาร");
    const movements = await repo.movements.findByDocumentId(id);
    if (
      session.user.role !== "ADMIN" &&
      doc.created_by !== session.user.id &&
      (movements.length === 0 ||
        movements.some((movement: StockMovement) =>
          !hasWarehouseAccess(session.user.warehouse_access, movement.warehouse_id)
        ))
    ) return forbiddenResponse("คุณไม่มีสิทธิ์ดูเอกสารนี้");
    return successResponse({ document: doc, movements }, "โหลดรายละเอียดเอกสารสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
