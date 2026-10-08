jest.mock("@/lib/auth-session", () => ({
  getAuthSession: jest.fn(async () => ({ user: { id: "user-1" } })),
}));

jest.mock("@/lib/security", () => ({
  PERMISSIONS: { STOCK_RECEIVE: "STOCK_RECEIVE" },
  createActorFromSession: jest.fn(async () => ({
    id: "user-1",
    username: "tester",
    role: "WAREHOUSE_STAFF",
  })),
  authorize: jest.fn(),
}));

jest.mock("@/lib/repositories", () => ({
  getRepository: jest.fn(() => ({ repo: true })),
}));

const receiveStockMock = jest.fn();

jest.mock("@/lib/services/stock", () => {
  const actualReceive = jest.requireActual("@/lib/services/stock/receive-stock");
  const actualMapper = jest.requireActual("@/lib/services/stock/stock-error-mapper");
  return {
    ...actualReceive,
    ...actualMapper,
    receiveStock: (...args: unknown[]) => receiveStockMock(...args),
  };
});

import { POST } from "@/app/api/movements/receive/route";
import { StockValidationError } from "@/lib/services/stock/stock-errors";
import { IdempotencyInProgressError } from "@/lib/idempotency";

function receiveRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/movements/receive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      warehouse_id: "wh-1",
      document_date: "2026-10-02",
      idempotency_key: "idem-route-test",
      lines: [{ product_id: "prod-001", location_id: "A1", qty: 1 }],
      ...body,
    }),
  });
}

describe("POST /api/movements/receive error mapping", () => {
  beforeEach(() => {
    receiveStockMock.mockReset();
  });

  test("returns the real stock validation message instead of a generic system error", async () => {
    receiveStockMock.mockRejectedValueOnce(
      new StockValidationError("ไม่พบตำแหน่ง A99 ในโกดัง1 กรุณาตรวจสอบ QR ชั้นวางหรือเพิ่มตำแหน่งในระบบก่อน")
    );

    const res = await POST(receiveRequest({}) as any);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.message).toContain("ไม่พบตำแหน่ง A99");
    expect(body.message).not.toContain("เกิดข้อผิดพลาดภายในระบบ");
  });

  test("returns idempotency in-progress as a retryable conflict", async () => {
    receiveStockMock.mockRejectedValueOnce(
      new IdempotencyInProgressError("คำสั่ง idem-route-test กำลังประมวลผลอยู่ กรุณารอสักครู่")
    );

    const res = await POST(receiveRequest({}) as any);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.message).toContain("กำลังประมวลผลอยู่");
    expect(body.message).not.toContain("เกิดข้อผิดพลาดภายในระบบ");
  });

  test("keeps unknown infrastructure failures generic", async () => {
    receiveStockMock.mockRejectedValueOnce(new Error("Google Sheets quota secret detail"));

    const res = await POST(receiveRequest({}) as any);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.message).toBe("ไม่สามารถบันทึกข้อมูลลงระบบได้ กรุณาลองอีกครั้ง");
    expect(body.message).not.toContain("Google Sheets quota");
  });
});
