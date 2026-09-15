import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import {
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { listShipments, createShipment } from "@/lib/services/outbound/shipment.service";
import { ShipmentCreateSchema } from "@/lib/services/outbound/outbound-schemas";

export const maxDuration = 60;

/** GET /api/outbound/shipments — รายการรอบรถ */
export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.STOCK_VIEW);
    } catch {
      return forbiddenResponse();
    }
    const repo = getRepository();
    const shipments = await listShipments(repo);
    return successResponse({ shipments });
  } catch (e) {
    return serverErrorResponse(e);
  }
}

/** POST /api/outbound/shipments — สร้างรอบรถ (เลือกทะเบียน + บิล → รู้ Expected กล่องรวม) */
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();
    try {
      authorize(actor, PERMISSIONS.OUTBOUND_SHIP);
    } catch {
      return forbiddenResponse("คุณไม่มีสิทธิ์สร้างรอบรถ");
    }

    const body = await req.json().catch(() => ({}));
    const parsed = ShipmentCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(", "), 400);
    }

    const repo = getRepository();
    const result = await createShipment(
      repo,
      {
        truck_plate: parsed.data.truck_plate,
        destination: parsed.data.destination,
        bill_ids: parsed.data.bill_ids,
      },
      actor
    );
    return successResponse(
      result,
      `สร้างรอบ ${result.document_no} (รถ ${parsed.data.truck_plate}) — ${result.bill_count} บิล ต้องขึ้นรถ ${result.expected_boxes} กล่อง`,
      201
    );
  } catch (e) {
    if (e instanceof Error) return errorResponse(e.message, 400);
    return serverErrorResponse(e);
  }
}
