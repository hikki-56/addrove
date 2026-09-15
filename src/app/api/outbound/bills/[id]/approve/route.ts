import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  conflictResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import {
  approveOutboundPick,
  rejectOutboundPick,
  OutboundApproveError,
} from "@/lib/services/outbound/outbound-approve.service";
import { ApprovePickSchema } from "@/lib/services/outbound/outbound-schemas";

export const maxDuration = 60;

/**
 * POST /api/outbound/bills/[id]/approve — แอดมินอนุมัติบิล (ยืนยันจำนวนที่หยิบ → ตัดสต็อก)
 * { outcome: "APPROVE" } | { outcome: "REJECT", reject_to: "REPICK" | "CANCEL" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.OUTBOUND_APPROVE);
    } catch {
      return forbiddenResponse("เฉพาะแอดมิน/ผู้จัดการที่อนุมัติบิลได้");
    }

    const body = await req.json().catch(() => ({}));
    const parsed = ApprovePickSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(", "), 400);
    }

    const { id } = await params;
    const key = decodeURIComponent(id);
    const repo = getRepository();

    if (parsed.data.outcome === "APPROVE") {
      const result = await approveOutboundPick(repo, key, actor, { reason: parsed.data.reason });
      return successResponse(
        result,
        `อนุมัติบิลสำเร็จ — ตัดสต็อกแล้ว (เอกสาร ${result.issue_document_no}) พร้อมแพ็กได้ทันที`
      );
    }

    if (!parsed.data.reject_to) {
      return errorResponse("ต้องระบุ reject_to (REPICK หรือ CANCEL)", 400);
    }
    const result = await rejectOutboundPick(
      repo,
      key,
      parsed.data.reject_to,
      actor,
      parsed.data.reason
    );
    return successResponse(
      result,
      result.bill_status === "CANCELLED"
        ? "ไม่อนุมัติ — ยกเลิกบิลและปล่อยการจองสต็อกแล้ว"
        : "ไม่อนุมัติ — ส่งกลับไปหยิบใหม่"
    );
  } catch (e) {
    if (e instanceof OutboundApproveError) {
      return conflictResponse(e.message);
    }
    if (e instanceof Error && e.message.startsWith("ไม่พบ")) return notFoundResponse(e.message);
    return serverErrorResponse(e);
  }
}
