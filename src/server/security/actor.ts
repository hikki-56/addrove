import type { NextRequest } from "next/server";
import type { UserRole } from "@/types/models";

export interface Actor {
  id: string;
  username: string;
  role: UserRole;
  warehouseAccess?: string;
  correlationId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SessionLike {
  user?: {
    id?: string;
    username?: string;
    name?: string;
    role?: string;
    warehouse_access?: string | string[];
  };
}

export function extractActorFromSession(
  session: SessionLike | null | undefined,
  req?: NextRequest
): Actor | null {
  if (!session || !session.user) return null;

  const correlationId =
    req?.headers?.get("x-correlation-id") ||
    req?.headers?.get("x-request-id") ||
    `corr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const ipAddress =
    req?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req?.headers?.get("x-real-ip") ||
    "127.0.0.1";

  const userAgent = req?.headers?.get("user-agent") || undefined;

  const rawAccess = session.user.warehouse_access;
  const warehouseAccess = Array.isArray(rawAccess)
    ? rawAccess.join(",")
    : rawAccess || "";

  return {
    id: session.user.id || session.user.username || "unknown",
    username: session.user.username || session.user.name || "user",
    role: (session.user.role as UserRole) || "STAFF",
    warehouseAccess,
    correlationId,
    ipAddress,
    userAgent,
  };
}

export async function createActorFromSession(
  req: NextRequest,
  sessionOverride?: SessionLike | null
): Promise<Actor | null> {
  if (sessionOverride !== undefined) {
    return extractActorFromSession(sessionOverride, req);
  }
  try {
    const { getAuthSession } = await import("@/lib/auth-session");
    const session = await getAuthSession(req);
    return extractActorFromSession(session, req);
  } catch {
    return null;
  }
}
