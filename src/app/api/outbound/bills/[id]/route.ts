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
  serverErrorResponse,
} from "@/lib/api-response";
import {
  getBillDetail,
  activateBill,
  holdBill,
  resumeBill,
  cancelBill,
  resolveShortage,
} from "@/lib/services/outbound/outbound-bill.service";
import { BillPatchActionSchema } from "@/lib/services/outbound/outbound-schemas";
import { OutboundStateError } from "@/lib/services/outbound/outbound-state-machine";

export const maxDuration = 60;

function mapError(e: unknown): ReturnType<typeof errorResponse> {
  if (e instanceof OutboundStateError) return errorResponse(e.message, 409);
  if (e instanceof Error) return errorResponse(e.message, 400);
  return errorResponse("เกิดข้อผิดพลาด", 500);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.STOCK_VIEW);
    } catch {
      return forbiddenResponse();
    }

    const { id } = await params;
    const repo = getRepository();
    const detail = await getBillDetail(repo, decodeURIComponent(id));
    if (!detail) return notFoundResponse("ไม่พบบิลนี้");
    return successResponse(detail);
  } catch (e) {
    return serverErrorResponse(e);
  }
}

/** PATCH /api/outbound/bills/[id] — action: activate | hold | resume | cancel | resolve-shortage */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    const body = await req.json().catch(() => ({}));
    const parsed = BillPatchActionSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(", "), 400);
    }

    // cancel/resolve-shortage เปลี่ยนผลของบิล → ต้องมีสิทธิ์ approve, ส่วน hold/resume ให้หัวหน้า (STAFF+) ทำได้
    const needsApprove = parsed.data.action === "cancel" || parsed.data.action === "resolve-shortage";
    try {
      authorize(actor, needsApprove ? PERMISSIONS.OUTBOUND_APPROVE : PERMISSIONS.STOCK_ISSUE);
    } catch {
      return forbiddenResponse(needsApprove ? "เฉพาะแอดมิน/ผู้จัดการที่ตัดสิน/ยกเลิกบิลได้" : undefined);
    }

    const { id } = await params;
    const key = decodeURIComponent(id);
    const repo = getRepository();

    switch (parsed.data.action) {
      case "activate":
        await activateBill(repo, key, actor);
        return successResponse(null, "เปิดงานหยิบบิลนี้แล้ว (พร้อมหยิบ)");
      case "hold":
        await holdBill(repo, key, actor, parsed.data.reason);
        return successResponse(null, "พักบิลนี้แล้ว");
      case "resume":
        await resumeBill(repo, key, actor);
        return successResponse(null, "กลับมาทำงานต่อแล้ว");
      case "cancel":
        await cancelBill(repo, key, actor, parsed.data.reason);
        return successResponse(null, "ยกเลิกบิลและปล่อยการจองสต็อกแล้ว");
      case "resolve-shortage": {
        const result = await resolveShortage(
          repo,
          key,
          { outcome: parsed.data.outcome, reason: parsed.data.reason },
          actor
        );
        return successResponse(result, result.message);
      }
    }
  } catch (e) {
    if (e instanceof OutboundStateError) return mapError(e);
    if (e instanceof Error && e.message.startsWith("ไม่พบ")) return notFoundResponse(e.message);
    if (e instanceof Error && /สต็อกไม่พอ|ไม่มีสิทธิ์/.test(e.message)) return errorResponse(e.message, 409);
    return serverErrorResponse(e);
  }
}
