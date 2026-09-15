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
  startPick,
  confirmPickItem,
  reportProblem,
  completePick,
} from "@/lib/services/outbound/picking.service";
import { PickActionSchema } from "@/lib/services/outbound/outbound-schemas";
import {
  OutboundStateError,
  BILL_STATUS_LABELS_TH,
} from "@/lib/services/outbound/outbound-state-machine";
import { OutboundReservationError } from "@/lib/services/outbound/stock-reservation.service";

export const maxDuration = 60;

/**
 * POST /api/outbound/bills/[id]/pick — งานหยิบของพนักงานคลัง
 * action: start | confirm-item | report-problem | complete
 * ทุก action ผ่าน state machine — ผู้ใช้เปลี่ยนสถานะเองไม่ได้
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
      authorize(actor, PERMISSIONS.STOCK_ISSUE);
    } catch {
      return forbiddenResponse("คุณไม่มีสิทธิ์ทำงานหยิบของ");
    }

    const body = await req.json().catch(() => ({}));
    const parsed = PickActionSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(", "), 400);
    }

    const { id } = await params;
    const key = decodeURIComponent(id);
    const repo = getRepository();

    switch (parsed.data.action) {
      case "start": {
        const result = await startPick(repo, key, actor);
        return successResponse(result, "เริ่มหยิบ — สต็อกถูกจองสำหรับบิลนี้แล้ว");
      }
      case "confirm-item": {
        const result = await confirmPickItem(
          repo,
          key,
          { sku: parsed.data.sku, qty: parsed.data.qty, location_id: parsed.data.location_id },
          actor
        );
        return successResponse(
          result,
          `✓ ${result.sku} — หยิบแล้ว ${result.qty_picked}/${result.qty_required}`
        );
      }
      case "report-problem": {
        const result = await reportProblem(
          repo,
          key,
          {
            sku: parsed.data.sku,
            problem: parsed.data.problem,
            picked_qty: parsed.data.picked_qty,
            note: parsed.data.note,
          },
          actor
        );
        const becameShortage = result.bill_status === "SHORTAGE";
        return successResponse(
          result,
          becameShortage
            ? `บันทึกปัญหาแล้ว — ทุกรายการถูกแจ้งปัญหา บิลเข้าสถานะ${BILL_STATUS_LABELS_TH.SHORTAGE} รอหัวหน้าตัดสิน`
            : "บันทึกปัญหาแล้ว — หัวหน้าจะตัดสินต่อ (ไปหยิบรายการอื่นต่อได้)"
        );
      }
      case "complete": {
        const result = await completePick(repo, key, actor);
        return successResponse(result, result.message);
      }
    }
  } catch (e) {
    if (e instanceof OutboundStateError) return conflictResponse(e.message);
    if (e instanceof OutboundReservationError) return conflictResponse(e.message);
    if (e instanceof Error) {
      if (e.message.startsWith("ไม่พบ")) return notFoundResponse(e.message);
      // ข้อผิดพลาดการใช้งานจากคนหน้างาน (สแกนผิด/จำนวนผิด) → 400 พร้อมข้อความไทย
      return errorResponse(e.message, 400);
    }
    return serverErrorResponse(e);
  }
}
