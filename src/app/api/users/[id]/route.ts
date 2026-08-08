import { NextRequest } from "next/server";
import { getRepository } from "@/lib/repositories";
import { UpdateUserSchema } from "@/types/api";
import bcrypt from "bcryptjs";
import {
  successResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  conflictResponse,
  zodErrorResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { ZodError } from "zod";
import { getAuthSession } from "@/lib/auth-session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const { id } = await params;
    if (session.user.role !== "ADMIN" && session.user.id !== id && session.user.email !== id) {
      return forbiddenResponse();
    }
    const repo = getRepository();

    // Find user by ID or by email
    let user = await repo.users.findById(id).catch(() => null);
    if (!user) {
      user = await repo.users.findByEmail(id).catch(() => null);
    }

    if (!user || !user.active) {
      return notFoundResponse("ไม่พบข้อมูลพนักงาน");
    }

    return successResponse({
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      has_pin: Boolean(user.pin_hash),
    }, "ดึงข้อมูลพนักงานสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่แก้ไขพนักงานได้");

    const { id } = await params;
    const body = await req.json();
    const input = UpdateUserSchema.parse(body);
    const repo = getRepository();

    if (input.pin) {
      const users = await repo.users.findAll();
      const duplicatePin = users.some((user) =>
        user.user_id !== id &&
        Boolean(user.pin_hash?.startsWith("$2")) &&
        bcrypt.compareSync(input.pin!, user.pin_hash)
      );
      if (duplicatePin) {
        return conflictResponse("PIN นี้ถูกใช้งานแล้ว กรุณากำหนด PIN ที่ไม่ซ้ำกัน");
      }
    }

    const updates: Record<string, unknown> = { ...input };
    if (input.password) {
      updates.password_hash = bcrypt.hashSync(input.password, 10);
      delete updates.password;
    }
    if (input.pin) {
      updates.pin_hash = bcrypt.hashSync(input.pin, 10);
      delete updates.pin;
    }

    const updated = await repo.users.update(id, updates);
    if (!updated) return notFoundResponse("ไม่พบข้อมูลพนักงาน");

    return successResponse(
      { ...updated, password_hash: undefined, pin_hash: undefined, has_pin: Boolean(updated.pin_hash) },
      "อัปเดตข้อมูลพนักงานสำเร็จ"
    );
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
