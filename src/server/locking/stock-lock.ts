import { AsyncLocalStorage } from "async_hooks";
import { ILockProvider, defaultLockProvider, StockLockTimeoutError } from "./lock-provider";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";

export { StockLockTimeoutError };

export function formatStockLockKey(
  warehouseId: string,
  locationId = "any",
  productId = "any"
): string {
  // Canonicalize any warehouse id (wh-1, wh01, โกดัง1, ...) so that wh-1 and wh-01
  // always produce the same lock key — otherwise approve vs cancel/reverse fired
  // concurrently would lock different keys and stop excluding each other (BUG-C6).
  // normalizeWarehouseId returns wh-01..wh-06; compact the zero padding back to a
  // stable short canonical form (wh-1..wh-6) shared by every caller.
  const wh = warehouseId
    ? normalizeWarehouseId(warehouseId).replace(/^wh-0/, "wh-")
    : "wh";
  const loc = (locationId || "loc").trim().toLowerCase().replace(/^loc-/, "");
  const prod = (productId || "prod").trim().toLowerCase().replace(/^prod-/, "");
  return `warehouse:${wh}:location:${loc}:product:${prod}`;
}

export function sortLockKeys(keys: string[]): string[] {
  // Deduplicate and canonically sort keys to prevent deadlocks across concurrent multi-resource transactions
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  return uniqueKeys.sort((a, b) => a.localeCompare(b));
}

export interface StockLockOptions {
  provider?: ILockProvider;
  timeoutMs?: number;
}

// Re-entrancy context tracker via AsyncLocalStorage
const heldLocksStore = new AsyncLocalStorage<Set<string>>();

export async function withStockLocks<T>(
  rawKeys: string | string[],
  action: () => Promise<T>,
  options: StockLockOptions = {}
): Promise<T> {
  const provider = options.provider || defaultLockProvider;
  const timeoutMs = options.timeoutMs ?? 10000;

  const keyList = Array.isArray(rawKeys) ? rawKeys : [rawKeys];
  const sortedKeys = sortLockKeys(keyList);

  // Check currently held locks in this async execution context
  const currentlyHeld = heldLocksStore.getStore() || new Set<string>();
  const unheldKeys = sortedKeys.filter((key) => !currentlyHeld.has(key));

  if (unheldKeys.length === 0) {
    return await action();
  }

  const releases: Array<() => void> = [];
  const nextHeld = new Set(currentlyHeld);

  try {
    // Acquire only unheld locks in strictly ascending canonical order
    for (const key of unheldKeys) {
      const release = await provider.acquire(key, timeoutMs);
      releases.push(release);
      nextHeld.add(key);
    }

    return await heldLocksStore.run(nextHeld, action);
  } finally {
    // Always release acquired locks in reverse order in finally block
    for (let i = releases.length - 1; i >= 0; i--) {
      try {
        releases[i]();
      } catch (err) {
        console.error("[withStockLocks] Error releasing lock:", err);
      }
    }
  }
}
