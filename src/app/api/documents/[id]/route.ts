import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import {
  successResponse, unauthorizedResponse, notFoundResponse, serverErrorResponse,
} from "@/lib/api-response";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    const { id } = await params;
    const repo = getRepository();
    const doc = await repo.documents.findById(id);
    if (!doc) return notFoundResponse("ไม่พบเอกสาร");
    const movements = await repo.movements.findByDocumentId(id);
    return successResponse({ document: doc, movements }, "โหลดรายละเอียดเอกสารสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
