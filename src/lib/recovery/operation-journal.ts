import type {
  OperationStatus,
  JournalStep,
  OperationRecord,
  IOperationJournalRepository,
} from "@/lib/repositories/interfaces/operation-journal.repository.interface";

export type { OperationStatus, JournalStep, OperationRecord, IOperationJournalRepository };

export class ManualReviewRequiredError extends Error {
  constructor(
    message: string,
    public readonly operationId: string,
    public readonly diagnostics?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ManualReviewRequiredError";
  }
}
