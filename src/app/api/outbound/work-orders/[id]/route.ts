import { NextRequest } from "next/server";
import { z } from "zod";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { getAuthSession } from "@/lib/auth-session";
import {
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import {
  cancelWorkOrder,
  getWorkOrderDetail,
  resolveWorkOrderShortage,
  sendWorkOrder,
} from "@/lib/services/outbound/work-order.service";
import { OutboundStateError } from "@/lib/services/outbound/outbound-state-machine";
import { OutboundReservationError } from "@/lib/services/outbound/stock-reservation.service";

export const maxDuration = 60;

const PatchActionSchema = z.object({
  action: z.enum(["send", "cancel", "resolve-shortage"]),
  outcome: z.enum(["REDUCE_QTY", "CANCEL"]).optional(),
  reason: z.string().max(300).optional(),
});

/** GET /api/outbound/work-orders/[id] — รายละเอียดใบงาน (ทุกกล่อง Q) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.STOCK_VIEW);
    } catch {
      return forbiddenResponse("คุณไม่มีสิทธิ์ดูใบงาน Q");
    }

    const { id } = await params;
    const repo = getRepository();
    const { doc, note } = await getWorkOrderDetail(repo, decodeURIComponent(id));
    return successResponse(
      {
        document_id: doc.document_id,
        document_no: doc.document_no,
        created_at: doc.created_at,
        outbound_status: note.outbound_status,
        warehouse_id: note.warehouse_id,
        title: note.customer,
        items: note.items,
        q_boxes: note.q_boxes,
        exceptions: note.exceptions,
        issue_document_no: note.issue_document_no,
        sent_by: note.sent_by,
        sent_at: note.sent_at,
        cancel_reason: note.cancel_reason,
      },
      "โหลดรายละเอียดใบงานสำเร็จ"
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith("ไม่พบ")) return errorResponse(message, 404);
    return serverErrorResponse(e);
  }
}

/**
 * PATCH /api/outbound/work-orders/[id] — Admin จัดการใบงาน
 *  - send: ยืนยันส่งใบงานถึงพนักงาน (ตรวจสต็อก → ตัดสต็อก → READY_TO_PICK)
 *  - cancel: ยกเลิก (ได้เฉพาะร่าง)
 *  - resolve-shortage: ตัดสินใบงานของไม่ครบ (REDUCE_QTY / CANCEL + คืนสต็อก)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.OUTBOUND_APPROVE);
    } catch {
      return forbiddenResponse("เฉพาะแอดมินเท่านั้นที่จัดการใบงาน Q ได้");
    }

    const body = await req.json().catch(() => ({}));
    const parsed = PatchActionSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(", "), 400);
    }

    const { id } = await params;
    const key = decodeURIComponent(id);
    const repo = getRepository();

    switch (parsed.data.action) {
      case "send": {
        const result = await sendWorkOrder(repo, key, actor);
        return successResponse(
          result,
          `ส่งใบงาน ${result.document_no} แล้ว — ตัดสต็อกผ่านเอกสาร ${result.issue_document_no} พนักงานสแกนกล่อง Q เริ่มหยิบได้เลย`
        );
      }
      case "cancel": {
        const result = await cancelWorkOrder(repo, key, actor, parsed.data.reason);
        return successResponse(result, "ยกเลิกร่างใบงานแล้ว");
      }
      case "resolve-shortage": {
        if (!parsed.data.outcome) {
          return errorResponse("กรุณาระบุผลการตัดสิน (REDUCE_QTY หรือ CANCEL)", 400);
        }
        const result = await resolveWorkOrderShortage(
          repo,
          key,
          parsed.data.outcome,
          actor,
          parsed.data.reason
        );
        return successResponse(result, result.message);
      }
    }
  } catch (e) {
    if (e instanceof OutboundStateError) return errorResponse(e.message, 409);
    if (e instanceof OutboundReservationError) return errorResponse(e.message, 409);
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith("ไม่พบ")) return errorResponse(message, 404);
    return serverErrorResponse(e);
  }
}
