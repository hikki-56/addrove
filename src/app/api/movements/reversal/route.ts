import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { ReversalDocumentSchema } from "@/types/api";
import { InventoryService } from "@/lib/services/inventory.service";
import {
  successResponse, unauthorizedResponse, forbiddenResponse,
  zodErrorResponse, serverErrorResponse,
} from "@/lib/api-response";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่สามารถกลับยอด");
    const body = await req.json();
    const input = ReversalDocumentSchema.parse(body);
    const repo = getRepository();
    const service = new InventoryService(repo);
    const doc = await service.reversal({ ...input, user_id: session.user.id });
    return successResponse(doc, "กลับยอดสำเร็จ", 201);
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
