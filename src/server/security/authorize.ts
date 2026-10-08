import type { Actor } from "./actor";
import { Permission, ROLE_PERMISSION_MATRIX } from "./permissions";
import { hasWarehouseAccess } from "@/lib/api-response";

export class SecurityError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403,
    public readonly code: "UNAUTHORIZED" | "FORBIDDEN"
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

export class UnauthorizedError extends SecurityError {
  constructor(message = "กรุณาเข้าสู่ระบบก่อนดำเนินการ") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends SecurityError {
  constructor(message = "คุณไม่มีสิทธิ์ในการดำเนินการนี้") {
    super(message, 403, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export function isAuthorized(
  actor: Actor | null | undefined,
  permission: Permission,
  warehouseId?: string
): boolean {
  if (!actor || !actor.role) return false;

  // 1. Role Permission Check
  const allowedPermissions = ROLE_PERMISSION_MATRIX[actor.role] || [];
  if (!allowedPermissions.includes(permission)) {
    return false;
  }

  // 2. Warehouse Access Check (Admin has access to all warehouses)
  if (actor.role === "ADMIN") {
    return true;
  }

  if (warehouseId) {
    return hasWarehouseAccess(actor.warehouseAccess || "", warehouseId);
  }

  return true;
}

export function authorize(
  actor: Actor | null | undefined,
  permission: Permission,
  warehouseId?: string
): Actor {
  if (!actor) {
    throw new UnauthorizedError("กรุณาเข้าสู่ระบบก่อนดำเนินการ");
  }

  const allowedPermissions = ROLE_PERMISSION_MATRIX[actor.role] || [];
  if (!allowedPermissions.includes(permission)) {
    throw new ForbiddenError(`บทบาท ${actor.role} ไม่มีสิทธิ์ดำเนินการ ${permission}`);
  }

  if (warehouseId && actor.role !== "ADMIN") {
    const hasAccess = hasWarehouseAccess(actor.warehouseAccess || "", warehouseId);
    if (!hasAccess) {
      throw new ForbiddenError(`คุณไม่มีสิทธิ์เข้าถึงหรือจัดการข้อมูลของโกดัง ${warehouseId}`);
    }
  }

  return actor;
}
