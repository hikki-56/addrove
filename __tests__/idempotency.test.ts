import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  computePayloadHash,
  failIdempotencyKey,
  IdempotencyConflictError,
  IdempotencyInProgressError,
} from "@/lib/idempotency";
import { InMemoryIdempotencyRepository } from "@/lib/repositories/in-memory/in-memory-stock.repository";

describe("Idempotency Service Integration Tests", () => {
  let repo: InMemoryIdempotencyRepository;

  beforeEach(() => {
    repo = new InMemoryIdempotencyRepository();
  });

  test("New key is successfully claimed as PROCESSING", async () => {
    const claim = await claimIdempotencyKey(
      repo,
      "key-001",
      "RECEIVE",
      "user-1",
      { qty: 10, sku: "A" }
    );
    expect(claim.isReplay).toBe(false);

    const record = await repo.findByKey("key-001");
    expect(record).not.toBeNull();
    expect(record?.status).toBe("PROCESSING");
  });

  test("Same key and same payload returns cached result upon completion without re-executing", async () => {
    const payload = { qty: 10, sku: "A" };
    await claimIdempotencyKey(repo, "key-002", "RECEIVE", "user-1", payload);

    const mockResponse = { document_id: "doc-123", status: "POSTED" };
    await completeIdempotencyKey(repo, "key-002", mockResponse);

    const replayClaim = await claimIdempotencyKey<typeof mockResponse>(
      repo,
      "key-002",
      "RECEIVE",
      "user-1",
      payload
    );

    expect(replayClaim.isReplay).toBe(true);
    expect(replayClaim.cachedResult).toEqual(mockResponse);
  });

  test("Same key but different payload throws IdempotencyConflictError (409)", async () => {
    await claimIdempotencyKey(repo, "key-003", "RECEIVE", "user-1", { qty: 10 });
    await completeIdempotencyKey(repo, "key-003", { ok: true });

    await expect(
      claimIdempotencyKey(repo, "key-003", "RECEIVE", "user-1", { qty: 999 })
    ).rejects.toThrow(IdempotencyConflictError);
  });

  test("Concurrent request with same key in PROCESSING throws IdempotencyInProgressError", async () => {
    await claimIdempotencyKey(repo, "key-004", "RECEIVE", "user-1", { qty: 10 });

    await expect(
      claimIdempotencyKey(repo, "key-004", "RECEIVE", "user-1", { qty: 10 })
    ).rejects.toThrow(IdempotencyInProgressError);
  });

  test("Failed idempotency key can record error message", async () => {
    await claimIdempotencyKey(repo, "key-005", "RECEIVE", "user-1", { qty: 10 });
    await failIdempotencyKey(repo, "key-005", "Insufficient stock");

    const record = await repo.findByKey("key-005");
    expect(record?.status).toBe("FAILED");
    expect(record?.error_message).toBe("Insufficient stock");
  });

  test("Stale PROCESSING record (crashed attempt) is reclaimed instead of throwing forever", async () => {
    await claimIdempotencyKey(repo, "key-006", "RECEIVE", "user-1", { qty: 10 });

    // จำลองรอบก่อนตายกลางทาง (timeout/restart ก่อนจะเขียน COMPLETED/FAILED):
    // record ค้าง PROCESSING มานานเกิน 5 นาที
    const stored = (repo as any).records.get("key-006");
    stored.updated_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const reclaim = await claimIdempotencyKey(repo, "key-006", "RECEIVE", "user-1", { qty: 10 });
    expect(reclaim.isReplay).toBe(false);

    const record = await repo.findByKey("key-006");
    expect(record?.status).toBe("PROCESSING");
    expect(record?.error_message).toBe("");
  });

  test("Stale PROCESSING reclaim adopts the new payload hash", async () => {
    await claimIdempotencyKey(repo, "key-007", "RECEIVE", "user-1", { qty: 10 });
    const stored = (repo as any).records.get("key-007");
    stored.updated_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const newPayload = { qty: 20 };
    await claimIdempotencyKey(repo, "key-007", "RECEIVE", "user-1", newPayload);

    const record = await repo.findByKey("key-007");
    expect(record?.payload_hash).toBe(computePayloadHash(newPayload));
  });
});
