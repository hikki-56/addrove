import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { createTransfer, mapStockErrorToResponse, CreateTransferSchema } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    const body = await req.json().catch(() => ({}));
    const parsed = CreateTransferSchema.safeParse(body);
    if (!parsed.success) {
      return mapStockErrorToResponse(parsed.error);
    }

    try {
      authorize(actor, PERMISSIONS.STOCK_TRANSFER_CREATE, parsed.data.from_warehouse_id);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const repo = getRepository();
    const defaultMovedBy = parsed.data.moved_by || session?.user?.name || "พนักงาน";
    const defaultAssignedUserId = parsed.data.assigned_to_user_id || actor.id;
    const defaultAssignedName = parsed.data.assigned_to_name || session?.user?.name || defaultMovedBy;

    const defaultCreatedByName =
      parsed.data.created_by_name ||
      session?.user?.name ||
      (actor as any).name ||
      (actor.role === "ADMIN" ? "ผู้ดูแลระบบ (Admin)" : "ผู้สร้างใบเบิก");

    const doc = await createTransfer(
      { repo },
      {
        ...parsed.data,
        moved_by: defaultMovedBy,
        assigned_to_user_id: defaultAssignedUserId,
        assigned_to_name: defaultAssignedName,
        user_id: parsed.data.created_by || actor.id,
        created_by: parsed.data.created_by || actor.id,
        created_by_name: defaultCreatedByName,
        role: actor.role,
        correlation_id: actor.correlationId,
        warehouse_access: actor.warehouseAccess,
      } as any
    );

    return successResponse(doc, "บันทึกการโอนสินค้าระหว่างโกดังสำเร็จ", 201);
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    const repo = getRepository();
    const result = await repo.documents.findAll({ page: 1, limit: 1000, document_type: "TRANSFER" as any });

    let documents = result.data || [];

    // All users can see all transfer documents (shared visibility for team coordination)
    return successResponse(documents, "โหลดรายการโอนสินค้าสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
