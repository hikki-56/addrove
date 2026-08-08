export type IdempotencyStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export interface IdempotencyRecord {
  key: string;
  operation_type: string;
  actor_id: string;
  payload_hash: string;
  status: IdempotencyStatus;
  response_payload?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface IIdempotencyRepository {
  findByKey(key: string): Promise<IdempotencyRecord | null>;
  create(record: Omit<IdempotencyRecord, "created_at" | "updated_at">): Promise<IdempotencyRecord>;
  update(
    key: string,
    updates: Partial<Pick<IdempotencyRecord, "status" | "response_payload" | "error_message">>
  ): Promise<IdempotencyRecord | null>;
}
