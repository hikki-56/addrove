import {
  readSheet,
  appendRows,
  updateRow,
  SHEETS,
} from "@/lib/google-sheets/client";
import type { IDocumentRepository } from "../interfaces";
import type { Document, DocumentType } from "@/types/models";
import type { MovementFilterInput } from "@/types/api";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Columns: document_id, document_no, document_type, reference_no, document_date, status, note, created_by, created_at
function rowToDocument(row: string[]): Document {
  return {
    document_id: row[0] ?? "",
    document_no: row[1] ?? "",
    document_type: row[2] as DocumentType,
    reference_no: row[3] ?? "",
    document_date: row[4] ?? "",
    status: (row[5] as Document["status"]) ?? "DRAFT",
    note: row[6] ?? "",
    created_by: row[7] ?? "",
    created_at: row[8] ?? "",
  };
}

function documentToRow(d: Document): string[] {
  return [
    d.document_id,
    d.document_no,
    d.document_type,
    d.reference_no,
    d.document_date,
    d.status,
    d.note,
    d.created_by,
    d.created_at,
  ];
}

const TYPE_PREFIX: Record<DocumentType, string> = {
  OPENING: "OP",
  RECEIVE: "RCV",
  ISSUE: "ISS",
  MOVE: "MOV",
  TRANSFER: "TRF",
  ADJUST: "ADJ",
  REVERSAL: "REV",
};

export class SheetsDocumentRepository implements IDocumentRepository {
  private async getAllRows(): Promise<string[][]> {
    return readSheet(SHEETS.DOCUMENTS, "A2:I");
  }

  async findAll(
    filters: MovementFilterInput
  ): Promise<{ data: Document[]; total: number }> {
    const rows = await this.getAllRows();
    let docs = rows.filter((r) => r[0]).map(rowToDocument);
    if (filters.document_type) {
      docs = docs.filter((d) => d.document_type === filters.document_type);
    }
    if (filters.document_no) {
      docs = docs.filter((d) =>
        d.document_no
          .toLowerCase()
          .includes(filters.document_no!.toLowerCase())
      );
    }
    if (filters.date_from) {
      docs = docs.filter((d) => d.document_date >= filters.date_from!);
    }
    if (filters.date_to) {
      docs = docs.filter((d) => d.document_date <= filters.date_to!);
    }
    const total = docs.length;
    const start = (filters.page - 1) * filters.limit;
    return { data: docs.slice(start, start + filters.limit), total };
  }

  async findById(id: string): Promise<Document | null> {
    const rows = await this.getAllRows();
    const row = rows.find((r) => r[0] === id);
    return row ? rowToDocument(row) : null;
  }

  async findByNo(no: string): Promise<Document | null> {
    const rows = await this.getAllRows();
    const row = rows.find((r) => r[1] === no);
    return row ? rowToDocument(row) : null;
  }

  async create(
    doc: Omit<Document, "document_id" | "document_no" | "created_at">
  ): Promise<Document> {
    const document_no = await this.generateDocumentNo(doc.document_type);
    const now = new Date().toISOString();
    const newDoc: Document = {
      ...doc,
      document_id: `doc-${generateUuid()}`,
      document_no,
      created_at: now,
    };
    await appendRows(SHEETS.DOCUMENTS, [documentToRow(newDoc)]);
    return newDoc;
  }

  async updateStatus(
    id: string,
    status: Document["status"]
  ): Promise<void> {
    const rows = await this.getAllRows();
    const idx = rows.findIndex((r) => r[0] === id);
    if (idx === -1) throw new Error("ไม่พบเอกสาร");
    const doc = rowToDocument(rows[idx]);
    doc.status = status;
    await updateRow(SHEETS.DOCUMENTS, idx + 2, documentToRow(doc));
  }

  async generateDocumentNo(type: DocumentType): Promise<string> {
    const rows = await this.getAllRows();
    const prefix = TYPE_PREFIX[type];
    const existing = rows.filter((r) => r[2] === type).length;
    const seq = String(existing + 1).padStart(6, "0");
    const dateStr = new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "");
    return `${prefix}-${dateStr}-${seq}`;
  }
}
