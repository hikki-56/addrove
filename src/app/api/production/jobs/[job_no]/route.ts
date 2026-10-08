import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/server/security";
import {
  guardProductionRoute,
  parseBody,
  productionErrorResponse,
} from "@/server/production/production-route-helpers";
import {
  getJobDetail,
  updateJob,
  deleteDraft,
} from "@/server/production/production-job.service";
import { updateProductionJobSchema } from "@/server/production/production-schemas";
import { successResponse } from "@/server/api-response";

export const maxDuration = 60;

// GET /api/production/jobs/[job_no] — รายละเอียดงาน + ประวัติรายงาน + ประวัติการเปลี่ยนแปลง
export async function GET(req: NextRequest, { params }: { params: Promise<{ job_no: string }> }) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_VIEW);
    if (!guard.ok) return guard.response;

    const { job_no } = await params;
    const detail = await getJobDetail(decodeURIComponent(job_no || ""));
    if (!detail) {
      return NextResponse.json({ success: false, message: "ไม่พบใบสั่งผลิตนี้" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    return productionErrorResponse(error);
  }
}

// PATCH /api/production/jobs/[job_no] — แก้ไขงานตามกติกาสถานะ (ADMIN)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ job_no: string }> }) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
    if (!guard.ok) return guard.response;

    const { job_no } = await params;
    const body = await parseBody(req, updateProductionJobSchema);
    if (!body.ok) return body.response;

    const job = await updateJob(guard.actor, decodeURIComponent(job_no || ""), body.data);
    return successResponse(job, "แก้ไขงานผลิตเรียบร้อย");
  } catch (error) {
    return productionErrorResponse(error);
  }
}

// DELETE /api/production/jobs/[job_no] — ลบได้เฉพาะฉบับร่าง (ADMIN)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ job_no: string }> }) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
    if (!guard.ok) return guard.response;

    const { job_no } = await params;
    await deleteDraft(guard.actor, decodeURIComponent(job_no || ""));
    return successResponse(null, "ลบงานฉบับร่างเรียบร้อย");
  } catch (error) {
    return productionErrorResponse(error);
  }
}
