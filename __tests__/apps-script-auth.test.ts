/**
 * Comprehensive tests for Apps Script HMAC-SHA256 authentication.
 *
 * Uses the verification helpers from script-signer.ts to simulate
 * what the Google Apps Script would do, without needing the GAS runtime.
 */
import {
  createSignedEnvelope,
  verifySignedEnvelope,
  getSigningSecret,
  validateActionAndSheet,
  validateMutationPayload,
  timingSafeEqual,
  type SignedEnvelope,
} from "@/lib/google-sheets/script-signer";
import { createHmac, randomUUID } from "crypto";

describe("Apps Script Authentication", () => {
  const MOCK_SECRET =
    "super-secret-key-that-is-at-least-32-chars-long!!";
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.GOOGLE_SCRIPT_SIGNING_SECRET = MOCK_SECRET;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  // ---- Signing & Verification ----

  test("1. valid signature — envelope passes verification", () => {
    const payload = { action: "ping" };
    const envelope = createSignedEnvelope(payload);

    expect(envelope.timestamp).toBeGreaterThan(0);
    expect(envelope.nonce).toBeDefined();
    expect(envelope.payload).toBe(JSON.stringify(payload));
    expect(envelope.signature).toHaveLength(64); // hex SHA-256

    const seenNonces = new Set<string>();
    const parsed = verifySignedEnvelope(
      envelope,
      MOCK_SECRET,
      seenNonces
    ) as Record<string, unknown>;
    expect(parsed.action).toBe("ping");
  });

  test("2. missing signature — rejected", () => {
    const envelope = createSignedEnvelope({ action: "ping" });
    const tampered: SignedEnvelope = { ...envelope, signature: "" };

    expect(() =>
      verifySignedEnvelope(tampered, MOCK_SECRET)
    ).toThrow("HMAC_MISSING");
  });

  test("3. tampered payload — rejected", () => {
    const envelope = createSignedEnvelope({ action: "ping" });
    // Modify payload after signing
    const tampered: SignedEnvelope = {
      ...envelope,
      payload: JSON.stringify({ action: "deleteRow", sheetName: "Users", rowNumber: 1 }),
    };

    expect(() =>
      verifySignedEnvelope(tampered, MOCK_SECRET)
    ).toThrow("HMAC_INVALID");
  });

  test("4. expired timestamp — rejected", () => {
    // Create a valid envelope but backdate the timestamp
    const payload = { action: "ping" };
    const payloadStr = JSON.stringify(payload);
    const nonce = randomUUID();
    const oldTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    const message = `${oldTimestamp}.${nonce}.${payloadStr}`;
    const signature = createHmac("sha256", MOCK_SECRET)
      .update(message)
      .digest("hex");

    const expired: SignedEnvelope = {
      timestamp: oldTimestamp,
      nonce,
      payload: payloadStr,
      signature,
    };

    expect(() =>
      verifySignedEnvelope(expired, MOCK_SECRET)
    ).toThrow("HMAC_EXPIRED");
  });

  test("5. replayed nonce — rejected on second use", () => {
    const envelope = createSignedEnvelope({ action: "ping" });
    const seenNonces = new Set<string>();

    // First verification succeeds
    verifySignedEnvelope(envelope, MOCK_SECRET, seenNonces);
    expect(seenNonces.has(envelope.nonce)).toBe(true);

    // Second verification with same nonce fails
    expect(() =>
      verifySignedEnvelope(envelope, MOCK_SECRET, seenNonces)
    ).toThrow("HMAC_REPLAY");
  });

  test("6. unknown action — rejected by allowlist", () => {
    expect(() =>
      validateActionAndSheet("dropAllTables")
    ).toThrow("ACTION_DENIED");
  });

  test("7. unknown sheet name — rejected by allowlist", () => {
    expect(() =>
      validateActionAndSheet("append", "HackerSheet")
    ).toThrow("SHEET_DENIED");
  });

  test("7b. known sheet names pass allowlist", () => {
    expect(() =>
      validateActionAndSheet("append", "Documents")
    ).not.toThrow();
    expect(() =>
      validateActionAndSheet("append", "StockMovements")
    ).not.toThrow();
    expect(() =>
      validateActionAndSheet("append", "โกดัง1")
    ).not.toThrow();
    expect(() =>
      validateActionAndSheet("ping") // no sheetName needed
    ).not.toThrow();
  });

  test("8. invalid row/delete request — rowNumber < 2 rejected", () => {
    expect(() =>
      validateMutationPayload({
        action: "deleteRow",
        sheetName: "Documents",
        rowNumber: 1,
      })
    ).toThrow("VALIDATION: deleteRow rowNumber must be >= 2");

    expect(() =>
      validateMutationPayload({
        action: "update",
        sheetName: "Documents",
        rowNumber: 0,
        values: ["a"],
      })
    ).toThrow("VALIDATION: update rowNumber must be >= 2");
  });

  test("8b. valid update/delete requests pass validation", () => {
    expect(() =>
      validateMutationPayload({
        action: "update",
        sheetName: "Documents",
        rowNumber: 2,
        values: ["a", "b", "c"],
      })
    ).not.toThrow();

    expect(() =>
      validateMutationPayload({
        action: "deleteRow",
        sheetName: "Documents",
        rowNumber: 5,
      })
    ).not.toThrow();
  });

  // ---- Append validation ----

  test("append with empty values rejected", () => {
    expect(() =>
      validateMutationPayload({
        action: "append",
        sheetName: "Documents",
        values: [],
      })
    ).toThrow("VALIDATION: append requires non-empty values array");
  });

  test("append with too many rows rejected", () => {
    const rows = Array.from({ length: 101 }, () => ["a"]);
    expect(() =>
      validateMutationPayload({
        action: "append",
        sheetName: "Documents",
        values: rows,
      })
    ).toThrow("VALIDATION: append max 100 rows");
  });

  test("append with too many columns rejected", () => {
    const row = Array.from({ length: 31 }, () => "x");
    expect(() =>
      validateMutationPayload({
        action: "append",
        sheetName: "Documents",
        values: [row],
      })
    ).toThrow("VALIDATION: each row must be an array with max 30 columns");
  });

  // ---- Signing secret ----

  test("getSigningSecret throws when env var is missing", () => {
    delete process.env.GOOGLE_SCRIPT_SIGNING_SECRET;
    expect(() => getSigningSecret()).toThrow(
      "GOOGLE_SCRIPT_SIGNING_SECRET is required"
    );
  });

  // ---- Timing-safe comparison ----

  test("timingSafeEqual returns true for identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  test("timingSafeEqual returns false for different strings", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("abc", "")).toBe(false);
  });

  // ---- Wrong secret ----

  test("signature signed with wrong secret is rejected", () => {
    const envelope = createSignedEnvelope({ action: "ping" });
    expect(() =>
      verifySignedEnvelope(envelope, "wrong-secret-that-is-32-chars-long!!!")
    ).toThrow("HMAC_INVALID");
  });
});
