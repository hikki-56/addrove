import { NextRequest } from "next/server";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { StockCountService } from "@/server/services/stock-count.service";
import {
  successResponse, unauthorizedResponse, forbiddenResponse,
  notFoundResponse, serverErrorResponse,
} from "@/server/api-response";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่สามารถอนุมัติ");
    const { id } = await params;
    const repo = getRepository();
    const svc = new StockCountService(repo);
    const updated = await svc.approveCount(id, session.user.id);
    if (!updated) return notFoundResponse();
    return successResponse(updated, "อนุมัติการตรวจนับสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
