import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { ReceiveDocumentSchema } from "@/types/api";
import { InventoryService } from "@/lib/services/inventory.service";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  zodErrorResponse,
  serverErrorResponse,
  hasWarehouseAccess,
} from "@/lib/api-response";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    if (session.user.role === "VIEWER") return forbiddenResponse("VIEWER ไม่มีสิทธิ์รับสินค้า");

    const body = await req.json();
    const input = ReceiveDocumentSchema.parse(body);

    // Check warehouse access (Admin bypasses)
    if (session.user.role !== "ADMIN" && !hasWarehouseAccess(session.user.warehouse_access, input.warehouse_id)) {
      return forbiddenResponse("คุณไม่มีสิทธิ์เข้าถึงโกดังนี้");
    }

    const repo = getRepository();
    const service = new InventoryService(repo);
    const doc = await service.receive({ ...input, user_id: session.user.id });

    return successResponse(doc, "บันทึกรายการรับสินค้าสำเร็จ", 201);
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
