import {
  IIdempotencyRepository,
  IdempotencyRecord,
} from "../interfaces/idempotency.repository.interface";
import { readSheet, appendRows, updateRow } from "@/lib/google-sheets/client";

const SHEET_NAME = "Idempotency";

const inMemoryIdempotency = new Map<string, IdempotencyRecord>();

export class SheetsIdempotencyRepository implements IIdempotencyRepository {
  async findByKey(key: string): Promise<IdempotencyRecord | null> {
    try {
      const rows = await readSheet(SHEET_NAME, "A2:Z", { forceFresh: true });
      for (const r of rows) {
        if (!r || !r[0]) continue;
        if (r[0] === key) {
          const rec: IdempotencyRecord = {
            key: r[0],
            operation_type: r[1] || "",
            actor_id: r[2] || "",
            payload_hash: r[3] || "",
            status: (r[4] as "PROCESSING" | "COMPLETED" | "FAILED") || "PROCESSING",
            response_payload: r[5] || undefined,
            error_message: r[6] || undefined,
            created_at: r[7] || new Date().toISOString(),
            updated_at: r[8] || new Date().toISOString(),
          };
          inMemoryIdempotency.set(key, rec);
          return rec;
        }
      }
    } catch {
      // Fall back to in-memory store
    }
    return inMemoryIdempotency.get(key) || null;
  }

  async create(
    record: Omit<IdempotencyRecord, "created_at" | "updated_at">
  ): Promise<IdempotencyRecord> {
    const now = new Date().toISOString();
    const fullRecord: IdempotencyRecord = {
      ...record,
      created_at: now,
      updated_at: now,
    };

    inMemoryIdempotency.set(fullRecord.key, fullRecord);

    try {
      await appendRows(SHEET_NAME, [
        [
          fullRecord.key,
          fullRecord.operation_type,
          fullRecord.actor_id,
          fullRecord.payload_hash,
          fullRecord.status,
          fullRecord.response_payload || "",
          fullRecord.error_message || "",
          fullRecord.created_at,
          fullRecord.updated_at,
        ],
      ]);
    } catch (e) {
      console.warn(`[SheetsIdempotencyRepository] Sheet "${SHEET_NAME}" not available in spreadsheet, cached in memory:`, e);
    }

    return fullRecord;
  }

  async update(
    key: string,
    updates: Partial<Pick<IdempotencyRecord, "status" | "response_payload" | "error_message">>
  ): Promise<IdempotencyRecord | null> {
    const existing = inMemoryIdempotency.get(key) || {
      key,
      operation_type: "",
      actor_id: "",
      payload_hash: "",
      status: "PROCESSING" as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const updated: IdempotencyRecord = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    inMemoryIdempotency.set(key, updated);

    try {
      const rows = await readSheet(SHEET_NAME, "A2:Z", { forceFresh: true });
      const idx = rows.findIndex((r) => r && r[0] === key);
      if (idx !== -1) {
        const rowNumber = idx + 2;
        await updateRow(SHEET_NAME, rowNumber, [
          updated.key,
          updated.operation_type,
          updated.actor_id,
          updated.payload_hash,
          updated.status,
          updated.response_payload || "",
          updated.error_message || "",
          updated.created_at,
          updated.updated_at,
        ]);
      }
    } catch (e) {
      console.warn(`[SheetsIdempotencyRepository] Sheet "${SHEET_NAME}" update skipped, cached in memory:`, e);
    }

    return updated;
  }
}

