import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { UpdateProductSchema } from "@/types/api";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  zodErrorResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { ZodError } from "zod";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    const { id } = await params;
    const repo = getRepository();
    const product = await repo.products.findById(id);
    if (!product) return notFoundResponse("ไม่พบสินค้า");
    return successResponse(product, "โหลดข้อมูลสินค้าสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    if (session.user.role === "VIEWER") return forbiddenResponse();
    const { id } = await params;
    const body = await req.json();
    const input = UpdateProductSchema.parse(body);
    const repo = getRepository();
    // Check no delete if has movements
    if (input.active === false) {
      const hasMovements = await repo.products.hasMovements(id);
      // Deactivating is OK even with movements - just don't delete
    }
    const updated = await repo.products.update(id, input);
    if (!updated) return notFoundResponse("ไม่พบสินค้า");
    return successResponse(updated, "อัปเดตสินค้าสำเร็จ");
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
