import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { successResponse, unauthorizedResponse, forbiddenResponse, serverErrorResponse } from "@/server/api-response";
import { listAssignRequests, type AssignRequestStatus } from "@/server/services/location-assign-requests";
import { assignRequestActor } from "../_auth";

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "ALL"] as const;

/** รายการคำขอ — ผู้อนุมัติเห็นทั้งหมด, ผู้ขอเห็นเฉพาะของตัวเอง */
async function handleGET(req: NextRequest) {
  try {
    const who = await assignRequestActor(req);
    if (!who) return unauthorizedResponse();
    if (!who.canApprove && !who.canRequest) return forbiddenResponse("ไม่มีสิทธิ์ดูคำขอระบุตำแหน่ง");
    const sp = req.nextUrl.searchParams;
    const s = (sp.get("status") || "PENDING").toUpperCase();
    const status = (STATUSES as readonly string[]).includes(s) ? (s as AssignRequestStatus | "ALL") : "PENDING";
    const requests = await listAssignRequests({
      status,
      warehouse_id: sp.get("warehouse_id"),
      requested_by: who.canApprove ? null : who.actor.id,
      limit: Number(sp.get("limit")) || 300,
    });
    return successResponse({ requests, can_approve: who.canApprove, me: who.actor.id });
  } catch (e) {
    console.error("[API AssignLocationRequests] Error:", e);
    return serverErrorResponse(e);
  }
}

export const GET = withStorageRequest(handleGET);
