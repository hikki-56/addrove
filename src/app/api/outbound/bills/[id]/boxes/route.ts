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
  createBox,
  scanItemIntoBox,
  closeBox,
  cancelOpenBox,
  markStickerPrinted,
  getBoxesOfBillInfo,
} from "@/lib/services/outbound/packing.service";
import { BoxActionSchema } from "@/lib/services/outbound/outbound-schemas";
import { OutboundStateError } from "@/lib/services/outbound/outbound-state-machine";

export const maxDuration = 60;

/** GET /api/outbound/bills/[id]/boxes — กล่องทั้งหมดของบิล (ใช้พิมพ์สติกเกอร์) */
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
    const boxes = await getBoxesOfBillInfo(repo, decodeURIComponent(id));
    return successResponse({ boxes });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("ไม่พบ")) return notFoundResponse(e.message);
    return serverErrorResponse(e);
  }
}

/** POST /api/outbound/bills/[id]/boxes — action: create | scan-item | close | cancel-open | mark-sticker-printed */
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
      return forbiddenResponse("คุณไม่มีสิทธิ์ทำงานแพ็กกล่อง");
    }

    const body = await req.json().catch(() => ({}));
    const parsed = BoxActionSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(", "), 400);
    }

    const { id } = await params;
    const key = decodeURIComponent(id);
    const repo = getRepository();

    switch (parsed.data.action) {
      case "create": {
        const box = await createBox(repo, key, actor);
        return successResponse(
          box,
          `เปิดกล่องที่ ${box.box_no} แล้ว (${box.document_no}) — สแกนของใส่ได้เลย`,
          201
        );
      }
      case "scan-item": {
        const result = await scanItemIntoBox(
          repo,
          key,
          { sku: parsed.data.sku, qty: parsed.data.qty },
          actor
        );
        const done = result.qty_in_boxes >= result.qty_picked;
        return successResponse(
          result,
          `✓ ${result.sku} — ใส่กล่องแล้ว ${result.qty_in_boxes}/${result.qty_picked}${done ? " (ครบ)" : ""}`
        );
      }
      case "close": {
        const result = await closeBox(repo, key, actor);
        return successResponse(
          result,
          `ปิดกล่องที่ ${result.box_no} แล้ว (${result.box_document_no}) — พิมพ์สติกเกอร์ติดกล่องได้`
        );
      }
      case "cancel-open": {
        await cancelOpenBox(repo, key, actor, parsed.data.reason);
        return successResponse(null, "ยกเลิกกล่องเปล่าแล้ว");
      }
      case "mark-sticker-printed": {
        await markStickerPrinted(repo, parsed.data.box_id);
        return successResponse(null, "บันทึกการพิมพ์สติกเกอร์แล้ว");
      }
    }
  } catch (e) {
    if (e instanceof OutboundStateError) return conflictResponse(e.message);
    if (e instanceof Error) {
      if (e.message.startsWith("ไม่พบ")) return notFoundResponse(e.message);
      return errorResponse(e.message, 400);
    }
    return serverErrorResponse(e);
  }
}
