import {
  acquireIdempotencyKey,
  releaseIdempotencyKey,
  peekPendingKeys,
  sendWithIdempotency,
  hashPayload,
  canonicalPayload,
} from "@/features/production/lib/idempotency";

/** sessionStorage ปลอมแบบ in-memory เพื่อจำลองการรีเฟรช (ล้าง module แล้วโหลดใหม่ แต่ storage ยังอยู่) */
class FakeStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const storage = new FakeStorage();
beforeAll(() => {
  (globalThis as { window?: unknown }).window = { sessionStorage: storage };
});
afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});
beforeEach(() => storage.clear());

const report = (jobNo: string, round: number, good: number, defect = 0) => ({
  action: "report" as const,
  jobNo,
  round,
  payload: { good_qty: good, defect_qty: defect, defect_cause: "", note: "", report_kind: "PARTIAL", close_reason: "" },
});

describe("payload hash", () => {
  it("ignores key order, idempotency_key, updated_at and surrounding spaces", () => {
    expect(hashPayload({ a: 1, b: " x " })).toBe(hashPayload({ b: "x", a: 1, idempotency_key: "k", updated_at: "t" }));
    expect(canonicalPayload({ b: 1, a: { d: 2, c: 1 } })).toBe('{"a":{"c":1,"d":2},"b":1}');
  });
  it("changes when the numbers change", () => {
    expect(hashPayload({ good_qty: 600 })).not.toBe(hashPayload({ good_qty: 601 }));
  });
});

describe("acquireIdempotencyKey", () => {
  it("reuses the key for the same intent and survives a module reload (refresh)", () => {
    const k1 = acquireIdempotencyKey(report("PRD-1", 1, 600, 20));
    expect(acquireIdempotencyKey(report("PRD-1", 1, 600, 20))).toBe(k1);
    let reloaded: typeof import("@/features/production/lib/idempotency") | undefined;
    jest.isolateModules(() => {
      reloaded = jest.requireActual<typeof import("@/features/production/lib/idempotency")>(
        "@/features/production/lib/idempotency",
      );
    });
    expect(reloaded!.acquireIdempotencyKey(report("PRD-1", 1, 600, 20))).toBe(k1);
    expect(storage.length).toBe(1);
  });

  it("creates a new key when the user changes the numbers, dropping the stale one", () => {
    const k1 = acquireIdempotencyKey(report("PRD-1", 1, 600));
    const k2 = acquireIdempotencyKey(report("PRD-1", 1, 610));
    expect(k2).not.toBe(k1);
    expect(peekPendingKeys("report", "PRD-1")).toEqual([k2]);
  });

  it("reuses a pending key with the same payload even after the round moved (lost response)", () => {
    const k1 = acquireIdempotencyKey(report("PRD-1", 1, 600));
    expect(acquireIdempotencyKey(report("PRD-1", 2, 600))).toBe(k1);
  });

  it("keeps jobs and actions separate", () => {
    const a = acquireIdempotencyKey(report("PRD-1", 1, 600));
    const b = acquireIdempotencyKey(report("PRD-2", 1, 600));
    const c = acquireIdempotencyKey({ ...report("PRD-1", 1, 600), action: "adjust" });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("expires very old pending keys", () => {
    const k1 = acquireIdempotencyKey(report("PRD-1", 1, 600), 0);
    expect(acquireIdempotencyKey(report("PRD-1", 1, 600), 25 * 60 * 60 * 1000)).not.toBe(k1);
  });

  it("release removes only that key", () => {
    const k1 = acquireIdempotencyKey(report("PRD-1", 1, 600));
    const k2 = acquireIdempotencyKey(report("PRD-2", 1, 600));
    releaseIdempotencyKey("report", "PRD-1", k1);
    expect(peekPendingKeys("report", "PRD-1")).toEqual([]);
    expect(peekPendingKeys("report", "PRD-2")).toEqual([k2]);
  });
});

describe("sendWithIdempotency", () => {
  it("keeps the key on a retryable failure, reuses it, then clears on success", async () => {
    const seen: string[] = [];
    const r1 = await sendWithIdempotency(report("PRD-9", 1, 5), async (key) => {
      seen.push(key);
      return { success: false, message: "net", status: 0 };
    });
    expect(r1.success).toBe(false);
    expect(peekPendingKeys("report", "PRD-9")).toEqual([seen[0]]);

    await sendWithIdempotency(report("PRD-9", 1, 5), async (key) => {
      seen.push(key);
      return { success: true, message: "ok", status: 200 };
    });
    expect(seen[1]).toBe(seen[0]);
    expect(peekPendingKeys("report", "PRD-9")).toEqual([]);
  });

  it("keeps the key on IDEMPOTENCY_IN_PROGRESS and clears on a non-retryable 409/400", async () => {
    await sendWithIdempotency(report("PRD-8", 1, 5), async () => ({
      success: false,
      message: "busy",
      status: 409,
      code: "IDEMPOTENCY_IN_PROGRESS",
    }));
    expect(peekPendingKeys("report", "PRD-8")).toHaveLength(1);
    await sendWithIdempotency(report("PRD-8", 1, 5), async () => ({ success: false, message: "x", status: 409 }));
    expect(peekPendingKeys("report", "PRD-8")).toEqual([]);
    await sendWithIdempotency(report("PRD-8", 1, 5), async () => ({ success: false, message: "x", status: 400 }));
    expect(peekPendingKeys("report", "PRD-8")).toEqual([]);
  });
});
