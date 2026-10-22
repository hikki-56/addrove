import { NextRequest, NextResponse } from "next/server";
import { guardProductionRoute, PERMISSIONS, productionErrorResponse } from "@/server/production/production-route-helpers";
import { getRepository } from "@/server/repositories";

export async function GET(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_VIEW);
    if (!guard.ok) return guard.response;
    const repo = getRepository();
    const warehouse = (await repo.warehouses.findAll()).find(w => w.active && (w.warehouse_name === "โกดัง2" || /^wh-0?2$/.test(w.warehouse_id)));
    return NextResponse.json({ success: true, data: warehouse ? (await repo.locations.findAll(warehouse.warehouse_id)).filter(l => l.active && l.location_code) : [] });
  } catch (error) { return productionErrorResponse(error); }
}
