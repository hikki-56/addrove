import {
  IAuditRepository,
  AuditLogEntry,
} from "../interfaces/audit.repository.interface";
import { readSheet, appendRows } from "@/lib/google-sheets/client";

const SHEET_NAME = "AuditLogs";

export class SheetsAuditRepository implements IAuditRepository {
  async append(
    entry: Omit<AuditLogEntry, "audit_id" | "timestamp">
  ): Promise<AuditLogEntry> {
    const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const timestamp = new Date().toISOString();

    const fullEntry: AuditLogEntry = {
      audit_id: auditId,
      timestamp,
      ...entry,
    };

    const metaString = fullEntry.metadata ? JSON.stringify(fullEntry.metadata) : "";
    try {
      await appendRows(SHEET_NAME, [
        [
          fullEntry.audit_id,
          fullEntry.correlation_id,
          fullEntry.idempotency_key || "",
          fullEntry.actor_id,
          fullEntry.actor_role,
          fullEntry.action,
          fullEntry.resource_type,
          fullEntry.resource_id || "",
          fullEntry.warehouse_id || "",
          fullEntry.timestamp,
          fullEntry.outcome,
          fullEntry.error_code || "",
          metaString,
        ],
      ]);
    } catch (e) {
      console.warn(`[SheetsAuditRepository] Sheet "${SHEET_NAME}" not available in spreadsheet:`, e);
    }

    return fullEntry;
  }

  async findAll(filters?: {
    actor_id?: string;
    warehouse_id?: string;
    action?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    const rows = await readSheet(SHEET_NAME, "A2:Z", { forceFresh: true });
    let result: AuditLogEntry[] = [];
    for (const r of rows) {
      if (!r || !r[0]) continue;
      let meta: Record<string, unknown> | undefined;
      try {
        if (r[12] && r[12].startsWith("{")) meta = JSON.parse(r[12]);
      } catch {}

      result.push({
        audit_id: r[0],
        correlation_id: r[1] || "",
        idempotency_key: r[2] || undefined,
        actor_id: r[3] || "",
        actor_role: r[4] || "",
        action: r[5] || "",
        resource_type: r[6] || "",
        resource_id: r[7] || undefined,
        warehouse_id: r[8] || undefined,
        timestamp: r[9] || "",
        outcome: (r[10] as "SUCCESS" | "FAILURE") || "SUCCESS",
        error_code: r[11] || undefined,
        metadata: meta,
      });
    }

    // Apply filters
    if (filters?.actor_id) {
      result = result.filter((e) => e.actor_id === filters.actor_id);
    }
    if (filters?.warehouse_id) {
      result = result.filter((e) => e.warehouse_id === filters.warehouse_id);
    }
    if (filters?.action) {
      result = result.filter((e) => e.action === filters.action);
    }
    if (filters?.date_from) {
      result = result.filter((e) => e.timestamp >= filters.date_from!);
    }
    if (filters?.date_to) {
      result = result.filter((e) => e.timestamp <= filters.date_to!);
    }

    result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (filters?.limit && filters.limit > 0) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }
}

