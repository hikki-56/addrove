import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { UpdateLocationSchema } from "@/types/api";
import {
  successResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  zodErrorResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { ZodError } from "zod";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse();
    const { id } = await params;
    const body = await req.json();
    const input = UpdateLocationSchema.parse(body);
    const repo = getRepository();
    const updated = await repo.locations.update(id, input);
    if (!updated) return notFoundResponse("ไม่พบตำแหน่ง");
    return successResponse(updated, "อัปเดตตำแหน่งสำเร็จ");
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
