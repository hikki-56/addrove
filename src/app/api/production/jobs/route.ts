import { NextRequest, NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/security";
import {
  guardProductionRoute,
  parseBody,
  productionErrorResponse,
} from "@/lib/production/production-route-helpers";
import { listJobs, createJobs } from "@/lib/production/production-job.service";
import { createProductionJobsSchema } from "@/lib/production/production-schemas";
import { successResponse } from "@/lib/api-response";

export const maxDuration = 60;

// GET /api/production/jobs — รายการใบสั่งผลิต (ADMIN + APPROVER)
// query: date_from, date_to, table_no, status, q
export async function GET(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_VIEW);
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(req.url);
    const jobs = await listJobs({
      date_from: searchParams.get("date_from") || undefined,
      date_to: searchParams.get("date_to") || undefined,
      table_no: searchParams.get("table_no") ? Number(searchParams.get("table_no")) : undefined,
      status: searchParams.get("status") || undefined,
      q: searchParams.get("q") || undefined,
    });
    return NextResponse.json({ success: true, data: jobs, total: jobs.length });
  } catch (error) {
    return productionErrorResponse(error);
  }
}

// POST /api/production/jobs — สร้างงานฉบับร่าง (ADMIN) หลายงานพร้อมกันได้
export async function POST(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
    if (!guard.ok) return guard.response;

    const body = await parseBody(req, createProductionJobsSchema);
    if (!body.ok) return body.response;

    const jobs = await createJobs(guard.actor, body.data.jobs);
    return successResponse(jobs, `สร้างงานผลิต ${jobs.length} งาน (ฉบับร่าง) เรียบร้อย`, 201);
  } catch (error) {
    return productionErrorResponse(error);
  }
}
