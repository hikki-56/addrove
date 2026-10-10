import type { Document } from "@/types/models";
import type { MovementFilterInput } from "@/types/api";

export type DocumentMutator = (
  document: Readonly<Document>
) => Partial<Document> | null | Promise<Partial<Document> | null>;

export interface IDocumentRepository {
  findAll(filters?: MovementFilterInput): Promise<{ data: Document[]; total: number }>;
  findById(id: string, options?: { forceFresh?: boolean }): Promise<Document | null>;
  findByNo(no: string, options?: { forceFresh?: boolean }): Promise<Document | null>;
  existsByIdempotencyKey?(key: string): Promise<boolean>;
  create(doc: Omit<Document, "document_id" | "document_no" | "created_at">): Promise<Document>;
  updateStatus(id: string, status: Document["status"]): Promise<void>;
  updateNote(id: string, note: string): Promise<void>;
  updateDoc?(id: string, updates: Partial<Document>): Promise<void>;
  mutate?(id: string, mutator: DocumentMutator): Promise<Document | null>;
  generateDocumentNo(type: Document["document_type"]): Promise<string>;
}
