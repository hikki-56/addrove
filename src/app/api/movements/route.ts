import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { MovementFilterSchema } from "@/types/api";
import {
  successResponse, unauthorizedResponse, serverErrorResponse,
} from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const rawFilters = Object.fromEntries(searchParams.entries());
    const filters = MovementFilterSchema.parse(rawFilters);
    const repo = getRepository();
    const result = await repo.movements.findAll(filters);
    return successResponse(result, "โหลดประวัติสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}
