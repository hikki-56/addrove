import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/server/security";
import {
  guardProductionRoute,
  parseBody,
  productionErrorResponse,
} from "@/server/production/production-route-helpers";
import { reopenJob } from "@/server/production/production-job.service";
import { reopenProductionJobSchema } from "@/server/production/production-schemas";
import { successResponse } from "@/server/api-response";

export const maxDuration = 60;

// POST /api/production/jobs/[job_no]/reopen — ADMIN เปิดงานที่จบแล้วกลับมาผลิตต่อ (พร้อมเหตุผล)
export async function POST(req: NextRequest, { params }: { params: Promise<{ job_no: string }> }) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
    if (!guard.ok) return guard.response;

    const { job_no } = await params;
    const body = await parseBody(req, reopenProductionJobSchema);
    if (!body.ok) return body.response;

    const job = await reopenJob(guard.actor, decodeURIComponent(job_no || ""), body.data.reason);
    return successResponse(job, `เปิดงาน ${job.job_no} กลับมาผลิตต่อเรียบร้อย`);
  } catch (error) {
    return productionErrorResponse(error);
  }
}
