import {
  IOperationJournalRepository,
  OperationRecord,
  OperationStatus,
} from "../interfaces/operation-journal.repository.interface";
import { readSheet, appendRows, updateRow } from "@/lib/google-sheets/client";

const SHEET_NAME = "OperationJournal";

export class SheetsOperationJournalRepository implements IOperationJournalRepository {
  async findById(operationId: string): Promise<OperationRecord | null> {
    const rows = await readSheet(SHEET_NAME, "A2:Z", { forceFresh: true });
    for (const r of rows) {
      if (!r || !r[0]) continue;
      if (r[0] === operationId) {
        return this.parseRow(r);
      }
    }
    return null;
  }

  async findByIdempotencyKey(key: string): Promise<OperationRecord | null> {
    const rows = await readSheet(SHEET_NAME, "A2:Z", { forceFresh: true });
    for (const r of rows) {
      if (!r || !r[0]) continue;
      if (r[1] === key) {
        return this.parseRow(r);
      }
    }
    return null;
  }

  async create(
    record: Omit<OperationRecord, "created_at" | "updated_at">
  ): Promise<OperationRecord> {
    const now = new Date().toISOString();
    const fullRecord: OperationRecord = {
      ...record,
      created_at: now,
      updated_at: now,
    };

    await appendRows(SHEET_NAME, [
      [
        fullRecord.operation_id,
        fullRecord.idempotency_key,
        fullRecord.operation_type,
        fullRecord.payload_hash,
        fullRecord.actor_id,
        JSON.stringify(fullRecord.steps),
        JSON.stringify(fullRecord.completed_steps),
        fullRecord.status,
        fullRecord.retry_count,
        fullRecord.last_error || "",
        fullRecord.created_at,
        fullRecord.updated_at,
      ],
    ]);

    return fullRecord;
  }

  async update(
    operationId: string,
    updates: Partial<
      Pick<
        OperationRecord,
        "steps" | "completed_steps" | "status" | "retry_count" | "last_error"
      >
    >
  ): Promise<OperationRecord | null> {
    const rows = await readSheet(SHEET_NAME, "A2:Z", { forceFresh: true });
    const idx = rows.findIndex((r) => r && r[0] === operationId);
    if (idx === -1) return null;

    const existing = this.parseRow(rows[idx]);
    const updated: OperationRecord = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const rowNumber = idx + 2;
    await updateRow(SHEET_NAME, rowNumber, [
      updated.operation_id,
      updated.idempotency_key,
      updated.operation_type,
      updated.payload_hash,
      updated.actor_id,
      JSON.stringify(updated.steps),
      JSON.stringify(updated.completed_steps),
      updated.status,
      updated.retry_count,
      updated.last_error || "",
      updated.created_at,
      updated.updated_at,
    ]);

    return updated;
  }

  async findPendingRecovery(): Promise<OperationRecord[]> {
    const pending: OperationRecord[] = [];
    const rows = await readSheet(SHEET_NAME, "A2:Z", { forceFresh: true });
    for (const r of rows) {
      if (!r || !r[0]) continue;
      const status = r[7];
      if (status === "RECOVERABLE" || status === "MANUAL_REVIEW" || status === "COMPENSATING") {
        const rec = this.parseRow(r);
        if (rec) pending.push(rec);
      }
    }
    return pending;
  }

  private parseRow(r: string[]): OperationRecord {
    let steps = [];
    let completedSteps = [];
    try {
      if (r[5]) steps = JSON.parse(r[5]);
    } catch {}
    try {
      if (r[6]) completedSteps = JSON.parse(r[6]);
    } catch {}

    const record: OperationRecord = {
      operation_id: r[0],
      idempotency_key: r[1] || "",
      operation_type: r[2] || "",
      payload_hash: r[3] || "",
      actor_id: r[4] || "",
      steps,
      completed_steps: completedSteps,
      status: (r[7] as OperationStatus) || "PENDING",
      retry_count: Number(r[8]) || 0,
      last_error: r[9] || undefined,
      created_at: r[10] || new Date().toISOString(),
      updated_at: r[11] || new Date().toISOString(),
    };
    return record;
  }
}

