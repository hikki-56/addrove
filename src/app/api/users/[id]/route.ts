import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { UpdateUserSchema } from "@/types/api";
import bcrypt from "bcryptjs";
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
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่แก้ไขพนักงานได้");

    const { id } = await params;
    const body = await req.json();
    const input = UpdateUserSchema.parse(body);
    const repo = getRepository();

    const updates: Record<string, unknown> = { ...input };
    if (input.password) {
      updates.password_hash = bcrypt.hashSync(input.password, 10);
      delete updates.password;
    }

    const updated = await repo.users.update(id, updates);
    if (!updated) return notFoundResponse("ไม่พบข้อมูลพนักงาน");

    return successResponse(
      { ...updated, password_hash: undefined },
      "อัปเดตข้อมูลพนักงานสำเร็จ"
    );
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
