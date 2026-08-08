import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { CreateUserSchema } from "@/types/api";
import bcrypt from "bcryptjs";
import {
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  zodErrorResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();

    const repo = getRepository();
    const users = await repo.users.findAll();

    // Sanitize password_hash and pin_hash before returning to client
    const safeUsers = users.map((u) =>
      session.user.role === "ADMIN"
        ? {
            ...u,
            password_hash: undefined,
            pin_hash: undefined,
            has_pin: Boolean(u.pin_hash),
          }
        : {
            user_id: u.user_id,
            full_name: u.full_name,
            email: u.email,
            role: u.role,
            active: u.active,
          }
    );

    return successResponse(safeUsers, "โหลดข้อมูลพนักงานสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่เพิ่มพนักงานได้");

    const body = await req.json();
    const input = CreateUserSchema.parse(body);
    const repo = getRepository();

    const existing = await repo.users.findByEmail(input.email);
    if (existing) return errorResponse("อีเมลนี้ถูกใช้งานในระบบแล้ว");

    if (input.pin) {
      const users = await repo.users.findAll();
      const duplicatePin = users.some((user) =>
        Boolean(user.pin_hash?.startsWith("$2")) && bcrypt.compareSync(input.pin!, user.pin_hash)
      );
      if (duplicatePin) return errorResponse("PIN นี้ถูกใช้งานแล้ว กรุณากำหนด PIN ที่ไม่ซ้ำกัน", 409);
    }

    const password_hash = bcrypt.hashSync(input.password, 10);
    const pin_hash = input.pin ? bcrypt.hashSync(input.pin, 10) : "";

    const newUser = await repo.users.create({
      full_name: input.full_name,
      email: input.email,
      password_hash,
      pin_hash,
      role: input.role,
      warehouse_access: input.warehouse_access || '[]',
      active: true,
    });

    return successResponse(
      { ...newUser, password_hash: undefined, pin_hash: undefined, has_pin: Boolean(newUser.pin_hash) },
      "เพิ่มพนักงานสำเร็จ",
      201
    );
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
