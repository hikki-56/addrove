import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { CreateMasterProductSchema } from "@/types/api";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { withStorageRequest } from "@/server/storage-transaction";
import { errorResponse, forbiddenResponse, serverErrorResponse, successResponse, unauthorizedResponse, zodErrorResponse } from "@/server/api-response";

export const POST = withStorageRequest(async (req: NextRequest) => {
  try {
    const session = await getAuthSession(req);
    if (!session?.user?.id) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่เพิ่มสินค้าในทะเบียนได้");
    const input = CreateMasterProductSchema.parse(await req.json().catch(() => null));
    const repo = getRepository();
    if (await repo.products.findBySku(input.sku)) return errorResponse("รหัสสินค้า (SKU) นี้มีในทะเบียนแล้ว", 409);
    if (await repo.products.findByBarcode(input.barcode || input.sku)) return errorResponse("บาร์โค้ดนี้มีในทะเบียนแล้ว", 409);
    const product = await repo.products.create({ ...input, initial_quantity: 0 });
    return successResponse(product, "เพิ่มสินค้าในทะเบียนแล้ว", 201);
  } catch (error) {
    if (error instanceof ZodError) return zodErrorResponse(error);
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return errorResponse("รหัสสินค้าหรือบาร์โค้ดนี้มีในทะเบียนแล้ว", 409);
    }
    return serverErrorResponse(error);
  }
});
