jest.mock("@/server/google-sheets/client", () => ({
  readSheet: jest.fn(),
  SHEETS: { DOCUMENTS: "Documents" },
}));

import { readSheet } from "@/server/google-sheets/client";
import { SheetsDocumentRepository } from "@/server/repositories/sheets/document.repository";

describe("document idempotency lookup", () => {
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
});
