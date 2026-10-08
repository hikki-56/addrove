import type { IdempotencyStatus, IdempotencyRecord } from "@/lib/repositories/interfaces/idempotency.repository.interface";

export type { IdempotencyStatus, IdempotencyRecord };

export class IdempotencyConflictError extends Error {
  constructor(message = "Idempotency-Key ซ้ำกับคำสั่งอื่นที่มีข้อมูลต่างกัน (Payload Conflict)") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyInProgressError extends Error {
  constructor(message = "คำสั่งนี้กำลังประมวลผลอยู่ กรุณารอสักครู่ (Idempotency In Progress)") {
    super(message);
    this.name = "IdempotencyInProgressError";
  }
}

export interface ClaimResult<T = unknown> {
  isReplay: boolean;
  cachedResult?: T;
}
