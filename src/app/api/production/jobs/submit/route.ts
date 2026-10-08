import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/server/security";
import {
  guardProductionRoute,
  parseBody,
  productionErrorResponse,
} from "@/server/production/production-route-helpers";
import { submitJobs } from "@/server/production/production-job.service";
import { submitProductionJobsSchema } from "@/server/production/production-schemas";
import { successResponse } from "@/lib/api-response";

export const maxDuration = 60;

// POST /api/production/jobs/submit — ยืนยันส่งงานผลิต (ADMIN) หลายงานพร้อมกัน: DRAFT → WAITING + แจ้ง APPROVER
export async function POST(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
    if (!guard.ok) return guard.response;

    const body = await parseBody(req, submitProductionJobsSchema);
    if (!body.ok) return body.response;

    const result = await submitJobs(guard.actor, body.data.job_nos);
    if (result.submitted.length === 0) {
      return NextResponse.json(
        { success: false, message: "ไม่มีงานที่ส่งได้ (ทุกงานที่เลือกไม่อยู่ในสถานะฉบับร่าง)", skipped: result.skipped },
        { status: 409 }
      );
    }
    return successResponse(
      result,
      `ส่งงานผลิต ${result.submitted.length} งานเรียบร้อย — แจ้งเตือนไปยังผู้ผลิตแล้ว` +
        (result.skipped.length > 0 ? ` (ข้าม ${result.skipped.length} งาน)` : "")
    );
  } catch (error) {
    return productionErrorResponse(error);
  }
}
