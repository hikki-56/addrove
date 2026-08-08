import { auth } from "@/lib/auth";
import { decode } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { getAuthSecret } from "@/lib/server-secrets";
import type { UserRole } from "@/types/models";

const USER_ROLES = new Set<UserRole>(["ADMIN", "WAREHOUSE_STAFF", "VIEWER"]);

async function decodeSessionToken(token: string) {
  for (const salt of ["authjs.session-token", "next-auth.session-token"]) {
    const decoded = await decode({
      token,
      secret: getAuthSecret(),
      salt,
    }).catch(() => null);

    const id = decoded?.id || decoded?.sub;
    const role = decoded?.role;
    const expiresAt = Number(decoded?.exp || 0);
    if (
      decoded &&
      typeof id === "string" &&
      USER_ROLES.has(role as UserRole) &&
      Number.isFinite(expiresAt) &&
      expiresAt > Date.now() / 1000
    ) {
      return {
        user: {
          id,
          name: typeof decoded.name === "string" ? decoded.name : "ผู้ใช้งานระบบ",
          email: typeof decoded.email === "string" ? decoded.email : "",
          role: role as UserRole,
          warehouse_access: Array.isArray(decoded.warehouse_access)
            ? decoded.warehouse_access.filter(
                (value): value is string => typeof value === "string"
              )
            : [],
        },
        expires: new Date(expiresAt * 1000).toISOString(),
      };
    }
  }
  return null;
}

export async function getAuthSession(req?: NextRequest) {
  if (req) {
    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7).trim()
      : null;
    const tabToken = req.headers.get("x-tab-token")?.trim() || null;
    const explicitToken = bearerToken || tabToken;

    // An explicit tab/bearer token is authoritative. Never silently fall back
    // to another user's shared browser cookie when it is invalid.
    if (explicitToken) {
      return decodeSessionToken(explicitToken);
    }
  }

  try {
    const session = await auth();
    if (session?.user) return session;
  } catch {
    // Fall through to manually issued Auth.js-compatible cookies.
  }

  if (!req) return null;
  const cookieToken =
    req.cookies.get("authjs.session-token")?.value ||
    req.cookies.get("__Secure-authjs.session-token")?.value ||
    req.cookies.get("next-auth.session-token")?.value ||
    req.cookies.get("__Secure-next-auth.session-token")?.value;

  return cookieToken ? decodeSessionToken(cookieToken) : null;
}
