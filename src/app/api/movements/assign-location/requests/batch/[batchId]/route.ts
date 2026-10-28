import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, notFoundResponse, serverErrorResponse } from "@/server/api-response";
import { editAssignBatch, getAssignBatch, listAssignBatchEdits, AssignRequestError } from "@/server/services/location-assign-requests";
import { assignRequestActor } from "../../../_auth";

const Body = z.object({
  note: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        request_id: z.string().min(1),
        target_qty: z.number().int().min(0).max(100_000_000).optional(),
        location_code: z.string().trim().max(50).optional(),
      })
    )
    .max(60)
    .default([]),
});

/** ชุดคำขอ + ประวัติการแก้ไข — ผู้ขอเอง หรือ ADMIN */
async function handleGET(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const who = await assignRequestActor(req);
    if (!who) return unauthorizedResponse();
    const { batchId } = await params;
    const rows = await getAssignBatch(batchId);
    if (!rows.length) return notFoundResponse("ไม่พบคำขอนี้");
    if (!who.canApprove && rows.some((r) => r.requested_by !== who.actor.id)) return forbiddenResponse("ไม่มีสิทธิ์ดูคำขอนี้");
    return successResponse({ requests: rows, edits: await listAssignBatchEdits(batchId) });
  } catch (e) {
    if (e instanceof AssignRequestError) return errorResponse(e.message, e.status);
    return serverErrorResponse(e);
  }
}

/** แก้ไขทั้งชุดที่ยัง PENDING (ไม่แตะสต็อก) — ผู้ขอเอง หรือ ADMIN */
async function handlePATCH(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const who = await assignRequestActor(req);
    if (!who) return unauthorizedResponse();
    if (!who.canApprove && !who.canRequest) return forbiddenResponse("ไม่มีสิทธิ์แก้ไขคำขอ");
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(parsed.error.issues.map((i) => i.message).join("\n"));
    const { batchId } = await params;
    const result = await editAssignBatch(batchId, { id: who.actor.id, isAdmin: who.canApprove }, parsed.data);
    return successResponse(result, "แก้ไขคำขอแล้ว");
  } catch (e) {
    if (e instanceof AssignRequestError) return errorResponse(e.message, e.status);
    console.error("[API AssignLocationBatch edit] Error:", e);
    return serverErrorResponse(e);
  }
}

export const GET = withStorageRequest(handleGET);
export const PATCH = withStorageRequest(handlePATCH);
