// idempotency key ของ "การส่งที่ตั้งใจ" หนึ่งครั้ง (รายงานผล / ปรับปรุงยอด) — api-contract §1.6
//
// - เก็บใน sessionStorage (รอดการรีเฟรชในแท็บเดิม) คีย์ = action + job_no + รอบ, ค่า = { key, hash }
// - hash = ลายนิ้วมือของ payload (ไม่รวม idempotency_key/updated_at) — เซิร์ฟเวอร์ปฏิเสธ key เดิมที่ payload ต่าง
//   ผู้ใช้แก้ตัวเลข → hash ต่าง → สร้าง key ใหม่ (และทิ้ง key ค้างที่ payload ต่างของงาน/การกระทำนั้น)
// - payload เดิมของงานเดียวกัน = ใช้ key เดิม แม้ "รอบ" จะเลื่อนไปแล้ว (กรณีบันทึกสำเร็จแต่คำตอบหาย แล้ว polling
//   ดึง report_count ใหม่มา → ส่งซ้ำได้ replay ไม่ใช่รายงานซ้ำ)
// - ล้างเมื่อเซิร์ฟเวอร์ยืนยันสำเร็จ (รวม replayed) หรือได้ error ที่ลองซ้ำไม่ได้แน่นอนเท่านั้น
import { isRetryableFailure, newIdempotencyKey } from "./api";
import type { ProductionApiResult } from "./api";

export type IdempotentAction = "report" | "adjust";

export interface IdempotencyIntent {
  action: IdempotentAction;
  jobNo: string;
  /** รอบที่กำลังจะบันทึก (เช่น job.report_count + 1) */
  round: number;
  /** payload ที่จะส่ง (ไม่ต้องมี idempotency_key) */
  payload: Record<string, unknown>;
}

interface PendingEntry {
  key: string;
  hash: string;
  createdAt: number;
}

const STORAGE_PREFIX = "stockify-prod-idem:";
/** key ค้างเกินนี้ถือว่าหมดอายุ (ไม่มีทางเป็นการลองซ้ำของคำขอเดิมแล้ว) */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const memoryStore = new Map<string, string>();

// ---- storage (sessionStorage + สำรองในหน่วยความจำ) ----

function session(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// ใช้ sessionStorage เป็นหลัก · ใช้หน่วยความจำเฉพาะเมื่อไม่มี/เขียน sessionStorage ไม่ได้
function readRaw(storageKey: string): string | null {
  const s = session();
  if (s) {
    try {
      const v = s.getItem(storageKey);
      if (v !== null) return v;
    } catch {
      /* ignore */
    }
  }
  return memoryStore.get(storageKey) ?? null;
}

function writeRaw(storageKey: string, value: string): void {
  const s = session();
  if (s) {
    try {
      s.setItem(storageKey, value);
      memoryStore.delete(storageKey);
      return;
    } catch {
      /* quota/private mode — ใช้ memoryStore แทน */
    }
  }
  memoryStore.set(storageKey, value);
}

function removeRaw(storageKey: string): void {
  memoryStore.delete(storageKey);
  try {
    session()?.removeItem(storageKey);
  } catch {
    /* ignore */
  }
}

function listKeys(prefix: string): string[] {
  const keys = new Set<string>();
  for (const k of memoryStore.keys()) if (k.startsWith(prefix)) keys.add(k);
  try {
    const s = session();
    if (s) {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && k.startsWith(prefix)) keys.add(k);
      }
    }
  } catch {
    /* ignore */
  }
  return [...keys];
}

function parseEntry(raw: string | null): PendingEntry | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingEntry>;
    if (typeof v.key === "string" && typeof v.hash === "string") {
      return { key: v.key, hash: v.hash, createdAt: typeof v.createdAt === "number" ? v.createdAt : 0 };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function jobPrefix(action: IdempotentAction, jobNo: string): string {
  return `${STORAGE_PREFIX}${action}:${jobNo.toLowerCase()}:`;
}

function entryKey(intent: Pick<IdempotencyIntent, "action" | "jobNo" | "round">): string {
  return `${jobPrefix(intent.action, intent.jobNo)}${intent.round}`;
}

// ---- payload hash ----

/** JSON แบบเรียง key คงที่ (ไม่รวม idempotency_key/updated_at, ตัดช่องว่างหัวท้ายข้อความ) */
export function canonicalPayload(payload: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        if (k === "idempotency_key" || k === "updated_at") continue;
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) out[k] = norm(x);
      }
      return out;
    }
    return typeof v === "string" ? v.trim() : v;
  };
  return JSON.stringify(norm(payload));
}

/** FNV-1a 64-bit (สองชุด 32-bit) — ใช้เทียบ payload เท่านั้น ไม่ใช่ความปลอดภัย */
export function hashPayload(payload: Record<string, unknown>): string {
  const text = canonicalPayload(payload);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ---- public API ----

/**
 * คืน idempotency key ของ intent นี้:
 * - มี key ค้างของงาน+การกระทำเดียวกันที่ payload เหมือนกัน → ใช้ key นั้น (ทุกรอบ)
 * - ไม่มี → ทิ้ง key ค้างของงาน+การกระทำนั้นที่ payload ต่าง แล้วสร้าง key ใหม่ผูกกับรอบนี้
 */
export function acquireIdempotencyKey(intent: IdempotencyIntent, now: number = Date.now()): string {
  const hash = hashPayload(intent.payload);
  const prefix = jobPrefix(intent.action, intent.jobNo);
  for (const k of listKeys(prefix)) {
    const entry = parseEntry(readRaw(k));
    if (!entry || now - entry.createdAt > MAX_AGE_MS) {
      removeRaw(k);
      continue;
    }
    if (entry.hash === hash) return entry.key;
  }
  for (const k of listKeys(prefix)) removeRaw(k);
  const entry: PendingEntry = { key: newIdempotencyKey(), hash, createdAt: now };
  writeRaw(entryKey(intent), JSON.stringify(entry));
  return entry.key;
}

/** key ที่ค้างอยู่ของงาน+การกระทำ (สำหรับ debug/test) */
export function peekPendingKeys(action: IdempotentAction, jobNo: string): string[] {
  return listKeys(jobPrefix(action, jobNo))
    .map((k) => parseEntry(readRaw(k))?.key)
    .filter((k): k is string => !!k);
}

/** ล้าง key นี้ออกจากที่เก็บ (เรียกเมื่อสำเร็จหรือ error ที่ลองซ้ำไม่ได้) */
export function releaseIdempotencyKey(action: IdempotentAction, jobNo: string, key: string): void {
  for (const k of listKeys(jobPrefix(action, jobNo))) {
    if (parseEntry(readRaw(k))?.key === key) removeRaw(k);
  }
}

/**
 * ส่งคำขอพร้อม idempotency key ของ intent นี้
 * - สำเร็จ (รวม replayed) หรือ error ที่ลองซ้ำไม่ได้ (400/403/404/409 ทั่วไป) → ล้าง key
 * - เครือข่ายหลุด/5xx/401/429/IDEMPOTENCY_IN_PROGRESS/VERSION_CONFLICT → เก็บ key ไว้ ส่งใหม่ได้ key เดิม
 */
export async function sendWithIdempotency<T>(
  intent: IdempotencyIntent,
  send: (idempotencyKey: string) => Promise<ProductionApiResult<T>>
): Promise<ProductionApiResult<T>> {
  const key = acquireIdempotencyKey(intent);
  const res = await send(key);
  if (res.success || !isRetryableFailure(res)) releaseIdempotencyKey(intent.action, intent.jobNo, key);
  return res;
}
