import { fetchAndSyncTransferNotifications } from "./transfer-notification-utils";

// Navbar, Sidebar, StaffDashboard และ hooks อื่น ๆ เคยตั้ง setInterval
// เรียก fetchAndSyncTransferNotifications ของตัวเอง (3-5 วินาทีต่อ component)
// ทำให้แต่ละแท็บยิง API ซ้ำกันหลายเท่า จนเดิมพัน Google Sheets quota
// — ทุก component ที่ต้องการข้อมูล transfer ควร subscribe ที่นี่แทน
// เพื่อให้หนึ่งแท็บมี timer และ request เดียวร่วมกัน
// และหยุด interval ชั่วคราวระหว่างที่แท็บถูกซ่อน เพื่อไม่ให้แท็บที่ไม่ได้ดูกิน CPU/เครือข่าย
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

function stopTimer(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  globalForScheduler.__transferSyncTimer = null;
}

function startTimer(): void {
  if (timer) return;
  if (typeof document !== "undefined" && document.hidden) {
    // แท็บถูกซ่อน — sync รอบแรกครั้งเดียวแต่ไม่ตั้ง interval รอ visibilitychange ปลุก
    runSync();
    return;
  }
  timer = setInterval(runSync, SYNC_INTERVAL_MS);
  globalForScheduler.__transferSyncTimer = timer;
  runSync();
}

function onVisibilityChange(): void {
  if (typeof document === "undefined") return;
  if (document.hidden) {
    stopTimer();
  } else if (listeners.size > 0) {
    startTimer(); // กลับมาที่แท็บ — sync ข้อมูลล่าสุดทันทีแล้วเริ่มรอบใหม่
  }
}

function ensureTimer(): void {
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  startTimer();
}

function stopTimerIfIdle(): void {
  if (listeners.size > 0) return;
  stopTimer();
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
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
