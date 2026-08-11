import { NextRequest, NextResponse } from "next/server";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const rawId = resolvedParams?.id || "";
  const whId = normalizeWarehouseId(rawId);
  const searchParams = req.nextUrl.searchParams;
  const action = searchParams.get("action") || searchParams.get("act") || "receive";

  const targetPath = action === "move"
    ? `/movements/move?warehouse_id=${whId}`
    : `/movements/receive?warehouse_id=${whId}`;

  const redirectUrl = new URL(`/employee-login`, req.nextUrl.origin);
  redirectUrl.searchParams.set("warehouse_id", whId);
  redirectUrl.searchParams.set("callbackUrl", targetPath);

  return NextResponse.redirect(redirectUrl);
}
