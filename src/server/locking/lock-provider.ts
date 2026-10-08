export class StockLockTimeoutError extends Error {
  constructor(message = "ไม่สามารถขอ Lock ทรัพยากรสต็อกได้ทันเวลา (Lock Acquisition Timeout)") {
    super(message);
    this.name = "StockLockTimeoutError";
  }
}

export interface ILockProvider {
  acquire(key: string, timeoutMs?: number): Promise<() => void>;
  isLocked(key: string): boolean;
}

/**
 * InMemoryLockProvider
 * Provides in-process FIFO locking per resource key.
 *
 * NOTE & BOUNDARY DISCLAIMER:
 * This provider guarantees mutual exclusion across all async requests within the SAME Node.js process / server instance.
 * For horizontally-scaled multi-instance cluster deployments, provide an ILockProvider backed by Redis (e.g. Redlock)
 * or a database advisory lock without changing any service or use case code.
 */
const globalForLocks = globalThis as unknown as {
  inMemoryLockQueues?: Map<string, Array<() => void>>;
};
if (!globalForLocks.inMemoryLockQueues) {
  globalForLocks.inMemoryLockQueues = new Map<string, Array<() => void>>();
}

export class InMemoryLockProvider implements ILockProvider {
  private get lockQueues(): Map<string, Array<() => void>> {
    return globalForLocks.inMemoryLockQueues!;
  }

  isLocked(key: string): boolean {
    const queue = this.lockQueues.get(key);
    return Boolean(queue && queue.length > 0);
  }

  async acquire(key: string, timeoutMs = 25000): Promise<() => void> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const acquirePromise = new Promise<() => void>((resolve, reject) => {
      let isSettled = false;

      const release = () => {
        if (timer) clearTimeout(timer);
        const queue = this.lockQueues.get(key);
        if (!queue) return;
        queue.shift();
        if (queue.length > 0) {
          queue[0]();
        } else {
          this.lockQueues.delete(key);
        }
      };

      const grant = () => {
        if (isSettled) return;
        isSettled = true;
        if (timer) clearTimeout(timer);
        resolve(release);
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (isSettled) return;
          isSettled = true;
          const queue = this.lockQueues.get(key);
          if (queue) {
            const idx = queue.indexOf(grant);
            if (idx !== -1) queue.splice(idx, 1);
            if (queue.length === 0) this.lockQueues.delete(key);
          }
          reject(new StockLockTimeoutError(`Lock acquisition timed out for key: ${key}`));
        }, timeoutMs);
      }

      const existingQueue = this.lockQueues.get(key);
      if (!existingQueue) {
        this.lockQueues.set(key, [grant]);
        grant();
      } else {
        existingQueue.push(grant);
      }
    });

    return acquirePromise;
  }
}

// Global default lock provider singleton
export const defaultLockProvider: ILockProvider = new InMemoryLockProvider();
