import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { withStockLocks, formatStockLockKey } from "@/lib/locking";
import { logAudit } from "@/lib/audit";
import {
  successResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  conflictResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { setDocumentStatus } from "@/lib/document-status-store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    try {
      authorize(actor, PERMISSIONS.DOCUMENT_REJECT);
    } catch (authErr: unknown) {
      if (authErr && typeof authErr === "object" && "statusCode" in authErr && (authErr as any).statusCode === 401) {
        return unauthorizedResponse((authErr as any).message);
      }
      return forbiddenResponse(authErr instanceof Error ? authErr.message : "คุณไม่มีสิทธิ์ปฏิเสธเอกสารนี้");
    }

    const { id } = await params;
    setDocumentStatus(id, "REJECTED");

    const repo = getRepository();
    const doc = (await repo.documents.findById(id)) || (await repo.documents.findByNo(id));
    if (!doc) {
      return notFoundResponse("ไม่พบเอกสารขอรับสินค้านี้");
    }

    if (doc.status !== "PENDING") {
      return conflictResponse(`ไม่สามารถปฏิเสธเอกสารสถานะ ${doc.status || "ไม่ทราบสถานะ"}`);
    }

    return await withStockLocks(formatStockLockKey("any", "any", id), async () => {
      await repo.documents.updateStatus(doc.document_id, "REJECTED");

      await logAudit(repo.audit, {
        actorId: actor.id,
        actorRole: actor.role,
        action: "STOCK_RECEIVE",
        resourceType: "Document",
        resourceId: doc.document_id,
        outcome: "SUCCESS",
        metadata: {
          status: "REJECTED",
        },
      });

      return successResponse({ id: doc.document_id, status: "REJECTED" }, "ปฏิเสธรายการรับสินค้าเรียบร้อยแล้ว");
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
