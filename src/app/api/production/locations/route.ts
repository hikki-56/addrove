import { NextRequest, NextResponse } from "next/server";
import { guardProductionRoute, PERMISSIONS, productionErrorResponse } from "@/server/production/production-route-helpers";
import { getRepository } from "@/server/repositories";
import { findOfficeWarehouse, findWarehouse2, leftoverLocations, pickOfficeLocation, receiptLocations } from "@/features/production/lib/report-locations";

export async function GET(req: NextRequest) {
  try {
    const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_VIEW);
    if (!guard.ok) return guard.response;
    const repo = getRepository();
    const warehouses = await repo.warehouses.findAll();
    const warehouse2 = findWarehouse2(warehouses);
    const officeWarehouse = findOfficeWarehouse(warehouses);
    const warehouse2Id = warehouse2?.warehouse_id || "";
    const [warehouse2Rows, officeRows] = await Promise.all([
      warehouse2Id ? repo.locations.findAll(warehouse2Id) : Promise.resolve([]),
      officeWarehouse ? repo.locations.findAll(officeWarehouse.warehouse_id) : Promise.resolve([]),
    ]);
    const office = officeWarehouse ? pickOfficeLocation(officeRows, officeWarehouse.warehouse_id) : null;
    const receipt = warehouse2Id ? receiptLocations([...warehouse2Rows, ...officeRows], warehouse2Id, office) : [];
    const leftover = warehouse2Id ? leftoverLocations(warehouse2Rows, warehouse2Id) : [];
    return NextResponse.json({ success: true, data: receipt, leftover_locations: leftover });
  } catch (error) { return productionErrorResponse(error); }
}
