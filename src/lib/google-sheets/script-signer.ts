/**
 * HMAC-SHA256 Signed Envelope for Google Apps Script Mutations
 *
 * Every mutation sent to the Apps Script Web App is wrapped in a signed
 * envelope so that the script can verify authenticity, prevent replay
 * attacks and reject tampered payloads.
 *
 * The signing secret is a server-only environment variable that is NEVER
 * sent with the request.  The same secret must be stored in the Apps
 * Script's Script Properties under the key `SIGNING_SECRET`.
 */
import { createHmac, randomUUID } from "crypto";

// ---- Types ----

export interface SignedEnvelope {
  timestamp: number;
  nonce: string;
  payload: string;
  signature: string;
}

// ---- Signing Secret ----

export function getSigningSecret(): string {
  const secret = process.env.GOOGLE_SCRIPT_SIGNING_SECRET;
  if (!secret) {
    throw new Error(
      "GOOGLE_SCRIPT_SIGNING_SECRET is required for Apps Script mutations"
    );
  }
  return secret;
}

// ---- Envelope Construction ----

/**
 * Build a signed envelope from an arbitrary JSON-serialisable payload.
 *
 * The canonical message that is signed is:
 *   `${timestamp}.${nonce}.${payloadString}`
 */
export function createSignedEnvelope(payload: object): SignedEnvelope {
  const secret = getSigningSecret();
  const timestamp = Date.now();
  const nonce = randomUUID();
  const payloadStr = JSON.stringify(payload);
  const message = `${timestamp}.${nonce}.${payloadStr}`;
  const signature = createHmac("sha256", secret).update(message).digest("hex");

  return { timestamp, nonce, payload: payloadStr, signature };
}

// ---- Verification helpers (used in tests / local smoke checks) ----

/**
 * Verify a signed envelope.  Returns the parsed payload on success or
 * throws on any verification failure.
 *
 * @param maxAgeMs  Maximum age of the timestamp in milliseconds (default 5 min).
 */
export function verifySignedEnvelope(
  envelope: SignedEnvelope,
  secret: string,
  seenNonces?: Set<string>,
  maxAgeMs = 5 * 60 * 1000
): object {
  if (
    !envelope.signature ||
    !envelope.payload ||
    !envelope.nonce ||
    !envelope.timestamp
  ) {
    throw new Error("HMAC_MISSING: Missing required envelope fields");
  }

  // Timestamp freshness
  const age = Date.now() - envelope.timestamp;
  if (age > maxAgeMs || age < -30_000) {
    throw new Error("HMAC_EXPIRED: Timestamp outside acceptable window");
  }

  // Replay protection
  if (seenNonces?.has(envelope.nonce)) {
    throw new Error("HMAC_REPLAY: Nonce already used");
  }

  // Compute expected signature
  const message = `${envelope.timestamp}.${envelope.nonce}.${envelope.payload}`;
  const expected = createHmac("sha256", secret).update(message).digest("hex");

  // Timing-safe comparison
  if (!timingSafeEqual(envelope.signature, expected)) {
    throw new Error("HMAC_INVALID: Signature mismatch");
  }

  // Record nonce
  seenNonces?.add(envelope.nonce);

  return JSON.parse(envelope.payload) as object;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate to avoid length-based timing leaks
    let dummy = 0;
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      dummy |=
        (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
    }
    void dummy;
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---- Allowlists ----

export const ALLOWED_ACTIONS = [
  "ping",
  "append",
  "update",
  "deleteRow",
  "atomicStockOperation",
] as const;

export const ALLOWED_SHEETS = [
  "Warehouses",
  "Locations",
  "Shelves",
  "PRODUCTS",
  "Documents",
  "StockMovements",
  "StockSummary",
  "StockCounts",
  "Users",
  "ประวัติการเข้าระบบ",
  "Idempotency",
  "AuditLog",
  "OperationJournal",
  "โกดัง1",
  "โกดัง2",
  "โกดัง3",
  "โกดัง4",
  "โกดัง5",
] as const;

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];
export type AllowedSheet = (typeof ALLOWED_SHEETS)[number];

/**
 * Validate that the action and sheet name are in the allowlist.
 */
export function validateActionAndSheet(
  action: string,
  sheetName?: string
): void {
  if (!(ALLOWED_ACTIONS as readonly string[]).includes(action)) {
    throw new Error(`ACTION_DENIED: Unknown action "${action}"`);
  }
  if (
    sheetName &&
    action !== "ping" &&
    !(ALLOWED_SHEETS as readonly string[]).includes(sheetName)
  ) {
    throw new Error(`SHEET_DENIED: Unknown sheet "${sheetName}"`);
  }
}

/**
 * Validate mutation payload constraints.
 */
export function validateMutationPayload(
  parsed: Record<string, unknown>
): void {
  const action = parsed.action as string;

  if (action === "append") {
    const values = parsed.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("VALIDATION: append requires non-empty values array");
    }
    if (values.length > 100) {
      throw new Error("VALIDATION: append max 100 rows per request");
    }
    for (const row of values) {
      if (!Array.isArray(row) || row.length > 30) {
        throw new Error(
          "VALIDATION: each row must be an array with max 30 columns"
        );
      }
    }
  }

  if (action === "update") {
    const rowNumber = Number(parsed.rowNumber);
    if (!rowNumber || rowNumber < 2) {
      throw new Error(
        "VALIDATION: update rowNumber must be >= 2 (cannot update header)"
      );
    }
    const values = parsed.values;
    if (!Array.isArray(values) || values.length > 30) {
      throw new Error(
        "VALIDATION: update values must be an array with max 30 columns"
      );
    }
  }

  if (action === "deleteRow") {
    const rowNumber = Number(parsed.rowNumber);
    if (!rowNumber || rowNumber < 2) {
      throw new Error(
        "VALIDATION: deleteRow rowNumber must be >= 2 (cannot delete header)"
      );
    }
  }
}

/**
 * Helper for the client — send a signed request to Apps Script.
 *
 * This is the single funnel for all mutation traffic to the Apps Script
 * Web App.  It constructs the envelope, POSTs it, and returns the raw
 * Response so the caller can handle the result.
 */
export async function sendSignedAppsScriptRequest(
  payload: object
): Promise<Response> {
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  if (!scriptUrl) {
    throw new Error(
      "GOOGLE_SCRIPT_URL is required for Apps Script operations"
    );
  }

  const envelope = createSignedEnvelope(payload);

  return fetch(scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(envelope),
    redirect: "follow",
    cache: "no-store",
  });
}
