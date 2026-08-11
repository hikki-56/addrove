import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { receiveStock, ReceiveStockSchema } from "@/lib/services/stock";
import {
  successResponse,
  unauthorizedResponse,
  errorResponse,
  serverErrorResponse,
} from "@/lib/api-response";

export async function POST(req: NextRequest) {
  try {
    // 1. Auth check — get session (allow all roles)
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();

    // 2. Parse request body
    const body = await req.json().catch(() => ({}));
    const parsed = ReceiveStockSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues || [];
      const msg = issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      return errorResponse(msg || "ข้อมูลไม่ถูกต้อง");
    }

    // 3. Create PENDING receive document for Admin approval
    const repo = getRepository();
    const doc = await receiveStock(
      { repo },
      {
        ...parsed.data,
        user_id: session.user.id || "unknown",
        role: session.user.role || "WAREHOUSE_STAFF",
      }
    );

    return successResponse(doc, "ส่งรายการรับสินค้าไปรออนุมัติสำเร็จ (สถานะ: รอดำเนินการ)", 201);
  } catch (e) {
    console.error("[POST /api/movements/receive] Error:", e);
    return serverErrorResponse(e);
  }
}
