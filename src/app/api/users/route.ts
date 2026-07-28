import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
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

export async function GET() {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่จัดการพนักงานได้");

    const repo = getRepository();
    const users = await repo.users.findAll();

    // Sanitize password_hash before returning to client
    const safeUsers = users.map((u) => ({
      ...u,
      password_hash: undefined,
    }));

    return successResponse(safeUsers, "โหลดข้อมูลพนักงานสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่เพิ่มพนักงานได้");

    const body = await req.json();
    const input = CreateUserSchema.parse(body);
    const repo = getRepository();

    const existing = await repo.users.findByEmail(input.email);
    if (existing) return errorResponse("อีเมลนี้ถูกใช้งานในระบบแล้ว");

    const password_hash = bcrypt.hashSync(input.password, 10);

    const newUser = await repo.users.create({
      full_name: input.full_name,
      email: input.email,
      password_hash,
      role: input.role,
      warehouse_access: input.warehouse_access || '["*"]',
      active: true,
    });

    return successResponse(
      { ...newUser, password_hash: undefined },
      "เพิ่มพนักงานสำเร็จ",
      201
    );
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
