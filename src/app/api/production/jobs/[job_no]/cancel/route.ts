import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/security";
import {
  guardProductionRoute,
  parseBody,
  productionErrorResponse,
} from "@/lib/production/production-route-helpers";
import { cancelJob } from "@/lib/production/production-job.service";
import { cancelProductionJobSchema } from "@/lib/production/production-schemas";
import { successResponse } from "@/lib/api-response";

export const maxDuration = 60;

// POST /api/production/jobs/[job_no]/cancel — ADMIN ยกเลิกงาน (เก็บผลผลิตที่ยืนยันแล้วไว้ทั้งหมด)
export async function POST(req: NextRequest, { params }: { params: Promise<{ job_no: string }> }) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
    if (!guard.ok) return guard.response;

    const { job_no } = await params;
    const body = await parseBody(req, cancelProductionJobSchema);
    if (!body.ok) return body.response;

    const job = await cancelJob(guard.actor, decodeURIComponent(job_no || ""), body.data.reason);
    return successResponse(job, `ยกเลิกงาน ${job.job_no} เรียบร้อย — ผลผลิตที่ยืนยันแล้วยังเก็บไว้ครบ`);
  } catch (error) {
    return productionErrorResponse(error);
  }
}
