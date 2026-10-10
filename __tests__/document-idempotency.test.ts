jest.mock("@/lib/google-sheets/client", () => ({
  readSheet: jest.fn(),
  updateRow: jest.fn(async () => undefined),
  clearSheetCache: jest.fn(),
  SHEETS: { DOCUMENTS: "Documents" },
}));

import { readSheet, updateRow } from "@/lib/google-sheets/client";
import { SheetsDocumentRepository } from "@/lib/repositories/sheets/document.repository";

describe("document idempotency lookup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("finds a key beyond the former 9999-document limit and skips malformed notes", async () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => [
      `doc-${i}`, "", "RECEIVE", "", "", "PENDING", "{invalid-json",
    ]);
    rows.push(["doc-last", "", "RECEIVE", "", "", "PENDING", JSON.stringify({ idempotency_key: "last-key" })]);
    jest.mocked(readSheet).mockResolvedValue(rows);
    const repo = new SheetsDocumentRepository();
    await expect(repo.existsByIdempotencyKey("last-key")).resolves.toBe(true);
    await expect(repo.existsByIdempotencyKey("missing-key")).resolves.toBe(false);
  });

  test("mutates a document with one fresh read and one row write", async () => {
    jest.mocked(readSheet).mockResolvedValue([
      ["doc-1", "TRF-001", "TRANSFER", "", "2026-10-10", "PENDING", '{"sku":"A"}', "user-1", "2026-10-10T00:00:00.000Z"],
    ]);
    const repo = new SheetsDocumentRepository();

    const result = await repo.mutate("trf-001", (document) => ({
      status: "WAITING_APPROVAL",
      note: JSON.stringify({ ...JSON.parse(document.note), current_step: 4 }),
    }));

    expect(result?.status).toBe("WAITING_APPROVAL");
    expect(readSheet).toHaveBeenCalledTimes(1);
    expect(updateRow).toHaveBeenCalledTimes(1);
    expect(jest.mocked(updateRow).mock.calls[0][2][5]).toBe("WAITING_APPROVAL");
  });

  test("serializes progress after submit without regressing the document", async () => {
    let storedRow = [
      "doc-2", "TRF-002", "TRANSFER", "", "2026-10-10", "PENDING", '{"current_step":1}', "user-1", "2026-10-10T00:00:00.000Z",
    ];
    jest.mocked(readSheet).mockImplementation(async () => [[...storedRow]]);
    jest.mocked(updateRow).mockImplementation(async (_sheet, _row, values) => {
      storedRow = values.map(String);
    });
    const repo = new SheetsDocumentRepository();

    await Promise.all([
      repo.mutate("doc-2", () => ({
        status: "WAITING_APPROVAL",
        note: '{"current_step":4}',
      })),
      repo.mutate("doc-2", (document) =>
        document.status === "PENDING" ? { note: '{"current_step":3}' } : null
      ),
    ]);

    expect(storedRow[5]).toBe("WAITING_APPROVAL");
    expect(JSON.parse(storedRow[6]).current_step).toBe(4);
    expect(updateRow).toHaveBeenCalledTimes(1);
  });
});
