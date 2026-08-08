import { getRepository } from "@/lib/repositories";
import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import type { User } from "@/types/models";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json(
        { success: false, message: "เฉพาะ Admin เท่านั้น" },
        { status: session ? 403 : 401 }
      );
    }

    const repo = getRepository();
    const users = await repo.users.findAll();

    // Filter active employees (excluding ADMIN role)
    const employees = users
      .filter((u: User) => u.active && u.role !== "ADMIN")
      .map((u: User) => ({
        id: u.user_id,
        name: u.full_name,
        email: u.email,
        role: u.role,
        has_pin: Boolean(u.pin_hash),
      }));

    return NextResponse.json({
      success: true,
      data: employees,
    });
  } catch (e) {
    console.error("[Get Employees API Error]", e);
    return NextResponse.json(
      { success: false, message: "ไม่สามารถดึงข้อมูลพนักงานได้" },
      { status: 500 }
    );
  }
}
