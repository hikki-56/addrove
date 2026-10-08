export type OperationStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "COMPENSATING"
  | "COMPENSATED"
  | "RECOVERABLE"
  | "MANUAL_REVIEW";

export interface JournalStep {
  step_name: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "COMPENSATED";
  executed_at?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface OperationRecord {
  operation_id: string;
  idempotency_key: string;
  operation_type: string;
  payload_hash: string;
  actor_id: string;
  steps: JournalStep[];
  completed_steps: string[];
  status: OperationStatus;
  retry_count: number;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface IOperationJournalRepository {
  findById(operationId: string): Promise<OperationRecord | null>;
  findByIdempotencyKey(key: string): Promise<OperationRecord | null>;
  create(record: Omit<OperationRecord, "created_at" | "updated_at">): Promise<OperationRecord>;
  update(
    operationId: string,
    updates: Partial<
      Pick<
        OperationRecord,
        "steps" | "completed_steps" | "status" | "retry_count" | "last_error"
      >
    >
  ): Promise<OperationRecord | null>;
  findPendingRecovery(): Promise<OperationRecord[]>;
}
