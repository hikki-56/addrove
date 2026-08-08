import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";
import { decode } from "next-auth/jwt";
import { getAuthSecret } from "@/lib/server-secrets";

async function isValidSessionToken(token: string): Promise<boolean> {
  for (const salt of ["authjs.session-token", "next-auth.session-token"]) {
    const decoded = await decode({ token, secret: getAuthSecret(), salt }).catch(() => null);
    const id = decoded?.id || decoded?.sub;
    const role = decoded?.role;
    const expiresAt = Number(decoded?.exp || 0);
    if (
      typeof id === "string" &&
      ["ADMIN", "WAREHOUSE_STAFF", "VIEWER"].includes(String(role)) &&
      Number.isFinite(expiresAt) &&
      expiresAt > Date.now() / 1000
    ) return true;
  }
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow root, login, employee-login, warehouses/qr, static files, system health, and auth API endpoints
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/employee-login" ||
    pathname === "/admin-login" ||
    pathname === "/warehouses/qr" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/system") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Check Authorization header, X-Tab-Token header, or NextAuth session token cookie
  const authHeader = request.headers.get("authorization");
  const tabHeader = request.headers.get("x-tab-token");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

  const sessionToken =
    bearerToken ||
    tabHeader ||
    request.cookies.get("authjs.session-token")?.value ||
    request.cookies.get("__Secure-authjs.session-token")?.value ||
    request.cookies.get("next-auth.session-token")?.value ||
    request.cookies.get("__Secure-next-auth.session-token")?.value;

  if (!sessionToken) {
    if (!pathname.startsWith("/api/")) {
      const loginUrl = new URL("/employee-login", request.nextUrl.origin);
      loginUrl.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
      const targetWh = request.nextUrl.searchParams.get("warehouse_id") || request.nextUrl.searchParams.get("wh");
      if (targetWh) {
        loginUrl.searchParams.set("warehouse_id", normalizeWarehouseId(targetWh));
      }
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.json(
      { success: false, message: "กรุณากรอกรหัส PIN เพื่อเข้าสู่ระบบ" },
      { status: 401 }
    );
  }

  if (!(await isValidSessionToken(sessionToken))) {
    if (!pathname.startsWith("/api/")) {
      const loginUrl = new URL("/employee-login", request.nextUrl.origin);
      loginUrl.searchParams.set("expired", "true");
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.json(
      { success: false, message: "โทเคนไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่" },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
