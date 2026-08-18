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

    const doc = await createTransfer(
      { repo },
      {
        ...parsed.data,
        moved_by: defaultMovedBy,
        assigned_to_user_id: defaultAssignedUserId,
        assigned_to_name: defaultAssignedName,
        user_id: actor.id,
        role: actor.role,
        correlation_id: actor.correlationId,
        warehouse_access: actor.warehouseAccess,
      }
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

    if (actor.role !== "ADMIN") {
      const userId = String(actor.id || session?.user?.id || "").trim();
      const userEmail = String(session?.user?.email || "").trim().toLowerCase();
      const userName = String(session?.user?.name || "").trim().toLowerCase();

      documents = documents.filter((doc) => {
        // Creator match
        if (doc.created_by && userId && (doc.created_by === userId || doc.created_by.replace(/^usr-/, "") === userId.replace(/^usr-/, ""))) {
          return true;
        }

        let meta: Record<string, any> = {};
        try {
          meta = JSON.parse(doc.note || "{}");
        } catch {}

        const assignedUserId = String(doc.assigned_to_user_id || meta.assigned_to_user_id || "").trim();
        const assignedName = String(doc.assigned_to_name || meta.assigned_to_name || meta.moved_by || "").trim();
        const assignedEmail = String(meta.assigned_to_email || "").trim().toLowerCase();
        const fromWh = meta.from_warehouse_id;
        const toWh = meta.to_warehouse_id;

        // Direct user ID / clean ID match
        const cleanAssignedId = assignedUserId.toLowerCase().replace(/^usr-/, "").replace(/^user-/, "");
        const cleanUserId = userId.toLowerCase().replace(/^usr-/, "").replace(/^user-/, "");

        if (assignedUserId && userId && (assignedUserId === userId || cleanAssignedId === cleanUserId)) return true;
        if (assignedEmail && userEmail && assignedEmail === userEmail) return true;
        if (assignedName && userName && (assignedName.toLowerCase().includes(userName) || userName.includes(assignedName.toLowerCase()))) return true;

        // Generic staff assignment with warehouse access check
        if (!assignedUserId && !assignedEmail) {
          const isGenericStaff =
            !assignedName ||
            assignedName.toLowerCase().includes("พนักงาน") ||
            assignedName.toLowerCase().includes("staff") ||
            assignedName === "ผู้ใช้งานระบบ";

          if (isGenericStaff && actor.warehouseAccess && Array.isArray(actor.warehouseAccess)) {
            if (actor.warehouseAccess.includes("*") || (fromWh && actor.warehouseAccess.includes(fromWh)) || (toWh && actor.warehouseAccess.includes(toWh))) {
              return true;
            }
          }
        }
        return false;
      });
    }

    return successResponse(documents, "โหลดรายการโอนสินค้าสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
