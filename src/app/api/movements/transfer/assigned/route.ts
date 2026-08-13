import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import {
  successResponse,
  unauthorizedResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import type { Document } from "@/types/models";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    const repo = getRepository();
    const result = await repo.documents.findAll({ page: 1, limit: 500, document_type: "TRANSFER" as any });

    const allTransfers = result.data || [];
    
    // Filter pending transfers assigned to current user, staff role, or warehouse access (or all pending if ADMIN)
    const assignedTasks = allTransfers.filter((doc: Document) => {
      if (doc.status !== "PENDING") return false;

      let meta: any = {};
      try {
        meta = JSON.parse(doc.note || "{}");
      } catch {}

      const assignedUserId = String(doc.assigned_to_user_id || meta.assigned_to_user_id || "").trim();
      const assignedName = String(doc.assigned_to_name || meta.assigned_to_name || "").trim();
      const assignedEmail = String(meta.assigned_to_email || "").trim().toLowerCase();

      // ADMIN sees all pending transfer tasks
      if (actor.role === "ADMIN") return true;

      // If task is not explicitly assigned to a specific user, all active staff can see it
      if (!assignedUserId && !assignedName && !assignedEmail) return true;

      const userId = String(actor.id || session?.user?.id || "").trim();
      const userEmail = String(session?.user?.email || "").trim().toLowerCase();
      const userName = String(session?.user?.name || "").trim().toLowerCase();

      const cleanAssignedId = assignedUserId.toLowerCase().replace(/^usr-/, "").replace(/^user-/, "");
      const cleanUserId = userId.toLowerCase().replace(/^usr-/, "").replace(/^user-/, "");

      // 1. Direct User ID / Clean ID match
      if (assignedUserId && userId && (assignedUserId === userId || cleanAssignedId === cleanUserId)) {
        return true;
      }

      // 2. Email match
      if ((assignedUserId && userEmail && assignedUserId.toLowerCase() === userEmail) || (assignedEmail && userEmail && assignedEmail === userEmail)) {
        return true;
      }

      // 3. Name match or generic staff assignment
      if (assignedName && (assignedName.toLowerCase().includes("พนักงาน") || assignedName.toLowerCase().includes("staff"))) {
        return true;
      }

      if (assignedName && userName && (assignedName.toLowerCase().includes(userName) || userName.includes(assignedName.toLowerCase()))) {
        return true;
      }

      // 4. Warehouse access match: Staff having access to the target or source warehouse
      const fromWh = meta.from_warehouse_id;
      const toWh = meta.to_warehouse_id;
      if (actor.warehouseAccess && Array.isArray(actor.warehouseAccess)) {
        if (actor.warehouseAccess.includes("*") || (fromWh && actor.warehouseAccess.includes(fromWh)) || (toWh && actor.warehouseAccess.includes(toWh))) {
          return true;
        }
      }

      return false;
    });

    return successResponse(assignedTasks, "ดึงรายการสั่งย้ายสินค้าสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
