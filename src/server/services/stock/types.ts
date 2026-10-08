// Business operation input types used by the Service Layer (inventory.service.ts).
// Moved verbatim from the former src/lib/repositories/interfaces.ts.
import type {
  ReceiveDocumentInput,
  IssueDocumentInput,
  MoveDocumentInput,
  TransferDocumentInput,
  ReversalDocumentInput,
} from "@/types/api";

// Business operation types used by Service Layer
export interface ReceiveInput extends ReceiveDocumentInput {
  user_id: string;
}
export interface IssueInput extends IssueDocumentInput {
  user_id: string;
}
export interface MoveInput extends MoveDocumentInput {
  user_id: string;
}
export interface TransferInput extends TransferDocumentInput {
  user_id: string;
}
export interface ReversalInput extends ReversalDocumentInput {
  user_id: string;
}
