import { getRepository } from "@/lib/repositories";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import type { User } from "@/types/models";
import { encode } from "next-auth/jwt";
import { recordLoginLog } from "@/lib/services/login-log.service";
import { getAuthSecret } from "@/lib/server-secrets";
import {
  clearFailedAttempts,
  getClientIp,
  getRateLimitRetryAfter,
  recordFailedAttempt,
} from "@/lib/rate-limit";

const LOGIN_RATE_LIMIT = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

function rateLimitedResponse(retryAfter: number) {
  return NextResponse.json(
    { success: false, message: "ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

/** Strictly verify password using Bcrypt hash only. Fails closed on plaintext or malformed hash. */
function verifyPassword(password: string, hash: string): boolean {
  if (!hash || !hash.trim()) return false;
  const cleanHash = hash.trim();

  if (cleanHash.startsWith("$2b$") || cleanHash.startsWith("$2a$") || cleanHash.startsWith("$2y$")) {
    try {
      return bcrypt.compareSync(password, cleanHash);
    } catch (err) {
      console.error("[Login] bcrypt.compareSync error:", err);
      return false;
    }
  }

  // Strictly fail closed: Plaintext passwords or fallback keywords are not accepted
  return false;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return NextResponse.json(
        { success: false, message: "กรุณากรอกอีเมลและรหัสผ่าน" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const clientIp = getClientIp(req);
    const rateLimitKey = `password-login:${clientIp}:${normalizedEmail}`;
    const retryAfter = getRateLimitRetryAfter(rateLimitKey);
    if (retryAfter > 0) return rateLimitedResponse(retryAfter);

    // Find user strictly from repository
    const repo = getRepository();
    const user = await repo.users.findByEmail(normalizedEmail).catch(() => null);

    // Fail closed if user not found or inactive
    if (!user || !user.active || !user.password_hash) {
      const blockedFor = recordFailedAttempt(rateLimitKey, LOGIN_RATE_LIMIT);
      if (blockedFor > 0) return rateLimitedResponse(blockedFor);
      return NextResponse.json(
        { success: false, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" },
        { status: 401 }
      );
    }

    // Verify password strictly against user's bcrypt hash
    const isValid = verifyPassword(password, user.password_hash);
    if (!isValid) {
      const blockedFor = recordFailedAttempt(rateLimitKey, LOGIN_RATE_LIMIT);
      if (blockedFor > 0) return rateLimitedResponse(blockedFor);
      return NextResponse.json(
        { success: false, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" },
        { status: 401 }
      );
    }

    clearFailedAttempts(rateLimitKey);

    // Parse warehouse access with fail-closed security
    let warehouseAccess: string[] = [];
    try {
      const parsed = JSON.parse(user.warehouse_access);
      if (Array.isArray(parsed)) {
        warehouseAccess = parsed.filter((v): v is string => typeof v === "string");
      } else if (parsed === "*") {
        warehouseAccess = user.role === "ADMIN" ? ["*"] : [];
      }
    } catch {
      warehouseAccess = user.role === "ADMIN" ? ["*"] : [];
    }

    const ADMIN_SESSION_MAX_AGE = 24 * 60 * 60; // 24 Hours session timeout (86,400 seconds)
    const expiresAtMs = Date.now() + ADMIN_SESSION_MAX_AGE * 1000;

    const tokenPayload = {
      id: user.user_id,
      email: user.email,
      name: user.full_name,
      role: user.role,
      warehouse_access: warehouseAccess,
      exp: Math.floor(expiresAtMs / 1000),
    };

    const token = await encode({
      token: tokenPayload,
      secret: getAuthSecret(),
      salt: "authjs.session-token",
      maxAge: ADMIN_SESSION_MAX_AGE,
    });

    // Record login log to durable storage and wait for result
    await recordLoginLog({
      user_id: user.user_id,
      user_name: user.full_name,
      user_email: user.email,
      user_role: user.role,
      login_method: "PASSWORD",
      ip_address: clientIp,
      user_agent: req.headers.get("user-agent") || "Browser",
    });

    const response = NextResponse.json({
      success: true,
      message: "เข้าสู่ระบบสำเร็จ",
      user: tokenPayload,
      token,
      expires_at: expiresAtMs,
    });

    const cookieOptions = {
      httpOnly: true,
      path: "/",
      maxAge: ADMIN_SESSION_MAX_AGE,
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
