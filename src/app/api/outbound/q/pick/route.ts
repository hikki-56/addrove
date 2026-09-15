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
  confirmQItemScan,
  reportQProblem,
  startQBox,
} from "@/lib/services/outbound/work-order.service";
import { OutboundStateError } from "@/lib/services/outbound/outbound-state-machine";

export const maxDuration = 60;

const QPickActionSchema = z.object({
  q_code: z.string().min(1, "กรุณาสแกนรหัสกล่อง Q"),
  action: z.enum(["start", "confirm-item", "report-problem"]),
  scan: z.string().optional(),
  problem: z.enum(["NOT_FOUND", "INSUFFICIENT", "DAMAGED", "BAD_BARCODE", "OTHER"]).optional(),
  picked_qty: z.number().int().min(0).optional(),
  note: z.string().max(300).optional(),
  idempotency_key: z.string().optional(),
});

/**
 * POST /api/outbound/q/pick — จุดทำงานของพนักงานแพ็กของ
 *  - start: สแกนกล่อง Q → เปิดรายการที่ต้องหยิบ
 *  - confirm-item: สแกนสินค้ายืนยัน 1 ชิ้น (สินค้าผิด/เกินจำนวนโดนปฏิเสธ)
 *  - report-problem: แจ้งหัวหน้าปัญหาของรายการในกล่องนั้น
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.STOCK_ISSUE);
    } catch {
      return forbiddenResponse("คุณไม่มีสิทธิ์ทำงานหยิบของ");
    }

    const body = await req.json().catch(() => ({}));
    const parsed = QPickActionSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(", "), 400);
    }
    const input = parsed.data;
    const repo = getRepository();

    switch (input.action) {
      case "start": {
        const view = await startQBox(repo, input.q_code, actor);
        return successResponse(view, `กล่อง ${view.q_code} — ใบงาน ${view.document_no}`);
      }
      case "confirm-item": {
        if (!input.scan) return errorResponse("กรุณาสแกนสินค้า", 400);
        const result = await confirmQItemScan(repo, input.q_code, input.scan, actor);
        return successResponse(result, result.message);
      }
      case "report-problem": {
        if (!input.scan || !input.problem) {
          return errorResponse("กรุณาระบุสินค้าและประเภทปัญหา", 400);
        }
        const result = await reportQProblem(
          repo,
          input.q_code,
          input.scan,
          { problem: input.problem, picked_qty: input.picked_qty, note: input.note },
          actor
        );
        return successResponse(
          result,
          result.work_order_status === "SHORTAGE"
            ? "บันทึกปัญหาแล้ว — ใบงานเข้าสถานะของไม่ครบ รอหัวหน้าตัดสิน"
            : "บันทึกปัญหาแล้ว"
        );
      }
    }
  } catch (e) {
    if (e instanceof OutboundStateError) return errorResponse(e.message, 409);
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith("ไม่พบ")) return errorResponse(message, 404);
    return serverErrorResponse(e);
  }
}
