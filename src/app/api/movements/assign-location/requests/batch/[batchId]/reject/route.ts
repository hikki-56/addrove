import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { z } from "zod";
import { mapStockErrorToResponse } from "@/server/services/stock";
import { successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, serverErrorResponse } from "@/server/api-response";
import { rejectAssignBatch, AssignRequestError } from "@/server/services/location-assign-requests";
import { assignRequestActor } from "../../../../_auth";

export const maxDuration = 60;
const Body = z.object({ note: z.string().max(500).default("") });

/** ทั้งชุดในทรานแซกชันเดียว (all-or-nothing) — ADMIN เท่านั้น */
async function handlePOST(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const who = await assignRequestActor(req);
    if (!who) return unauthorizedResponse();
    if (!who.canApprove) return forbiddenResponse("เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้น");
    const { batchId } = await params;
    const body = Body.safeParse(await req.json().catch(() => ({})));
    const result = await rejectAssignBatch(batchId, who.actor.id, body.success ? body.data.note : "");
    return successResponse(result, "ปฏิเสธทั้งชุดแล้ว");
  } catch (e) {
    if (e instanceof AssignRequestError) return errorResponse(e.message, e.status);
    console.error("[API AssignLocationBatch reject] Error:", e);
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}

export const POST = withStorageRequest(handlePOST);
