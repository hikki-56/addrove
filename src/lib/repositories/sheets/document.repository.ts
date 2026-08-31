import {
  readSheet,
  appendRows,
  updateRow,
  SHEETS,
  clearSheetCache,
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

const globalForDocs = globalThis as unknown as {
  inMemoryDocs?: Document[];
};
if (!globalForDocs.inMemoryDocs) {
  globalForDocs.inMemoryDocs = [];
}
const inMemoryDocs = globalForDocs.inMemoryDocs;

export class SheetsDocumentRepository implements IDocumentRepository {
  /**
   * Read raw sheet rows WITHOUT mixing in-memory docs.
   * Returns the actual rows from Google Sheets, preserving real row indices.
   */
  private async getSheetRows(): Promise<string[][]> {
    return await readSheet(SHEETS.DOCUMENTS, "A2:I").catch(() => []);
  }

  /**
   * Get all documents (sheet + in-memory), used for queries (findAll, findById, etc.)
   * NOTE: Do NOT use the returned array indices for updateRow — use getSheetRows() instead.
   */
  private async getAllRows(): Promise<string[][]> {
    const rows = await this.getSheetRows();
    const existingIds = new Set<string>(rows.map((r) => r[0]));

    const combined = [...rows];
    for (const memDoc of inMemoryDocs) {
      if (!existingIds.has(memDoc.document_id)) {
        combined.push(documentToRow(memDoc));
      }
    }

    return combined;
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

    inMemoryDocs.unshift(newDoc);

    try {
      await appendRows(SHEETS.DOCUMENTS, [documentToRow(newDoc)]);
      // Doc ถูก sync ลง Sheets สำเร็จแล้ว → ลบออกจาก inMemoryDocs
      // เพื่อป้องกัน race condition ระหว่าง server restart (HMR/cold-start)
      const syncedIdx = inMemoryDocs.findIndex((d) => d.document_id === newDoc.document_id);
      if (syncedIdx !== -1) inMemoryDocs.splice(syncedIdx, 1);
      // Clear cache หลัง write สำเร็จ เพื่อให้ read ถัดไปได้ข้อมูลใหม่
      clearSheetCache(SHEETS.DOCUMENTS);
    } catch (err) {
      console.warn("[SheetsDocumentRepository] Google Sheets append failed, stored in memory fallback:", err);
    }

    return newDoc;
  }

  async updateStatus(
    id: string,
    status: Document["status"]
  ): Promise<void> {
    // Update in-memory document status
    const memDoc = inMemoryDocs.find((d) => d.document_id === id || d.document_no === id);
    if (memDoc) {
      memDoc.status = status;
    }

    // Use raw sheet rows to get correct row index for Google Sheets
    const sheetRows = await this.getSheetRows();
    const idx = sheetRows.findIndex((r) => r[0] === id || r[1] === id);

    if (idx !== -1) {
      const doc = rowToDocument(sheetRows[idx]);
      doc.status = status;
      // สำคัญ: ถ้า memDoc มี note ที่ถูกอัปเดตแล้ว (เช่น moved_by ถูก set โดย submitTransferMove/completeTransfer)
      // ให้ sync note นั้นกลับลงไปใน Sheets ด้วย เพื่อไม่ให้ข้อมูล metadata หาย
      if (memDoc?.note && memDoc.note !== doc.note) {
        doc.note = memDoc.note;
      }
      // idx is 0-based from row 2 in sheets, so actual row = idx + 2
      await updateRow(SHEETS.DOCUMENTS, idx + 2, documentToRow(doc));
      // Clear cache หลัง write สำเร็จ เพื่อป้องกัน stale read จาก race condition
      clearSheetCache(SHEETS.DOCUMENTS);
    } else {
      console.warn(`[SheetsDocumentRepository] updateStatus: document "${id}" not found in Google Sheets rows`);
    }
  }

  async updateNote(
    id: string,
    note: string
  ): Promise<void> {
    // Update in-memory document note
    const memDoc = inMemoryDocs.find((d) => d.document_id === id || d.document_no === id);
    if (memDoc) {
      memDoc.note = note;
    }

    // Use raw sheet rows to get correct row index for Google Sheets
    const sheetRows = await this.getSheetRows();
    const idx = sheetRows.findIndex((r) => r[0] === id || r[1] === id);

    if (idx !== -1) {
      const doc = rowToDocument(sheetRows[idx]);
      doc.note = note;
      // idx is 0-based from row 2 in sheets, so actual row = idx + 2
      await updateRow(SHEETS.DOCUMENTS, idx + 2, documentToRow(doc));
      clearSheetCache(SHEETS.DOCUMENTS);
    } else {
      console.warn(`[SheetsDocumentRepository] updateNote: document "${id}" not found in Google Sheets rows`);
    }
  }

  async updateDoc(
    id: string,
    updates: Partial<Document>
  ): Promise<void> {
    const memDoc = inMemoryDocs.find((d) => d.document_id === id) || inMemoryDocs.find((d) => d.document_no === id);
    if (memDoc) {
      Object.assign(memDoc, updates);
    }

    const sheetRows = await this.getSheetRows();
    let idx = sheetRows.findIndex((r) => r[0] === id);
    if (idx === -1) {
      idx = sheetRows.findIndex((r) => r[1] === id);
    }

    if (idx !== -1) {
      const doc = rowToDocument(sheetRows[idx]);
      Object.assign(doc, updates);
      await updateRow(SHEETS.DOCUMENTS, idx + 2, documentToRow(doc));
      clearSheetCache(SHEETS.DOCUMENTS);
    } else {
      console.warn(`[SheetsDocumentRepository] updateDoc: document "${id}" not found in Google Sheets rows`);
    }
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
