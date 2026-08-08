export type AuditOutcome = "SUCCESS" | "FAILURE";

export interface AuditLogEntry {
  audit_id: string;
  correlation_id: string;
  idempotency_key?: string;
  actor_id: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  warehouse_id?: string;
  timestamp: string;
  outcome: AuditOutcome;
  error_code?: string;
  metadata?: Record<string, unknown>;
}

export interface IAuditRepository {
  append(entry: Omit<AuditLogEntry, "audit_id" | "timestamp">): Promise<AuditLogEntry>;
  findAll(filters?: {
    actor_id?: string;
    warehouse_id?: string;
    action?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]>;
}
