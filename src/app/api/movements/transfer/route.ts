import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { TransferDocumentSchema } from "@/types/api";
import { InventoryService } from "@/lib/services/inventory.service";
import {
  successResponse, unauthorizedResponse, forbiddenResponse,
  zodErrorResponse, serverErrorResponse, hasWarehouseAccess,
} from "@/lib/api-response";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    if (session.user.role === "VIEWER") return forbiddenResponse();
    const body = await req.json();
    const input = TransferDocumentSchema.parse(body);
    if (
      !hasWarehouseAccess(session.user.warehouse_access, input.from_warehouse_id) ||
      !hasWarehouseAccess(session.user.warehouse_access, input.to_warehouse_id)
    ) return forbiddenResponse("คุณไม่มีสิทธิ์เข้าถึงโกดังดังกล่าว");
    const repo = getRepository();
    const service = new InventoryService(repo);
    const doc = await service.transfer({ ...input, user_id: session.user.id });
    return successResponse(doc, "โอนสินค้าสำเร็จ", 201);
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
