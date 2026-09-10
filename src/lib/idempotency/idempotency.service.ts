import { IIdempotencyRepository, IdempotencyRecord } from "./idempotency.repository";
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  ClaimResult,
} from "./idempotency.types";

export { IdempotencyConflictError, IdempotencyInProgressError };

/**
 * อายุที่ถือว่าสถานะ PROCESSING ค้างจากรอบที่ตายกลางทาง (timeout/restart ก่อนจะเขียน
 * COMPLETED/FAILED) — request ของระบบจำกัดที่ 60 วินาที (maxDuration) เกิน 5 นาที
 * จึงปลอดภัยที่จะยึด key คืนแล้วรันใหม่ มิฉะนั้นเอกสารจะติดล็อกถาวรและกดอนุมัติซ้ำไม่ได้อีก
 */
const STALE_PROCESSING_MS = 5 * 60 * 1000;

function isStaleProcessing(record: IdempotencyRecord): boolean {
  const updatedAt = Date.parse(record.updated_at || "");
  if (Number.isNaN(updatedAt)) return false;
  return Date.now() - updatedAt > STALE_PROCESSING_MS;
}

export function computePayloadHash(payload: unknown): string {
  try {
    const canonicalString = JSON.stringify(payload, Object.keys(payload as object || {}).sort());
    if (typeof crypto !== "undefined" && crypto.subtle) {
      let hash = 0;
      for (let i = 0; i < canonicalString.length; i++) {
        const char = canonicalString.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
      }
      return `${Math.abs(hash).toString(16)}-${canonicalString.length}`;
    }
    return Buffer.from(canonicalString).toString("base64").slice(0, 32);
  } catch {
    return String(payload);
  }
}

export async function claimIdempotencyKey<T = unknown>(
  repo?: IIdempotencyRepository,
  key?: string,
  operationType = "MUTATION",
  actorId = "unknown",
  payload?: unknown
): Promise<ClaimResult<T>> {
  if (!repo || !key || !key.trim()) {
    return { isReplay: false };
  }

  const payloadHash = computePayloadHash(payload);
  const existing = await repo.findByKey(key);

  if (existing) {
    // If previous attempt failed => allow retry with new/updated payload
    if (existing.status === "FAILED") {
      await repo.update(key, {
        status: "PROCESSING",
        payload_hash: payloadHash,
        error_message: "",
      });
      return { isReplay: false };
    }

    // PROCESSING ที่เก่าเกิน STALE_PROCESSING_MS คือรอบที่ตายกลางทางแน่นอน
    // (ผลลัพธ์ไม่เคยถูกบันทึกเป็น COMPLETED) ต้องยึด key คืนได้เสมอ แม้ payload
    // จะต่างจากรอบก่อน ไม่เช่นนั้นเอกสารจะติดล็อกถาวรและต้องแก้ในชีตด้วยมือ
    // — ตรวจก่อนการเช็ค hash conflict
    if (existing.status === "PROCESSING" && isStaleProcessing(existing)) {
      await repo.update(key, {
        status: "PROCESSING",
        payload_hash: payloadHash,
        error_message: "",
      });
      return { isReplay: false };
    }

    // If payload hash differs => Conflict
    if (existing.payload_hash && existing.payload_hash !== payloadHash) {
      throw new IdempotencyConflictError(
        `Idempotency-Key "${key}" ถูกใช้ไปแล้วกับข้อมูลอื่นที่ไม่ตรงกัน`
      );
    }

    // If still in progress => Conflict/Retry Later
    if (existing.status === "PROCESSING") {
      throw new IdempotencyInProgressError(
        `คำสั่ง "${key}" กำลังประมวลผลอยู่ กรุณารอสักครู่`
      );
    }

    // If completed => return cached result
    if (existing.status === "COMPLETED" && existing.response_payload) {
      try {
        const cached = JSON.parse(existing.response_payload) as T;
        return { isReplay: true, cachedResult: cached };
      } catch {
        return { isReplay: true };
      }
    }
  }

  // Create new processing record
  await repo.create({
    key,
    operation_type: operationType,
    actor_id: actorId,
    payload_hash: payloadHash,
    status: "PROCESSING",
  });

  return { isReplay: false };
}

export async function completeIdempotencyKey(
  repo?: IIdempotencyRepository,
  key?: string,
  responsePayload?: unknown
): Promise<void> {
  if (!repo || !key || !key.trim()) return;

  const payloadString =
    typeof responsePayload === "string"
      ? responsePayload
      : JSON.stringify(responsePayload);

  await repo.update(key, {
    status: "COMPLETED",
    response_payload: payloadString,
  });
}

export async function failIdempotencyKey(
  repo?: IIdempotencyRepository,
  key?: string,
  errorMessage?: string
): Promise<void> {
  if (!repo || !key || !key.trim()) return;

  await repo.update(key, {
    status: "FAILED",
    error_message: errorMessage,
  });
}
