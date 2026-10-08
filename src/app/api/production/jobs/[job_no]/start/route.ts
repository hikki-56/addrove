import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/server/security";
import {
  guardProductionRoute,
  productionErrorResponse,
} from "@/server/production/production-route-helpers";
import { startJob } from "@/server/production/production-job.service";
import { successResponse } from "@/server/api-response";

export const maxDuration = 60;

// POST /api/production/jobs/[job_no]/start — APPROVER เริ่มผลิต: WAITING → IN_PROGRESS + แจ้ง ADMIN
export async function POST(req: NextRequest, { params }: { params: Promise<{ job_no: string }> }) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_REPORT);
    if (!guard.ok) return guard.response;

    const { job_no } = await params;
    const job = await startJob(guard.actor, decodeURIComponent(job_no || ""));
    return successResponse(job, `เริ่มผลิต ${job.job_no} เรียบร้อย`);
  } catch (error) {
    return productionErrorResponse(error);
  }
}
