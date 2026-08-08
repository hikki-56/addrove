import {
  IIdempotencyRepository,
  IdempotencyRecord,
} from "../interfaces/idempotency.repository.interface";
import { readSheet, appendRows, updateRow } from "@/lib/google-sheets/client";

const SHEET_NAME = "Idempotency";

export class SheetsIdempotencyRepository implements IIdempotencyRepository {
  async findByKey(key: string): Promise<IdempotencyRecord | null> {
    const rows = await readSheet(SHEET_NAME, "A2:Z", { forceFresh: true });
    for (const r of rows) {
      if (!r || !r[0]) continue;
      if (r[0] === key) {
        return {
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
      }
    }
    return null;
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

    return fullRecord;
  }

  async update(
    key: string,
    updates: Partial<Pick<IdempotencyRecord, "status" | "response_payload" | "error_message">>
  ): Promise<IdempotencyRecord | null> {
    const rows = await readSheet(SHEET_NAME, "A2:Z", { forceFresh: true });
    const idx = rows.findIndex((r) => r && r[0] === key);
    if (idx === -1) return null;

    const existingRow = rows[idx];
    const existing: IdempotencyRecord = {
      key: existingRow[0],
      operation_type: existingRow[1] || "",
      actor_id: existingRow[2] || "",
      payload_hash: existingRow[3] || "",
      status: (existingRow[4] as "PROCESSING" | "COMPLETED" | "FAILED") || "PROCESSING",
      response_payload: existingRow[5] || undefined,
      error_message: existingRow[6] || undefined,
      created_at: existingRow[7] || new Date().toISOString(),
      updated_at: existingRow[8] || new Date().toISOString(),
    };

    const updated: IdempotencyRecord = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };

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

    return updated;
  }
}

