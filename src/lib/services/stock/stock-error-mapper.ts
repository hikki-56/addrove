import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { StockError } from "./stock-errors";

export interface StockErrorResponseBody {
  success: false;
  message: string;
  code?: string;
  errors?: Record<string, string[]>;
  details?: Record<string, unknown>;
}

/**
 * Maps domain errors from stock operations into appropriate Next.js responses.
 */
export function mapStockErrorToResponse(error: unknown): NextResponse<StockErrorResponseBody> {
  // 1. Zod validation error
  if (error instanceof ZodError) {
    const formattedErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "form";
      if (!formattedErrors[key]) formattedErrors[key] = [];
      formattedErrors[key].push(issue.message);
    }
    const firstErrorMessage =
      error.issues[0]?.message || "ข้อมูลที่ส่งมาไม่ถูกต้องตามรูปแบบ";

    return NextResponse.json(
      {
        success: false,
        message: firstErrorMessage,
        code: "STOCK_VALIDATION_ERROR",
        errors: formattedErrors,
      },
      { status: 400 }
    );
  }

  // 2. Domain StockError
  if (error instanceof StockError) {
    return NextResponse.json(
      {
        success: false,
        message: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.statusCode }
    );
  }

  // 3. Fallback generic error
  const message =
    error instanceof Error
      ? error.message
      : "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง";

  return NextResponse.json(
    {
      success: false,
      message,
      code: "INTERNAL_SERVER_ERROR",
    },
    { status: 500 }
  );
}
