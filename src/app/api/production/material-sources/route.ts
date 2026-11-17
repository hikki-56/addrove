import { NextRequest, NextResponse } from "next/server";
import { guardProductionRoute, PERMISSIONS, productionErrorResponse } from "@/server/production/production-route-helpers";
import { listProductionBoms } from "@/server/production/production-bom.service";
import { getMaterialPlan } from "@/server/production/production-material.service";
import { availableMaterialSources } from "@/server/production/production-material-sources.service";
import { getRepository } from "@/server/repositories";

export async function GET(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
    if (!guard.ok) return guard.response;
    const productId = req.nextUrl.searchParams.get("product_id");
    if (!productId) return NextResponse.json({ success: false, message: "กรุณาเลือกสินค้า" }, { status: 400 });
    const jobNo = req.nextUrl.searchParams.get("job_no") || "";
    const [formulas, plan] = await Promise.all([listProductionBoms(productId), jobNo ? getMaterialPlan(jobNo) : null]);
    const items = [...formulas.flatMap(f => f.items), ...(plan?.snapshot.product_id === productId ? plan.snapshot.items : [])];
    const ids = [...new Set(items.map(i => i.product_id).filter(Boolean))];
    return NextResponse.json({ success: true, data: await availableMaterialSources(getRepository(), ids, jobNo) });
  } catch (error) { return productionErrorResponse(error); }
}
