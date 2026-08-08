const lockTails = new Map<string, Promise<void>>();

/**
 * Serializes operations with the same key inside one Node.js process.
 * Cross-instance atomicity must still be provided by the persistent store.
 */
export async function withKeyedLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = lockTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  lockTails.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (lockTails.get(key) === tail) {
      lockTails.delete(key);
    }
  }
}
