import { NextRequest, NextResponse } from "next/server";
import { guardProductionRoute, PERMISSIONS, productionErrorResponse } from "@/server/production/production-route-helpers";
import { getRepository } from "@/server/repositories";
import { listProductionCapacities } from "@/server/production/production-material.service";

export async function GET(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
    if (!guard.ok) return guard.response;
    return NextResponse.json({ success: true, data: await listProductionCapacities(getRepository(), req.nextUrl.searchParams.get("job_no") || "") });
  } catch (error) { return productionErrorResponse(error); }
}
