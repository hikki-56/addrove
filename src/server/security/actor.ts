import type { NextRequest } from "next/server";
import type { UserRole } from "@/types/models";
import type { Permission } from "./permissions";

export interface Actor {
  id: string;
  username: string;
  role: UserRole;
  warehouseAccess?: string;
  /** สิทธิ์เพิ่มจากเมนูที่ ty ติ๊กให้ (นอกบทบาท) — ดู src/lib/menu-grants.ts */
  grantedPermissions?: readonly Permission[];
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
  let actor: Actor | null;
  if (sessionOverride !== undefined) {
    actor = extractActorFromSession(sessionOverride, req);
  } else {
    try {
      const { getAuthSession } = await import("@/server/auth-session");
      const session = await getAuthSession(req);
      actor = extractActorFromSession(session, req);
    } catch {
      return null;
    }
  }
  if (actor && actor.role !== "ADMIN") {
    const { loadGrantedPermissions } = await import("./menu-grants");
    actor.grantedPermissions = await loadGrantedPermissions(actor.id, actor.role);
  }
  return actor;
}
