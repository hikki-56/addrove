import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/repositories";
import { generateEmployeeQrToken } from "@/lib/qr-token";
import { getAuthSession } from "@/lib/auth-session";

export async function GET(req: NextRequest) {
  try {
    // Only admins can generate QR tokens
    const session = await getAuthSession(req);
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json(
        { success: false, message: "ไม่มีสิทธิ์เข้าถึง" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { success: false, message: "กรุณาระบุ userId" },
        { status: 400 }
      );
    }

    const employee = await getRepository().users.findById(userId);
    if (!employee || !employee.active || employee.role === "ADMIN") {
      return NextResponse.json(
        { success: false, message: "ไม่พบพนักงานที่เปิดใช้งาน" },
        { status: 404 }
      );
    }

    const token = generateEmployeeQrToken(userId);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const loginUrl = `${baseUrl}/employee-login?token=${token}`;

    return NextResponse.json({
      success: true,
      token,
      url: loginUrl,
      expires_in: "30 วัน (ยังต้องใช้ PIN ยืนยันตัวตน)",
    });
  } catch (e) {
    console.error("[QR Token API Error]", e);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาด" },
      { status: 500 }
    );
  }
}
