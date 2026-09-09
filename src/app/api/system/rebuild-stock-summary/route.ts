import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import {
  successResponse, unauthorizedResponse, forbiddenResponse, serverErrorResponse,
} from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// POST /api/system/rebuild-stock-summary — ADMIN only
// คำนวณยอดคงเหลือในชีต StockSummary ใหม่จาก StockMovements ทั้งหมด
// (ปลอดภัย: เขียนยอดใหม่ก่อน ยืนยันแล้วจึงลบแถวเดิม — ไม่มีช่วงเวลาที่ชีตว่าง)
export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") {
      return forbiddenResponse("เฉพาะผู้ดูแลระบบเท่านั้นที่สร้างยอดคงเหลือใหม่ได้");
    }
    const repo = getRepository();
    await repo.stockSummary.rebuild();
    return successResponse(
      { rebuilt: true },
      "สร้างยอดคงเหลือ (StockSummary) ใหม่จาก StockMovements สำเร็จ"
    );
  } catch (e) {
    console.error("[RebuildStockSummary API] rebuild failed:", e);
    return serverErrorResponse(e);
  }
}
