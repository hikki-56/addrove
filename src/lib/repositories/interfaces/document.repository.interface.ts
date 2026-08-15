import type { Document } from "@/types/models";
import type { MovementFilterInput } from "@/types/api";

export interface IDocumentRepository {
  findAll(filters?: MovementFilterInput): Promise<{ data: Document[]; total: number }>;
  findById(id: string): Promise<Document | null>;
  findByNo(no: string): Promise<Document | null>;
  create(doc: Omit<Document, "document_id" | "document_no" | "created_at">): Promise<Document>;
  updateStatus(id: string, status: Document["status"]): Promise<void>;
  updateNote(id: string, note: string): Promise<void>;
  generateDocumentNo(type: Document["document_type"]): Promise<string>;
}
