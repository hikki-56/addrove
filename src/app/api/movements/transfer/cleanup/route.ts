import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import {
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/api-response";

/**
 * DELETE /api/movements/transfer/cleanup
 * 
 * Endpoint นี้ถูกระงับการทำงานถาวร (Disabled for Audit & Ledger Integrity)
 * เหตุผลด้านความปลอดภัยและความถูกต้องของข้อมูล:
 * การลบเอกสารใบย้ายสินค้า (Documents) หรือประวัติการเคลื่อนไหวสต็อก (StockMovements) ย้อนหลัง
 * จะทำลายความถูกต้องของบัญชีคุมสต็อก (Inventory Ledger Integrity), ยอดคงเหลือทางบัญชี (Balance Integrity)
 * และประวัติการตรวจสอบย้อนกลับ (Audit Trail)
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้น");

    return NextResponse.json(
      {
        success: false,
        message:
          "Endpoint การลบประวัติการย้ายสต็อกถูกระงับการใช้งานถาวร เพื่อรักษาความถูกต้องของ Inventory Ledger และ Audit Trail",
      },
      { status: 405 }
    );
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        message: "เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์",
      },
      { status: 500 }
    );
  }
}
