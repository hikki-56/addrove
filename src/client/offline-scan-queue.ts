"use client";

/**
 * Offline Scan Queue — คิวสแกนฝั่งมือถือ กัน Wi-Fi หลุดกลางโกดัง
 *
 * หลักการ:
 *  - สแกน → บันทึกลง localStorage ทันที → ผู้ใช้เห็น ✅/🟠 feedback ทันที
 *    แล้วส่ง API เบื้องหลัง (ออนไลน์อยู่ก็ส่งเลย)
 *  - เน็ตหลุด → รายการค้างในคิว แสดงป้าย "🟠 N รายการรอ Sync"
 *  - เน็ตกลับ → flush ส่งซ้ำด้วย idempotency key เดิมที่สร้างครั้งเดียว
 *    (กันรายการซ้ำ) — และระบบหลังบ้าตรวจซ้ำอีกชั้นจากสถานะจริง
 *    (เช่น "หยิบครบแล้ว"/"ขึ้นรถแล้ว" ถือเป็น replay สำเร็จ ไม่ใช่ error)
 *  - error ที่ไม่ใช่ network (สแกนผิดจริง) → ย้ายไปรายการล้มเหลว
 *    ให้หัวหน้าเห็นบนจอ ไม่ลบเงียบๆ
 */

const STORAGE_KEY = "stockify_offline_scan_queue_v1";
const FAILED_KEY = "stockify_offline_scan_failed_v1";
const MAX_FAILED = 30;

export interface QueuedScan {
  id: string;
  idempotency_key: string;
  url: string;
  method: string;
  body: Record<string, unknown>;
  label: string; // อธิบายสั้นๆ เช่น "หยิบ SKU001 ×5 (BIL-...)"
  created_at: string;
  attempts: number;
}

export interface FailedScan extends QueuedScan {
  error: string;
  failed_at: string;
}

function readAll<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as T[];
  } catch {
    return [];
  }
}

function writeAll<T>(key: string, items: T[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // เต็ม/ถูกปิด — คิวเป็น best-effort
  }
}

export function getPendingScans(): QueuedScan[] {
  return readAll<QueuedScan>(STORAGE_KEY);
}

export function getFailedScans(): FailedScan[] {
  return readAll<FailedScan>(FAILED_KEY);
}

export function clearFailedScans(): void {
  writeAll(FAILED_KEY, []);
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** idempotency key สร้างครั้งเดียวต่อการสแกน — retry ใช้ key เดิม */
function makeIdempotencyKey(): string {
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface EnqueueOptions {
  url: string;
  body: Record<string, unknown>;
  label: string;
  method?: string;
}

function tabTokenHeader(): Record<string, string> {
  if (typeof window !== "undefined" && (window as any).__tabToken) {
    return { "x-tab-token": (window as any).__tabToken };
  }
  return {};
}

/**
 * สแกน 1 รายการ — ลองส่งทันที ถ้า network ล้ม → เข้าคิวรอ sync
 * (ผู้เรียกควรให้ feedback ทันทีทั้งสองกรณี เพราะข้อมูลถูกบันทึกแล้วทั้งคู่)
 */
export async function queuedScan<T = Record<string, unknown>>(
  opts: EnqueueOptions
): Promise<{ status: "done"; data: T; message: string } | { status: "queued"; label: string }> {
  const entry: QueuedScan = {
    id: makeId(),
    idempotency_key: makeIdempotencyKey(),
    url: opts.url,
    method: opts.method ?? "POST",
    body: opts.body,
    label: opts.label,
    created_at: new Date().toISOString(),
    attempts: 0,
  };

  try {
    const res = await fetch(opts.url, {
      method: entry.method,
      headers: { "Content-Type": "application/json", ...tabTokenHeader() },
      body: JSON.stringify(opts.body),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({ success: false, message: "ตอบกลับไม่ใช่ JSON" }));
    if (!res.ok || json?.success === false) {
      // error จาก server (ไม่ใช่ network) = ผิดจริง → ไม่เข้าคิว
      throw new ServerError(json?.message || `ผิดพลาด (${res.status})`);
    }
    return { status: "done", data: json.data as T, message: (json.message as string) || "สำเร็จ" };
  } catch (err) {
    if (err instanceof ServerError) throw err;
    // network error → บันทึกเข้าคิวแล้วตอบว่า queued
    const pending = getPendingScans();
    pending.push(entry);
    writeAll(STORAGE_KEY, pending);
    return { status: "queued", label: entry.label };
  }
}

class ServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerError";
  }
}

/** ข้อความ error ที่แปลว่า "ทำไปแล้ว" (replay หลัง sync) — ไม่ถือเป็นความล้มเหลว */
const REPLAY_OK_PATTERNS = [
  "ครบแล้ว",
  "ขึ้นรถแล้ว",
  "ไม่นับซ้ำ",
  "ถูกบันทึกไปแล้ว",
  "idempotency_key ซ้ำ",
  "อนุมัติและตัดสต็อกไปแล้ว",
];

export interface FlushResult {
  sent: number;
  stillPending: number;
  failed: number;
  cameOnline: boolean;
}

/** ส่งรายการค้างทั้งหมด — เรียกเมื่อ online / เปิดหน้าใหม่ / ทุก N วินาที */
export async function flushScanQueue(): Promise<FlushResult> {
  const pending = getPendingScans();
  if (pending.length === 0) {
    return { sent: 0, stillPending: 0, failed: 0, cameOnline: false };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { sent: 0, stillPending: pending.length, failed: 0, cameOnline: false };
  }

  const remaining: QueuedScan[] = [];
  const failed = getFailedScans();
  let sent = 0;

  for (const entry of pending) {
    entry.attempts += 1;
    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: { "Content-Type": "application/json", ...tabTokenHeader() },
        body: JSON.stringify(entry.body),
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({ success: false, message: "ตอบกลับไม่ใช่ JSON" }));
      if (res.ok && json?.success !== false) {
        sent += 1;
        continue;
      }
      const msg = json?.message || `ผิดพลาด (${res.status})`;
      if (REPLAY_OK_PATTERNS.some((p) => msg.includes(p))) {
        sent += 1; // replay ที่ server ทำไปแล้ว = สำเร็จ
        continue;
      }
      failed.push({ ...entry, error: msg, failed_at: new Date().toISOString() });
    } catch {
      // network ยังไม่กลับ → คงไว้ในคิว
      remaining.push(entry);
    }
  }

  writeAll(STORAGE_KEY, remaining);
  writeAll(FAILED_KEY, failed.slice(-MAX_FAILED));
  return { sent, stillPending: remaining.length, failed: failed.length, cameOnline: remaining.length === 0 && sent > 0 };
}
