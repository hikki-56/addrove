// API client กลางของระบบผลิต (ฝั่ง client)
// - ห่อ fetch แล้วคืนรูปแบบเดียว { success, message, data, status } เสมอ (ไม่ throw)
// - จัดการ 401/403/409 ให้ข้อความภาษาไทยสม่ำเสมอ · 409 (ข้อมูลเก่า/สถานะเปลี่ยน) แนะนำให้รีเฟรช
// - header สิทธิ์ใส่ให้อัตโนมัติโดย TabAuthContext (monkey-patch fetch) — ที่นี่ไม่ต้องจัดการ token
//
// หมายเหตุ: api-contract §1.5 จะเพิ่ม `code` (VERSION_CONFLICT, INVALID_TRANSITION, IDEMPOTENCY_* …)
// ตอนนี้ยังไม่มี — ส่งต่อ code/errors ถ้ามี แต่ตัดสินหลักจาก HTTP status + message

export type ProductionApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ProductionApiFieldError {
  field: string;
  message: string;
}

export interface ProductionApiResult<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  /** HTTP status · 0 = เชื่อมต่อไม่ได้/ไม่ได้รับคำตอบ */
  status: number;
  /** error code แบบ machine-readable (api-contract §1.5 — CHANGED, อาจยังไม่มี) */
  code?: string;
  /** error รายช่อง (zod/บริการ) สำหรับไฮไลต์ฟอร์ม */
  errors?: ProductionApiFieldError[];
}

export const PRODUCTION_API_MESSAGES = {
  network: "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่",
  unauthorized: "เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
  forbidden: "คุณไม่มีสิทธิ์ดำเนินการนี้",
  conflict: "ข้อมูลงานถูกเปลี่ยนแปลงไปแล้ว (อาจมีผู้อื่นแก้ไขหรือสถานะงานเปลี่ยน)",
  reloadHint: "กรุณารีเฟรชหน้าเพื่อโหลดข้อมูลล่าสุดแล้วลองใหม่",
  notFound: "ไม่พบข้อมูลงานผลิตนี้ (อาจถูกลบไปแล้ว)",
  server: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  success: "สำเร็จ",
  failed: "ดำเนินการไม่สำเร็จ",
} as const;

/** ข้อความ error ที่แสดงผู้ใช้ ตาม HTTP status + ข้อความจากเซิร์ฟเวอร์ (ถ้ามี) */
export function describeProductionError(status: number, serverMessage?: string): string {
  const msg = (serverMessage || "").trim();
  if (status === 0) return PRODUCTION_API_MESSAGES.network;
  if (status === 401) return PRODUCTION_API_MESSAGES.unauthorized;
  if (status === 403) return msg || PRODUCTION_API_MESSAGES.forbidden;
  if (status === 409) {
    const base = msg || PRODUCTION_API_MESSAGES.conflict;
    return /รีเฟรช/.test(base) ? base : `${base} — ${PRODUCTION_API_MESSAGES.reloadHint}`;
  }
  if (status === 404) return msg || PRODUCTION_API_MESSAGES.notFound;
  if (status >= 500) return msg || PRODUCTION_API_MESSAGES.server;
  return msg || PRODUCTION_API_MESSAGES.failed;
}

/** 409 = ข้อมูลบนจอเก่ากว่าเซิร์ฟเวอร์ → ผู้เรียกควร reload ข้อมูล */
export function isConflict(res: Pick<ProductionApiResult, "status">): boolean {
  return res.status === 409;
}

/** code ที่ต้องลองใหม่ด้วย idempotency key เดิม (api-contract §1.6, §1.7) */
const RETRY_SAME_KEY_CODES = new Set(["IDEMPOTENCY_IN_PROGRESS", "VERSION_CONFLICT"]);

/**
 * ล้มเหลวแบบ "ลองใหม่ได้ด้วยคำขอเดิม" (เครือข่ายหลุด/timeout/5xx/429/401 หลังเข้าสู่ระบบใหม่,
 * IDEMPOTENCY_IN_PROGRESS, VERSION_CONFLICT ซึ่งยังไม่มีการเขียนแถว) — ใช้ตัดสินว่าจะเก็บ idempotency key ไว้หรือไม่
 */
export function isRetryableFailure(res: Pick<ProductionApiResult, "success" | "status" | "code">): boolean {
  if (res.success) return false;
  if (res.code && RETRY_SAME_KEY_CODES.has(res.code)) return true;
  return res.status === 0 || res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500;
}

export interface ProductionApiOptions {
  signal?: AbortSignal;
}

/** เรียก API ระบบผลิต — ไม่ throw; คืน { success, message, data, status } เสมอ */
export async function productionApi<T = unknown>(
  url: string,
  method: ProductionApiMethod = "GET",
  body?: unknown,
  options: ProductionApiOptions = {}
): Promise<ProductionApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
  } catch {
    return { success: false, message: PRODUCTION_API_MESSAGES.network, status: 0 };
  }

  type ApiBody = { success?: unknown; message?: unknown; data?: unknown; code?: unknown; errors?: unknown };
  let json: ApiBody | null = null;
  try {
    const parsed: unknown = await res.json();
    json = parsed && typeof parsed === "object" ? (parsed as ApiBody) : null;
  } catch {
    json = null;
  }
  const serverMessage = typeof json?.message === "string" ? json.message : "";
  const success = res.ok && !!json && json.success === true;

  if (success) {
    return {
      success: true,
      message: serverMessage || PRODUCTION_API_MESSAGES.success,
      data: json?.data as T,
      status: res.status,
    };
  }
  // ตอบ 2xx แต่ body ไม่ใช่ JSON/success=false → ถือว่าล้มเหลว (คง status จริงไว้)
  const failure: ProductionApiResult<T> = {
    success: false,
    message: describeProductionError(res.ok && !json ? 500 : res.status, serverMessage),
    data: json?.data as T | undefined,
    status: res.status,
  };
  if (typeof json?.code === "string" && json.code) failure.code = json.code;
  if (Array.isArray(json?.errors)) {
    failure.errors = json.errors
      .filter((e): e is { field?: unknown; message?: unknown } => !!e && typeof e === "object")
      .map((e) => ({ field: String(e.field ?? ""), message: String(e.message ?? "") }));
  }
  return failure;
}

/** สร้าง idempotency key ใหม่เป็น UUID v4 (api-contract §1.6) — crypto.randomUUID หรือ getRandomValues สำรอง */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
