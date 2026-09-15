import { AsyncLocalStorage } from "async_hooks";

const lockTails = new Map<string, Promise<void>>();

/**
 * ชุด key ที่ async context ปัจจุบันถืออยู่ — ทำให้ withKeyedLock เป็น re-entrant:
 * การเรียกซ้อนด้วย key เดิมใน chain เดียวกัน (เช่น mutateBillNote ล็อก "sheet-doc-row:doc-x"
 * แล้วเรียก repo.updateDoc ที่ล็อก key เดิมอีกชั้น) จะผ่านได้ทันทีโดยไม่รอตัวเอง
 * (ก่อนหน้านี้การซ้อน key เดิมคือ deadlock — request ค้างตลอดไป)
 */
const heldKeys = new AsyncLocalStorage<Set<string>>();

/**
 * Serializes operations with the same key inside one Node.js process.
 * Cross-instance atomicity must still be provided by the persistent store.
 *
 * Re-entrant: ถ้า async context ที่เรียกอยู่ถือ key นี้แล้ว (จาก withKeyedLock ชั้นนอก)
 * ให้รัน operation ต่อเลย — lock ตัวจริงถูกปล่อยโดยชั้นนอกสุดเท่านั้น
 */
export async function withKeyedLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const store = heldKeys.getStore();
  if (store && store.has(key)) {
    return operation();
  }

  const previous = lockTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  lockTails.set(key, tail);

  await previous.catch(() => undefined);
  const nested = new Set(store ?? []);
  nested.add(key);
  try {
    return await heldKeys.run(nested, operation);
  } finally {
    release();
    if (lockTails.get(key) === tail) {
      lockTails.delete(key);
    }
  }
}
