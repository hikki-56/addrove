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
  getShipmentDetail,
  scanBoxIntoShipment,
  unloadBox,
  closeShipment,
  cancelShipment,
} from "@/lib/services/outbound/shipment.service";
import { ShipmentActionSchema } from "@/lib/services/outbound/outbound-schemas";
import { OutboundStateError } from "@/lib/services/outbound/outbound-state-machine";

export const maxDuration = 60;

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
    const detail = await getShipmentDetail(repo, decodeURIComponent(id));
    if (!detail) return notFoundResponse("ไม่พบรอบรถนี้");
    return successResponse(detail);
  } catch (e) {
    return serverErrorResponse(e);
  }
}

/**
 * POST /api/outbound/shipments/[id] — action: scan | unload | close | cancel
 * scan verification: กล่องที่ไม่ได้อยู่ในรอบนี้ → แดง (409/400) ทันที
 * close: กล่องที่ขาดทุกใบต้องมีการยืนยัน (ROLLOVER/CANCELLED + เหตุผล)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    const body = await req.json().catch(() => ({}));
    const parsed = ShipmentActionSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(", "), 400);
    }

    // ปิดรอบแบบมีกล่องขาด = ตัดสินใจเชิงธุรกิจ → ต้องมีสิทธิ์ approve ด้วย
    const needsApprove = parsed.data.action === "close";
    try {
      authorize(actor, needsApprove ? PERMISSIONS.OUTBOUND_APPROVE : PERMISSIONS.OUTBOUND_SHIP);
    } catch {
      return forbiddenResponse(
        needsApprove ? "การปิดรอบที่มีกล่องไม่ครบต้องใช้สิทธิ์แอดมิน/ผู้จัดการ" : "คุณไม่มีสิทธิ์ทำงานรอบรถ"
      );
    }

    const { id } = await params;
    const key = decodeURIComponent(id);
    const repo = getRepository();

    switch (parsed.data.action) {
      case "scan": {
        const result = await scanBoxIntoShipment(repo, key, parsed.data.box_code, actor);
        return successResponse(
          result,
          result.already_loaded
            ? `กล่องนี้ขึ้นรถแล้ว (ไม่นับซ้ำ) — ${result.loaded}/${result.expected}`
            : `✓ กล่องขึ้นรถแล้ว ${result.loaded}/${result.expected}`
        );
      }
      case "unload": {
        await unloadBox(repo, key, parsed.data.box_code, actor);
        return successResponse(null, "ถอดกล่องออกจากรถแล้ว");
      }
      case "close": {
        const result = await closeShipment(
          repo,
          key,
          parsed.data.confirmations,
          actor
        );
        const parts = [`ขึ้นรถจริง ${result.shipped_boxes} กล่อง`];
        if (result.rollover_boxes > 0) parts.push(`ไปรอบถัดไป ${result.rollover_boxes}`);
        if (result.cancelled_boxes > 0) parts.push(`ยกเลิก ${result.cancelled_boxes}`);
        return successResponse(result, `ปิดรอบแล้ว — ${parts.join(" · ")}`);
      }
      case "cancel": {
        await cancelShipment(repo, key, actor, parsed.data.reason);
        return successResponse(null, "ยกเลิกรอบรถแล้ว — กล่อง/บิลกลับสถานะก่อนหน้า");
      }
    }
  } catch (e) {
    if (e instanceof OutboundStateError) return conflictResponse(e.message);
    if (e instanceof Error) {
      if (e.message.startsWith("ไม่พบ")) return notFoundResponse(e.message);
      if (e.message.includes("กล่องไม่อยู่ในรอบนี้") || e.message.includes("ยังไม่ได้ยืนยัน")) {
        return conflictResponse(e.message);
      }
      return errorResponse(e.message, 400);
    }
    return serverErrorResponse(e);
  }
}
