import { NextRequest, NextResponse } from "next/server";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const rawId = resolvedParams?.id || "";

  // บาร์โค้ดประจำจุดพนักงานแพ็กของ (ใบเดียว ไม่แยกตามโกดัง)
  // สแกนแล้วเข้าหน้า login ของส่วนพนักงานแพ็กของโดยเฉพาะ
  if (rawId.toLowerCase() === "packer") {
    const packerLoginUrl = new URL("/employee-login", req.nextUrl.origin);
    packerLoginUrl.searchParams.set("section", "packer");
    return NextResponse.redirect(packerLoginUrl);
  }

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
