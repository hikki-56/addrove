import { mapStockErrorToResponse } from "@/lib/services/stock/stock-error-mapper";
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
} from "@/lib/idempotency";

describe("mapStockErrorToResponse — idempotency errors", () => {
  test("IdempotencyInProgressError maps to 409 with the real message, not the generic 500", async () => {
    const res = mapStockErrorToResponse(
      new IdempotencyInProgressError("คำสั่ง " + "x" + " กำลังประมวลผลอยู่ กรุณารอสักครู่")
    );
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("กำลังประมวลผลอยู่");
    expect(body.message).not.toContain("ไม่สามารถบันทึกข้อมูลลงระบบได้");
  });

  test("IdempotencyConflictError maps to 409", async () => {
    const res = mapStockErrorToResponse(new IdempotencyConflictError());
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("STOCK_CONFLICT");
  });

  test("Unknown errors still fall back to the generic 500 message", async () => {
    const res = mapStockErrorToResponse(new Error("secret infra detail"));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.message).toBe("ไม่สามารถบันทึกข้อมูลลงระบบได้ กรุณาลองอีกครั้ง");
    expect(body.message).not.toContain("secret infra detail");
  });
});
