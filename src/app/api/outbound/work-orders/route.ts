import { NextRequest } from "next/server";
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
  createWorkOrder,
  getQBoxHistory,
  listWorkOrders,
} from "@/lib/services/outbound/work-order.service";
import { getBusyQCodes } from "@/lib/services/outbound/q-assignment.service";
import { OutboundStateError } from "@/lib/services/outbound/outbound-state-machine";
import { OutboundReservationError } from "@/lib/services/outbound/stock-reservation.service";

export const maxDuration = 60;

import { z } from "zod";

const WorkOrderItemSchema = z.object({
  sku: z.string().min(1),
  product_id: z.string().optional(),
  barcode: z.string().optional(),
  product_name: z.string().optional(),
  qty: z.number().int().min(1, "จำนวนต้องมากกว่าหรือเท่ากับ 1"),
});

const CreateWorkOrderSchema = z.object({
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  title: z.string().max(200).optional(),
  q_boxes: z
    .array(
      z.object({
        q_code: z.string().min(1),
        items: z.array(WorkOrderItemSchema).min(1),
      })
    )
    .min(1, "กรุณาเพิ่มกล่อง Q อย่างน้อย 1 กล่อง"),
});

/** GET /api/outbound/work-orders — รายการใบงาน Q / หรือ ?q_code=Q1 = ประวัติกล่อง */
export async function GET(req: NextRequest) {
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

    const repo = getRepository();
    const qCode = req.nextUrl.searchParams.get("q_code");
    if (qCode) {
      const history = await getQBoxHistory(repo, qCode);
      return successResponse({ q_code: qCode.toUpperCase(), history }, `ประวัติกล่อง ${qCode.toUpperCase()}`);
    }
    const [workOrders, busyMap] = await Promise.all([
      listWorkOrders(repo),
      getBusyQCodes(repo).catch(() => new Map()),
    ]);
    const busy_qs = Array.from(busyMap.entries()).map(([q_code, info]) => ({
      q_code,
      document_id: info.document_id,
      document_no: info.document_no,
      document_type: info.document_type,
      customer: info.customer,
      outbound_status: info.outbound_status,
      items: info.items ?? [],
    }));
    return successResponse({ workOrders, busy_qs }, "โหลดใบงาน Q สำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

/** POST /api/outbound/work-orders — Admin สร้างร่างใบงาน Q */
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.OUTBOUND_APPROVE);
    } catch {
      return forbiddenResponse("เฉพาะแอดมินเท่านั้นที่สร้างใบงาน Q ได้");
    }

    const body = await req.json().catch(() => ({}));
    const parsed = CreateWorkOrderSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(", "), 400);
    }

    const repo = getRepository();
    const created = await createWorkOrder(repo, parsed.data, actor);
    return successResponse(created, `สร้างร่างใบงาน ${created.document_no} แล้ว (ยังไม่ตัดสต็อก)`, 201);
  } catch (e) {
    if (e instanceof OutboundStateError) return errorResponse(e.message, 409);
    if (e instanceof OutboundReservationError) return errorResponse(e.message, 409);
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith("ไม่พบ")) return errorResponse(message, 404);
    return serverErrorResponse(e);
  }
}
