import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { receiveStock, ReceiveStockSchema } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // 1. Auth + permission check — same policy as issue/move routes
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    // 2. Parse request body
    const body = await req.json().catch(() => ({}));
    const parsed = ReceiveStockSchema.safeParse(body);
    if (!parsed.success) {
      // Friendly Thai message without raw zod paths like "lines.0.qty: ..."
      const issues = parsed.error.issues || [];
      const first = issues[0];
      let msg = first?.message || "ข้อมูลไม่ถูกต้อง";
      if (first && first.path && first.path[0] === "lines" && typeof first.path[1] === "number") {
        msg = `รายการที่ ${(first.path[1] as number) + 1}: ${msg}`;
      }
      return errorResponse(msg || "ข้อมูลไม่ถูกต้อง");
    }

    try {
      authorize(actor, PERMISSIONS.STOCK_RECEIVE, parsed.data.warehouse_id);
    } catch (authErr: any) {
      if (authErr?.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr?.message ?? "คุณไม่มีสิทธิ์รับสินค้าเข้าโกดังนี้");
    }

    // 3. Create PENDING receive document for Admin approval
    const repo = getRepository();
    const creatorName =
      (body as any).created_by_name ||
      (body as any).user_name ||
      actor.username ||
      (actor.role === "ADMIN" ? "ผู้ดูแลระบบ (Admin)" : "พนักงานรับสินค้า");
    const doc = await receiveStock(
      { repo },
      {
        ...parsed.data,
        user_id: actor.id || "unknown",
        role: actor.role || "WAREHOUSE_STAFF",
        user_name: creatorName,
        created_by_name: creatorName,
      } as any
    );

    return successResponse(doc, "ส่งรายการรับสินค้าไปรออนุมัติสำเร็จ (สถานะ: รอดำเนินการ)", 201);
  } catch (e) {
    console.error("[POST /api/movements/receive] Error:", e);
    return serverErrorResponse(e);
  }
}
