import {
  productionApi,
  describeProductionError,
  isRetryableFailure,
  isConflict,
  newIdempotencyKey,
  PRODUCTION_API_MESSAGES,
} from "@/features/production/lib/api";

function mockFetchOnce(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === "__invalid__") throw new Error("bad json");
      return body;
    },
  });
  (globalThis as { fetch: unknown }).fetch = fn;
  return fn;
}

describe("productionApi", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  });

  it("returns success with data and status", async () => {
    const fn = mockFetchOnce(200, { success: true, message: "ok", data: { a: 1 } });
    const res = await productionApi<{ a: number }>("/api/x", "POST", { b: 2 });
    expect(res).toEqual({ success: true, message: "ok", data: { a: 1 }, status: 200 });
    const [, init] = fn.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ b: 2 }));
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("does not send a body or content-type for GET without body", async () => {
    const fn = mockFetchOnce(200, { success: true, data: [] });
    const res = await productionApi("/api/x");
    expect(res.success).toBe(true);
    expect(res.message).toBe(PRODUCTION_API_MESSAGES.success);
    expect(fn.mock.calls[0][1].body).toBeUndefined();
    expect(fn.mock.calls[0][1].headers).toBeUndefined();
  });

  it("maps 401 to a consistent Thai session message", async () => {
    mockFetchOnce(401, { success: false, message: "Unauthorized" });
    const res = await productionApi("/api/x", "POST", {});
    expect(res).toMatchObject({ success: false, status: 401, message: PRODUCTION_API_MESSAGES.unauthorized });
  });

  it("keeps the server message for 403", async () => {
    mockFetchOnce(403, { success: false, message: "คุณไม่มีสิทธิ์รายงานผล" });
    const res = await productionApi("/api/x", "POST", {});
    expect(res).toMatchObject({ success: false, status: 403, message: "คุณไม่มีสิทธิ์รายงานผล" });
  });

  it("adds a reload hint to 409 messages", async () => {
    mockFetchOnce(409, { success: false, message: "งานนี้เริ่มผลิตแล้ว" });
    const res = await productionApi("/api/x", "POST");
    expect(res.status).toBe(409);
    expect(isConflict(res)).toBe(true);
    expect(res.message).toContain("งานนี้เริ่มผลิตแล้ว");
    expect(res.message).toContain(PRODUCTION_API_MESSAGES.reloadHint);
  });

  it("does not duplicate the reload hint when the server already says รีเฟรช", async () => {
    mockFetchOnce(409, { success: false, message: "ข้อมูลงานถูกแก้ไขโดยผู้อื่นไปก่อนแล้ว กรุณารีเฟรชแล้วลองใหม่" });
    const res = await productionApi("/api/x", "PATCH", {});
    expect(res.message).toBe("ข้อมูลงานถูกแก้ไขโดยผู้อื่นไปก่อนแล้ว กรุณารีเฟรชแล้วลองใหม่");
  });

  it("returns status 0 on network failure", async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const res = await productionApi("/api/x", "POST", {});
    expect(res).toEqual({ success: false, message: PRODUCTION_API_MESSAGES.network, status: 0 });
  });

  it("treats invalid JSON as failure", async () => {
    mockFetchOnce(502, "__invalid__");
    const res = await productionApi("/api/x", "POST", {});
    expect(res).toMatchObject({ success: false, status: 502, message: PRODUCTION_API_MESSAGES.server });
    mockFetchOnce(200, "__invalid__");
    const res2 = await productionApi("/api/x", "POST", {});
    expect(res2.success).toBe(false);
  });
});

describe("describeProductionError / isRetryableFailure", () => {
  it("falls back to generic messages", () => {
    expect(describeProductionError(409)).toContain(PRODUCTION_API_MESSAGES.conflict);
    expect(describeProductionError(404)).toBe(PRODUCTION_API_MESSAGES.notFound);
    expect(describeProductionError(400, "กรุณาระบุเหตุผล")).toBe("กรุณาระบุเหตุผล");
    expect(describeProductionError(400)).toBe(PRODUCTION_API_MESSAGES.failed);
  });

  it("classifies retryable failures", () => {
    expect(isRetryableFailure({ success: false, status: 0 })).toBe(true);
    expect(isRetryableFailure({ success: false, status: 500 })).toBe(true);
    expect(isRetryableFailure({ success: false, status: 401 })).toBe(true);
    expect(isRetryableFailure({ success: false, status: 429 })).toBe(true);
    expect(isRetryableFailure({ success: false, status: 400 })).toBe(false);
    expect(isRetryableFailure({ success: false, status: 409 })).toBe(false);
    expect(isRetryableFailure({ success: true, status: 200 })).toBe(false);
  });
});

describe("newIdempotencyKey", () => {
  it("creates UUID v4 keys within server schema bounds (8–100 chars)", () => {
    const k = newIdempotencyKey();
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(k);
  });

  it("falls back to getRandomValues when randomUUID is missing", () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});

describe("productionApi code/errors passthrough", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  });

  it("exposes code and field errors when present", async () => {
    mockFetchOnce(400, {
      success: false,
      code: "DEFECT_CAUSE_REQUIRED",
      message: "มีของเสียต้องระบุสาเหตุของเสียทุกครั้ง",
      errors: [{ field: "defect_cause", message: "ต้องระบุ" }],
    });
    const res = await productionApi("/api/x", "POST", {});
    expect(res.code).toBe("DEFECT_CAUSE_REQUIRED");
    expect(res.errors).toEqual([{ field: "defect_cause", message: "ต้องระบุ" }]);
  });

  it("treats IDEMPOTENCY_IN_PROGRESS / VERSION_CONFLICT as retry-with-same-key", () => {
    expect(isRetryableFailure({ success: false, status: 409, code: "IDEMPOTENCY_IN_PROGRESS" })).toBe(true);
    expect(isRetryableFailure({ success: false, status: 409, code: "VERSION_CONFLICT" })).toBe(true);
    expect(isRetryableFailure({ success: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" })).toBe(false);
    expect(isRetryableFailure({ success: false, status: 409, code: "INVALID_TRANSITION" })).toBe(false);
  });
});
