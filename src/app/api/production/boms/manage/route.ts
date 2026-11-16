import { NextRequest, NextResponse } from "next/server";
import { guardProductionRoute, parseBody, PERMISSIONS, productionErrorResponse } from "@/server/production/production-route-helpers";
import { withStorageRequest } from "@/server/storage-transaction";
import { createBomFormula, deleteBomFormula, getBomManagementData, updateProductBomFormula } from "@/server/production/bom-management.service";
import { bomManagementCreateSchema, bomManagementDeleteSchema, bomManagementUpdateSchema } from "@/server/production/bom-editor-schemas";
import { forbiddenResponse } from "@/server/api-response";

async function guardManagement(req: NextRequest): Promise<NextResponse | null> {
  const guard = await guardProductionRoute(req, PERMISSIONS.PRODUCTION_MANAGE);
  if (!guard.ok) return guard.response;
  // Managing master recipes is restricted to the Admin dialog, even when
  // another role has received a production-menu permission grant.
  return guard.actor.role === "ADMIN" ? null : forbiddenResponse("เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่จัดการสูตรได้");
}

export async function GET(req: NextRequest) {
  try {
    const denied = await guardManagement(req);
    if (denied) return denied;
    const productId = req.nextUrl.searchParams.get("product_id");
    if (!productId) return NextResponse.json({ success: false, message: "กรุณาเลือกสินค้าสำเร็จรูป" }, { status: 400 });
    return NextResponse.json({ success: true, data: await getBomManagementData(productId) });
  } catch (error) { return productionErrorResponse(error); }
}

export const POST = withStorageRequest(async (req: NextRequest) => {
  try {
    const denied = await guardManagement(req);
    if (denied) return denied;
    const body = await parseBody(req, bomManagementCreateSchema);
    if (!body.ok) return body.response;
    const bomId = await createBomFormula(body.data.product_id, body.data);
    return NextResponse.json({ success: true, bom_id: bomId, data: await getBomManagementData(body.data.product_id) }, { status: 201 });
  } catch (error) { return productionErrorResponse(error); }
});

export const PATCH = withStorageRequest(async (req: NextRequest) => {
  try {
    const denied = await guardManagement(req);
    if (denied) return denied;
    const body = await parseBody(req, bomManagementUpdateSchema);
    if (!body.ok) return body.response;
    await updateProductBomFormula(body.data.product_id, body.data);
    return NextResponse.json({ success: true, bom_id: body.data.bom_id, data: await getBomManagementData(body.data.product_id) });
  } catch (error) { return productionErrorResponse(error); }
});

export const DELETE = withStorageRequest(async (req: NextRequest) => {
  try {
    const denied = await guardManagement(req);
    if (denied) return denied;
    const body = await parseBody(req, bomManagementDeleteSchema);
    if (!body.ok) return body.response;
    await deleteBomFormula(body.data.product_id, body.data.bom_id, body.data.revision);
    return NextResponse.json({ success: true, data: await getBomManagementData(body.data.product_id) });
  } catch (error) { return productionErrorResponse(error); }
});
