import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/server/security";
import {
  guardProductionRoute,
  parseBody,
  productionErrorResponse,
} from "@/server/production/production-route-helpers";
import { adjustProduction } from "@/server/production/production-job.service";
import { adjustProductionSchema } from "@/server/production/production-schemas";
import { successResponse } from "@/lib/api-response";

export const maxDuration = 60;

// POST /api/production/jobs/[job_no]/adjust — ADMIN ปรับปรุงยอดผลผลิตที่ยืนยันแล้ว
// สร้างรายการ ADJUSTMENT (ไม่เขียนทับรายงานเดิม) + ประวัติก่อน–หลัง + รายการปรับสต็อกตรวจย้อนหลังได้
export async function POST(req: NextRequest, { params }: { params: Promise<{ job_no: string }> }) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
    if (!guard.ok) return guard.response;

    const { job_no } = await params;
    const body = await parseBody(req, adjustProductionSchema);
    if (!body.ok) return body.response;

    const result = await adjustProduction(guard.actor, decodeURIComponent(job_no || ""), body.data);
    return successResponse(
      result,
      result.replayed
        ? "รายการปรับปรุงนี้ถูกบันทึกไปแล้ว (กดยืนยันซ้ำ) — ระบบไม่บันทึกซ้ำ"
        : "ปรับปรุงยอดผลผลิตเรียบร้อย — สร้างรายการปรับสต็อกและประวัติแล้ว"
    );
  } catch (error) {
    return productionErrorResponse(error);
  }
}
