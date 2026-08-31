import { getRepository } from "@/lib/repositories";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { recordLoginLog } from "@/lib/services/login-log.service";
import type { User } from "@/types/models";
import { getAuthSecret } from "@/lib/server-secrets";
import { verifyEmployeeQrToken } from "@/lib/qr-token";
import {
  clearFailedAttempts,
  getClientIp,
  getRateLimitRetryAfter,
  recordFailedAttempt,
} from "@/lib/rate-limit";

const PIN_RATE_LIMIT = {
  maxFailures: 5,
  windowMs: 5 * 60 * 1000,
  blockMs: 5 * 60 * 1000,
};

/** Check PIN against bcrypt hash, or plaintext PIN fallback if entered directly in Google Sheets */
function checkPinMatch(user: User, inputPin: string): boolean {
  if (!/^\d{4}$/.test(inputPin)) return false;
  const rawPin = user.pin_hash?.trim() || "";
  if (!rawPin) return false;

  if (rawPin.startsWith("$2b$") || rawPin.startsWith("$2a$") || rawPin.startsWith("$2y$")) {
    try {
      return bcrypt.compareSync(inputPin, rawPin);
    } catch {
      return false;
    }
  }

  // Fallback: Support direct plaintext 4-digit PIN comparison (temporary until all sheet rows are hashed)
  if (rawPin === inputPin) {
    console.warn(`[SECURITY WARNING] User ${user.user_id} (${user.email || user.full_name}) logged in using plaintext PIN. Please run scripts/migrate-plaintext-pins.ts`);
    return true;
  }
  return false;
}

export async function POST(req: Request) {
  try {
    const { token, pin } = await req.json();

    if (typeof pin !== "string" && typeof pin !== "number") {
      return NextResponse.json(
        { success: false, message: "กรุณากรอกรหัส PIN" },
        { status: 400 }
      );
    }

    const cleanPin = String(pin).trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      return NextResponse.json(
        { success: false, message: "PIN ต้องเป็นตัวเลข 4 หลัก" },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(req);
    const rateLimitKey = `pin-login:${clientIp}`;
    const retryAfter = getRateLimitRetryAfter(rateLimitKey);
    if (retryAfter > 0) {
      return NextResponse.json(
        { success: false, message: "กรอก PIN ผิดหลายครั้งเกินไป กรุณารอสักครู่" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    const repo = getRepository();
    let targetUser: User | null = null;

    // A signed employee QR token binds the PIN attempt to one account if valid.
    if (token && typeof token === "string") {
      const payload = verifyEmployeeQrToken(token);
      if (payload && payload.employee_id) {
        const u = await repo.users.findById(payload.employee_id).catch(() => null);
        if (u && u.active && u.role !== "ADMIN" && checkPinMatch(u, cleanPin)) {
          targetUser = u;
        }
      }
    }

    // Warehouse QR codes or Direct PIN Login without bound token identify by unique PIN across active non-admin employees.
    if (!targetUser) {
      const allUsers = await repo.users.findAll().catch(() => []);
      const activeEmployees = allUsers.filter((u: User) => u.active && u.role !== "ADMIN");
      const matchedUsers: User[] = [];

      for (const u of activeEmployees) {
        if (checkPinMatch(u, cleanPin)) {
          matchedUsers.push(u);
        }
      }
      // Deduplicate matched users by user_id so duplicate rows in sheet don't block login
      const uniqueMatchedUsers = Array.from(
        new Map(matchedUsers.map((u) => [u.user_id, u])).values()
      );
      if (uniqueMatchedUsers.length >= 1) targetUser = uniqueMatchedUsers[0];
    }

    if (!targetUser) {
      const blockedFor = recordFailedAttempt(rateLimitKey, PIN_RATE_LIMIT);
      if (blockedFor > 0) {
        return NextResponse.json(
          { success: false, message: "กรอก PIN ผิดหลายครั้งเกินไป กรุณารอ 5 นาที" },
          { status: 429, headers: { "Retry-After": String(blockedFor) } }
        );
      }
      return NextResponse.json(
        { success: false, message: "รหัส PIN ไม่ถูกต้อง" },
        { status: 401 }
      );
    }
    clearFailedAttempts(rateLimitKey);

    // Build session token for the matched employee with fail-closed access parsing
    let warehouseAccess: string[] = [];
    try {
      const parsed = JSON.parse(targetUser.warehouse_access);
      if (Array.isArray(parsed)) {
        warehouseAccess = parsed.filter((v): v is string => typeof v === "string");
      } else if (parsed === "*") {
        warehouseAccess = targetUser.role === "ADMIN" ? ["*"] : [];
      }
    } catch {
      warehouseAccess = targetUser.role === "ADMIN" ? ["*"] : [];
    }

    const expiresInSeconds = 2 * 3600; // 2 Hours session timeout
    const expiresAtMs = Date.now() + expiresInSeconds * 1000;

    const tokenPayload = {
      id: targetUser.user_id,
      email: targetUser.email,
      name: targetUser.full_name,
      role: targetUser.role,
      warehouse_access: warehouseAccess,
      exp: Math.floor(expiresAtMs / 1000),
    };

    const sessionToken = await encode({
      token: tokenPayload,
      secret: getAuthSecret(),
      salt: "authjs.session-token",
      maxAge: expiresInSeconds,
    });

    // Record login log asynchronously in background so PIN login responds instantly
    void recordLoginLog({
      user_id: targetUser.user_id,
      user_name: targetUser.full_name,
      user_email: targetUser.email,
      user_role: targetUser.role,
      login_method: "QR_CODE",
      ip_address: clientIp,
      user_agent: req.headers.get("user-agent") || "PIN Kiosk",
    }).catch((err) => {
      console.warn("[qr-login] Background login log write failed:", err);
    });

    const response = NextResponse.json({
      success: true,
      message: `ยินดีต้อนรับคุณ ${targetUser.full_name}`,
      user: tokenPayload,
      token: sessionToken,
      expires_at: expiresAtMs,
    });

    const cookieOptions = {
      httpOnly: true,
      path: "/",
      maxAge: expiresInSeconds,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
    };

    response.cookies.set("authjs.session-token", sessionToken, cookieOptions);
    response.cookies.set("next-auth.session-token", sessionToken, cookieOptions);
    if (process.env.NODE_ENV === "production") {
      response.cookies.set("__Secure-authjs.session-token", sessionToken, cookieOptions);
      response.cookies.set("__Secure-next-auth.session-token", sessionToken, cookieOptions);
    }

    return response;
  } catch (e) {
    console.error("[QR/PIN Login API Error]", e);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" },
      { status: 500 }
    );
  }
}
