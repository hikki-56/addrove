import { getRepository } from "@/lib/repositories";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: "กรุณากรอกอีเมลและรหัสผ่าน" },
        { status: 400 }
      );
    }

    const repo = getRepository();
    const allUsers = await repo.users.findAll().catch(() => []);
    let user = allUsers.find(
      (u) => u && u.email && u.email.toLowerCase() === email.trim().toLowerCase()
    );

    // Fallback default admin user if not found in sheet
    if (!user && email.trim().toLowerCase() === "admin@stockify.com") {
      user = {
        user_id: "usr-admin-default",
        full_name: "ผู้ดูแลระบบ (Admin)",
        email: "admin@stockify.com",
        password_hash: "$2b$10$6dao1rnsknFWwCbTwHKgM.FhLSjayj.rRufuZNYrR3lINnErSEsP.", // Admin1234!
        role: "ADMIN",
        warehouse_access: '["*"]',
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    // Fallback default staff user if not found in sheet
    if (!user && email.trim().toLowerCase() === "staff@stockify.com") {
      user = {
        user_id: "usr-staff-default",
        full_name: "พนักงานคลังสินค้า (Staff)",
        email: "staff@stockify.com",
        password_hash: "$2b$10$gnRr8b6LxSEqj6inPNqhf.PQHK2tdIHfk.EOIjF/Y.x7QC8YoTG4i", // Staff1234!
        role: "WAREHOUSE_STAFF",
        warehouse_access: '["*"]',
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    if (!user || !user.active) {
      return NextResponse.json(
        { success: false, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { success: false, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" },
        { status: 400 }
      );
    }

    let warehouseAccess: string[];
    try {
      warehouseAccess = JSON.parse(user.warehouse_access);
    } catch {
      warehouseAccess = user.warehouse_access === "*" ? ["*"] : [];
    }

    const tokenPayload = {
      id: user.user_id,
      email: user.email,
      name: user.full_name,
      role: user.role,
      warehouse_access: warehouseAccess,
    };

    const secret =
      process.env.AUTH_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      "stockify-secret-key-super-secure-2026";

    // Encode JWT token (Auth.js compatible)
    const token = await encode({
      token: tokenPayload,
      secret,
      salt: "authjs.session-token",
    });

    const response = NextResponse.json({
      success: true,
      message: "เข้าสู่ระบบสำเร็จ",
      user: tokenPayload,
    });

    // Set session cookie for both Auth.js and NextAuth cookie names
    const cookieOptions = {
      httpOnly: true,
      path: "/",
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
    };

    response.cookies.set("authjs.session-token", token, cookieOptions);
    response.cookies.set("next-auth.session-token", token, cookieOptions);
    if (process.env.NODE_ENV === "production") {
      response.cookies.set("__Secure-authjs.session-token", token, cookieOptions);
      response.cookies.set("__Secure-next-auth.session-token", token, cookieOptions);
    }

    return response;
  } catch (e) {
    console.error("[Login API Error]", e);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" },
      { status: 500 }
    );
  }
}
