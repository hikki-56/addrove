import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/server/security";
import {
  guardProductionRoute,
  parseBody,
  productionErrorResponse,
} from "@/lib/production/production-route-helpers";
import { reportProduction } from "@/lib/production/production-job.service";
import { reportProductionSchema } from "@/lib/production/production-schemas";
import { successResponse } from "@/lib/api-response";

export const maxDuration = 60;

// POST /api/production/jobs/[job_no]/report — APPROVER รายงานผล (บางส่วน/จบงาน)
// กันกดยืนยันซ้ำด้วย idempotency_key · เพิ่มสต็อกผลิตดีเข้าโกดัง 2 ครั้งเดียวต่อรายงาน · แจ้ง ADMIN ทันที
export async function POST(req: NextRequest, { params }: { params: Promise<{ job_no: string }> }) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_REPORT);
    if (!guard.ok) return guard.response;

    const { job_no } = await params;
    const body = await parseBody(req, reportProductionSchema);
    if (!body.ok) return body.response;

    const result = await reportProduction(guard.actor, decodeURIComponent(job_no || ""), body.data);
    return successResponse(
      result,
      result.replayed
        ? "รายงานนี้ถูกบันทึกไปแล้ว (กดยืนยันซ้ำ) — ระบบไม่บันทึกซ้ำ"
        : result.job.status === "COMPLETED"
          ? `บันทึกรายงานรอบที่ ${result.report.report_no} และจบงานเรียบร้อย`
          : `บันทึกรายงานรอบที่ ${result.report.report_no} เรียบร้อย`
    );
  } catch (error) {
    return productionErrorResponse(error);
  }
}
