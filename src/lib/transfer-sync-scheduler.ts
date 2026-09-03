import { fetchAndSyncTransferNotifications } from "./transfer-notification-utils";

// Navbar, Sidebar, StaffDashboard และ hooks อื่น ๆ เคยตั้ง setInterval
// เรียก fetchAndSyncTransferNotifications ของตัวเอง (3-5 วินาทีต่อ component)
// ทำให้แต่ละแท็บยิง API ซ้ำกันหลายเท่า จนเดิมพัน Google Sheets quota
// — ทุก component ที่ต้องการข้อมูล transfer ควร subscribe ที่นี่แทน
// เพื่อให้หนึ่งแท็บมี timer และ request เดียวร่วมกัน
const SYNC_INTERVAL_MS = 30_000;

type SyncListener = () => void;

const globalForScheduler = globalThis as unknown as {
  __transferSyncListeners?: Set<SyncListener>;
  __transferSyncTimer?: ReturnType<typeof setInterval> | null;
};

const listeners = (globalForScheduler.__transferSyncListeners ??= new Set<SyncListener>());
let timer: ReturnType<typeof setInterval> | null = globalForScheduler.__transferSyncTimer ?? null;

function runSync(): void {
  void fetchAndSyncTransferNotifications()
    .catch(() => {})
    .finally(() => {
      for (const listener of Array.from(listeners)) {
        try {
          listener();
        } catch {}
      }
    });
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(runSync, SYNC_INTERVAL_MS);
  globalForScheduler.__transferSyncTimer = timer;
  runSync();
}

function stopTimerIfIdle(): void {
  if (listeners.size > 0 || !timer) return;
  clearInterval(timer);
  timer = null;
  globalForScheduler.__transferSyncTimer = null;
}

/**
 * Subscribe to the shared transfer sync. Returns an unsubscribe function
 * (ใช้ใน useEffect cleanup). Sync ครั้งแรกจะถูกเรียกทันทีเมื่อมี subscriber คนแรก
 * และทุก subscriber จะได้ callback หลัง sync แต่ละรอบเสร็จ
 */
export function subscribeTransferSync(listener: SyncListener): () => void {
  listeners.add(listener);
  ensureTimer();
  return () => {
    listeners.delete(listener);
    stopTimerIfIdle();
  };
}
