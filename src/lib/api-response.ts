import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function successResponse<T>(data: T, message = "สำเร็จ", status = 200) {
  return NextResponse.json({ success: true, message, data }, { status });
}

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

export function unauthorizedResponse(message = "กรุณาเข้าสู่ระบบ") {
  return NextResponse.json({ success: false, message }, { status: 401 });
}

export function forbiddenResponse(message = "คุณไม่มีสิทธิ์ดำเนินการนี้") {
  return NextResponse.json({ success: false, message }, { status: 403 });
}

export function notFoundResponse(message = "ไม่พบข้อมูล") {
  return NextResponse.json({ success: false, message }, { status: 404 });
}

export function conflictResponse(message = "ข้อมูลถูกเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่") {
  return NextResponse.json({ success: false, message }, { status: 409 });
}

export function zodErrorResponse(error: ZodError) {
  const issues = error.issues || (error as any).errors || [];
  const fieldErrors = issues.map((e: any) => ({
    field: e.path ? e.path.join(".") : "",
    message: e.message,
  }));
  return NextResponse.json(
    { success: false, message: "ข้อมูลไม่ถูกต้อง", errors: fieldErrors },
    { status: 400 }
  );
}

export function serverErrorResponse(error: unknown) {
  console.error("[API Error]", error);
  const message = process.env.NODE_ENV === "production"
    ? "เกิดข้อผิดพลาดภายในระบบ"
    : error instanceof Error
      ? error.message
      : "เกิดข้อผิดพลาดภายในระบบ";
  return NextResponse.json({ success: false, message }, { status: 500 });
}

/**
 * Check if user has access to a warehouse.
 * warehouse_access can be:
 *   - A JSON string: '["wh-id-1", "wh-id-2"]'
 *   - A wildcard: '*' or '["*"]' (full access)
 *   - An array (from session): ["*"] or ["wh-1", "wh-2"]
 * Admin/wildcard gets access to everything.
 */
export function normalizeWarehouseAccessId(value: string) {
  return value.trim().toLowerCase().replace(/^wh-0*([0-9]+)$/, "wh-$1");
}

export function getAccessibleWarehouseIds(
  warehouseAccess: string | string[] | undefined | null
): string[] | null {
  if (!warehouseAccess) return [];
  if (warehouseAccess === "*" || warehouseAccess === '["*"]') return null;

  if (Array.isArray(warehouseAccess)) {
    if (warehouseAccess.includes("*")) return null;
    return [...new Set(warehouseAccess.map(normalizeWarehouseAccessId).filter(Boolean))];
  }

  const trimmed = warehouseAccess.trim();
  if (!trimmed) return [];
  if (trimmed === "*" || trimmed === '["*"]') return null;

  if (trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed.includes("{") || trimmed.includes("}")) {
    try {
      const list = JSON.parse(trimmed);
      if (Array.isArray(list)) {
        if (list.includes("*")) return null;
        return [...new Set(list.map(normalizeWarehouseAccessId).filter(Boolean))];
      }
      return [];
    } catch {
      // Fail closed on malformed JSON
      return [];
    }
  }

  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.includes("*")) return null;
  const validWarehouseRegex = /^[a-zA-Z0-9_\-]+$/;
  const validParts = parts.filter((p) => validWarehouseRegex.test(p));
  if (validParts.length !== parts.length) {
    return [];
  }
  return [...new Set(validParts.map(normalizeWarehouseAccessId).filter(Boolean))];
}

export function hasWarehouseAccess(
  warehouseAccess: string | string[],
  warehouseId: string
): boolean {
  const accessible = getAccessibleWarehouseIds(warehouseAccess);
  return accessible === null || accessible.includes(normalizeWarehouseAccessId(warehouseId));
}
