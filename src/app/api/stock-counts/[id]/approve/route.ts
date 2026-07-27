import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { StockCountService } from "@/lib/services/stock-count.service";
import {
  successResponse, unauthorizedResponse, forbiddenResponse,
  notFoundResponse, serverErrorResponse,
} from "@/lib/api-response";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
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
