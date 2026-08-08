import {
  withStockLocks,
  formatStockLockKey,
  sortLockKeys,
  StockLockTimeoutError,
  InMemoryLockProvider,
} from "@/lib/locking";

describe("Stock Locking & Deadlock Prevention Tests", () => {
  test("sortLockKeys canonically sorts keys to avoid deadlocks across multiple resources", () => {
    const keysA = [
      formatStockLockKey("wh-2", "loc-B", "prod-1"),
      formatStockLockKey("wh-1", "loc-A", "prod-1"),
    ];
    const keysB = [
      formatStockLockKey("wh-1", "loc-A", "prod-1"),
      formatStockLockKey("wh-2", "loc-B", "prod-1"),
    ];

    const sortedA = sortLockKeys(keysA);
    const sortedB = sortLockKeys(keysB);

    expect(sortedA).toEqual(sortedB);
    expect(sortedA[0]).toContain("wh-1");
    expect(sortedA[1]).toContain("wh-2");
  });

  test("Lock timeout throws StockLockTimeoutError when lock cannot be acquired in time", async () => {
    const lockProvider = new InMemoryLockProvider();
    const lockKey = formatStockLockKey("wh-1", "loc-A", "prod-1");

    // Hold lock manually
    const release = await lockProvider.acquire(lockKey, 5000);

    // Attempt to acquire with very short timeout
    await expect(
      withStockLocks(lockKey, async () => "result", { provider: lockProvider, timeoutMs: 50 })
    ).rejects.toThrow(StockLockTimeoutError);

    release();
  });

  test("Concurrent actions on same lock key run sequentially without race conditions", async () => {
    const lockProvider = new InMemoryLockProvider();
    const lockKey = formatStockLockKey("wh-1", "loc-A", "prod-1");

    let counter = 0;
    const executionOrder: number[] = [];

    const action = async (id: number, delayMs: number) => {
      return withStockLocks(
        lockKey,
        async () => {
          const current = counter;
          await new Promise((r) => setTimeout(r, delayMs));
          counter = current + 1;
          executionOrder.push(id);
          return counter;
        },
        { provider: lockProvider }
      );
    };

    // Trigger concurrent mutations simultaneously
    await Promise.all([
      action(1, 40),
      action(2, 20),
      action(3, 10),
    ]);

    expect(counter).toBe(3);
    expect(executionOrder.length).toBe(3);
  });
});
