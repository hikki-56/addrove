import { NextRequest, NextResponse } from "next/server";
import { guardProductionRoute, PERMISSIONS, productionErrorResponse } from "@/server/production/production-route-helpers";
import { listProductionBoms } from "@/server/production/production-bom.service";
import { z } from "zod";
import { productionBomSelectionSchema } from "@/server/production/production-schemas";
import { parseBody } from "@/server/production/production-route-helpers";
import { previewMaterialAvailability } from "@/server/production/production-material.service";
import { getRepository } from "@/server/repositories";

const previewSchema = z.object({ product_id: z.string().min(1), target_qty: z.number().positive().finite(), selection: productionBomSelectionSchema, job_no: z.string().optional() });

export async function POST(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
    if (!guard.ok) return guard.response;
    const body = await parseBody(req, previewSchema);
    if (!body.ok) return body.response;
    const d = body.data;
    return NextResponse.json({ success: true, data: await previewMaterialAvailability(getRepository(), d.product_id, d.target_qty, d.selection, d.job_no) });
  } catch (error) { return productionErrorResponse(error); }
}

export async function GET(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_VIEW);
    if (!guard.ok) return guard.response;
    return NextResponse.json({ success: true, data: await listProductionBoms(req.nextUrl.searchParams.get("product_id") || undefined) });
  } catch (error) {
    return productionErrorResponse(error);
  }
}
