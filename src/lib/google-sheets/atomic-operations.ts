/**
 * Atomic Stock Operations via Apps Script Distributed Lock
 *
 * Bundles an entire stock transaction (idempotency check + mutations +
 * summary updates + document status changes) into a single signed
 * request to the Apps Script Web App.
 *
 * The Apps Script executes all steps within a LockService lock, ensuring
 * mutual exclusion across ALL Vercel serverless instances.
 */
import { sendSignedAppsScriptRequest } from "./script-signer";
import { clearSheetCache } from "./client";

// ---- Types ----

export interface AtomicStep {
  action: "append" | "update" | "updateStatus" | "checkBalance";
  sheetName: string;
  values?: (string | number | boolean)[][];
  rowNumber?: number;
  /** For updateStatus */
  documentId?: string;
  newStatus?: string;
  statusColumnIndex?: number;
  /** For checkBalance */
  productId?: string;
  warehouseId?: string;
  locationId?: string;
  minRequired?: number;
}

export interface AtomicStockRequest {
  operationType: string;
  idempotencyKey: string;
  actorId: string;
  steps: AtomicStep[];
}

export interface AtomicStockResult {
  success: boolean;
  isReplay: boolean;
  result?: unknown;
  error?: string;
  message?: string;
  journalId?: string;
}

// ---- Execution ----

/**
 * Send a signed atomic stock operation request to the Apps Script.
 *
 * The Apps Script will:
 * 1. Acquire LockService lock
 * 2. Check idempotency key
 * 3. Execute all steps sequentially
 * 4. Record completion / failure
 * 5. Release lock
 */
export async function executeAtomicStockOperation(
  request: AtomicStockRequest
): Promise<AtomicStockResult> {
  const payload = {
    action: "atomicStockOperation" as const,
    ...request,
  };

  const response = await sendSignedAppsScriptRequest(payload);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Atomic stock operation failed: HTTP ${response.status}`);
  }

  let result: AtomicStockResult;
  try {
    result = JSON.parse(text) as AtomicStockResult;
  } catch {
    throw new Error(
      `Atomic stock operation returned invalid JSON: ${text.slice(0, 200)}`
    );
  }

  // Clear relevant caches for any sheets that were mutated
  const sheetsToInvalidate = new Set<string>();
  for (const step of request.steps) {
    if (step.sheetName) {
      sheetsToInvalidate.add(step.sheetName);
    }
  }
  for (const sheet of sheetsToInvalidate) {
    clearSheetCache(sheet);
  }

  // If the operation was a replay, return the cached result
  if (result.isReplay) {
    return result;
  }

  // If the operation failed, throw
  if (!result.success) {
    throw new Error(
      result.error || result.message || "Atomic stock operation failed"
    );
  }

  return result;
}
