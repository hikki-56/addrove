const mutateMock = jest.fn();

jest.mock("@/lib/auth-session", () => ({
  getAuthSession: jest.fn(async () => ({ user: { id: "staff-1", name: "พนักงาน" } })),
}));

jest.mock("@/lib/security", () => ({
  createActorFromSession: jest.fn(async () => ({
    id: "staff-1",
    role: "WAREHOUSE_STAFF",
  })),
}));

jest.mock("@/lib/repositories", () => ({
  getRepository: jest.fn(() => ({
    documents: {
      mutate: (...args: unknown[]) => mutateMock(...args),
    },
  })),
}));

import { PATCH } from "@/app/api/movements/transfer/[id]/progress/route";
import type { DocumentMutator } from "@/lib/repositories/interfaces";
import type { Document } from "@/types/models";

function progressRequest(step: number) {
  return new Request("http://localhost/api/movements/transfer/doc-1/progress", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step }),
  });
}

function transferDocument(status: Document["status"], note: string): Document {
  return {
    document_id: "doc-1",
    document_no: "TRF-001",
    document_type: "TRANSFER",
    reference_no: "",
    document_date: "2026-10-10",
    status,
    note,
    created_by: "admin-1",
    created_at: "2026-10-10T00:00:00.000Z",
  };
}

describe("PATCH transfer progress", () => {
  beforeEach(() => {
    mutateMock.mockReset();
  });

  test("does not overwrite a transfer already waiting for approval", async () => {
    const current = transferDocument("WAITING_APPROVAL", '{"current_step":4,"sku":"SKU-1"}');
    mutateMock.mockImplementation(async (_id: string, mutator: DocumentMutator) => {
      const updates = await mutator(current);
      expect(updates).toBeNull();
      return current;
    });

    const response = await PATCH(progressRequest(3) as any, {
      params: Promise.resolve({ id: "doc-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toMatch(/^stock-transfer-progress;dur=/);
    expect(body.data.persisted).toBe(false);
    expect(JSON.parse(current.note).current_step).toBe(4);
  });

  test("merges progress into the existing transfer metadata", async () => {
    const current = transferDocument("PENDING", '{"current_step":1,"sku":"SKU-1"}');
    let capturedUpdates: Partial<Document> | null = null;
    mutateMock.mockImplementation(async (_id: string, mutator: DocumentMutator) => {
      capturedUpdates = await mutator(current);
      return capturedUpdates ? { ...current, ...capturedUpdates } : current;
    });

    const response = await PATCH(progressRequest(3) as any, {
      params: Promise.resolve({ id: "doc-1" }),
    });
    const body = await response.json();
    const metadata = JSON.parse(capturedUpdates?.note || "{}");

    expect(response.status).toBe(200);
    expect(body.data.persisted).toBe(true);
    expect(metadata).toMatchObject({
      sku: "SKU-1",
      current_step: 3,
      current_step_text: "กำลังนำเข้าตำแหน่งปลายทาง",
      last_active_user_id: "staff-1",
    });
  });
});
