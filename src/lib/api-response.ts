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
  const message =
    error instanceof Error ? error.message : "เกิดข้อผิดพลาดภายในระบบ";
  console.error("[API Error]", error);
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
export function hasWarehouseAccess(
  warehouseAccess: string | string[],
  warehouseId: string
): boolean {
  try {
    // If it's already an array (from session)
    if (Array.isArray(warehouseAccess)) {
      if (warehouseAccess.includes("*")) return true;
      return warehouseAccess.includes(warehouseId);
    }

    // Wildcard string
    if (warehouseAccess === "*") return true;

    // JSON string
    const list: string[] = JSON.parse(warehouseAccess);
    if (list.includes("*")) return true;
    return list.includes(warehouseId);
  } catch {
    // If parsing fails, allow access (graceful fallback for admin)
    return true;
  }
}
