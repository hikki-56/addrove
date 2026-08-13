import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { createTransfer, mapStockErrorToResponse, CreateTransferSchema } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
  errorResponse,
} from "@/lib/api-response";

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    if (actor.role !== "ADMIN") {
      return forbiddenResponse("เฉพาะ Admin เท่านั้นที่มอบหมายใบสั่งย้ายสินค้าได้");
    }

    const body = await req.json().catch(() => ({}));
    const parsed = CreateTransferSchema.safeParse(body);
    if (!parsed.success) {
      return mapStockErrorToResponse(parsed.error);
    }

    if (!parsed.data.assigned_to_user_id) {
      return errorResponse("กรุณาเลือกพนักงานผู้รับผิดชอบการย้ายสินค้า");
    }

    const repo = getRepository();
    // Resolve assigned staff member name & email flexibly
    let assignedName = parsed.data.assigned_to_name || "พนักงาน";
    let assignedEmail = "";

    const assignedId = parsed.data.assigned_to_user_id;
    if (assignedId) {
      let staffUser = await repo.users.findById(assignedId);
      if (!staffUser) {
        staffUser = await repo.users.findByEmail(assignedId);
      }
      if (!staffUser) {
        const allUsers = await repo.users.findAll();
        staffUser =
          allUsers.find(
            (u) =>
              u.user_id === assignedId ||
              u.email.toLowerCase() === assignedId.toLowerCase() ||
              u.full_name === parsed.data.assigned_to_name
          ) || null;
      }

      if (staffUser) {
        assignedName = staffUser.full_name || staffUser.email;
        assignedEmail = staffUser.email;
      }
    }

    const doc = await createTransfer(
      { repo },
      {
        ...parsed.data,
        assigned_to_name: assignedName,
        user_id: actor.id,
        role: actor.role,
        correlation_id: actor.correlationId,
        warehouse_access: actor.warehouseAccess,
      }
    );

    return successResponse(doc, `สร้างและส่งใบสั่งย้ายสินค้าถึง "${assignedName}" เรียบร้อยแล้ว`, 201);
  } catch (e) {
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}
