import type { NextRequest } from "next/server";

jest.mock("@/server/auth-session", () => ({
  getAuthSession: jest.fn(async () => ({ user: { id: "fixture-admin" } })),
}));
jest.mock("@/server/security", () => ({
  createActorFromSession: jest.fn(async () => ({ id: "fixture-admin", role: "ADMIN" })),
  authorize: jest.fn(),
  PERMISSIONS: { DOCUMENT_APPROVE: "DOCUMENT_APPROVE", EXPRESS_IMPORT_VIEW: "EXPRESS_IMPORT_VIEW" },
}));
jest.mock("@/server/repositories", () => ({ getRepository: jest.fn() }));
jest.mock("@/server/locking", () => ({
  withStockLocks: async (_keys: string[], callback: () => Promise<unknown>) => callback(),
  formatStockLockKey: () => "fixture-lock",
}));
jest.mock("@/server/audit", () => ({ logAudit: jest.fn(async () => null) }));
jest.mock("@/server/document-status-store", () => ({ setDocumentStatus: jest.fn() }));
jest.mock("@/server/idempotency", () => ({}));
jest.mock("@/app/api/express-import/status/route", () => ({ expressStatusMap: new Map() }));
jest.mock("@/server/google-sheets/client", () => ({
  SHEETS: { PRODUCTS: "PRODUCTS", EXPRESS_RECEIVE: "ExpressReceive" },
  getWarehouseSheetName: (id: string) => id,
  readSheet: jest.fn(),
  appendRows: jest.fn(),
}));

import { getRepository } from "@/server/repositories";
import { appendRows, readSheet, SHEETS } from "@/server/google-sheets/client";
import { expressStatusMap } from "@/app/api/express-import/status/route";
import { POST as approve } from "@/app/api/approvals/[id]/approve/route";
import { GET as receiveExpress } from "@/app/api/express-import/receive/route";

function makeDocument(lineCount = 2) {
  const lines = Array.from({ length: lineCount }, (_, index) => ({
    product_id: `prod-SKU${index}`, location_id: `A${index + 1}`, qty: index + 3,
  }));
  return {
    document_id: "fixture-document", document_no: "RCV-FIXTURE-001", document_type: "RECEIVE",
    reference_no: "", document_date: "2026-10-06", status: "PENDING",
    created_by: "fixture-staff", created_at: "2026-10-06T09:09:51.122Z",
    note: JSON.stringify({
      warehouse_id: "wh-01", target_sheet: "โกดัง1", lines,
      rows: lines.map((line, index) => [
        `SKU${index}`, line.location_id, "12345678", `Fixture ${index}`, line.qty, "โกดัง1", "-", "",
      ]),
    }),
  };
}

type FixtureDocument = ReturnType<typeof makeDocument>;
let documents: FixtureDocument[];
let sheetRows: unknown[][];
let repository: ReturnType<typeof createRepository>;

function createRepository() {
  return {
    documents: {
      findAll: jest.fn(async () => ({ data: structuredClone(documents), total: documents.length })),
      findById: jest.fn(async (id: string) => structuredClone(documents.find(doc => doc.document_id === id) || null)),
      findByNo: jest.fn(async (no: string) => structuredClone(documents.find(doc => doc.document_no === no) || null)),
      updateStatus: jest.fn(async (id: string, status: string) => {
        documents.find(doc => doc.document_id === id)!.status = status;
      }),
      updateNote: jest.fn(async (id: string, note: string) => {
        documents.find(doc => doc.document_id === id)!.note = note;
      }),
    },
    products: {
      findById: jest.fn(async (id: string) => ({
        product_id: id, sku: id.replace(/^prod-/, ""), barcode: "12345678",
        product_name: `Fixture ${id.replace(/^prod-SKU/, "")}`,
      })),
      findBySku: jest.fn(async () => null),
    },
    locations: {
      findAll: jest.fn(async () => [
        { location_id: "loc-a1", location_code: "1K14-1A", warehouse_id: "wh-01" },
      ]),
    },
    movements: {
      findByDocumentId: jest.fn(async () => [] as unknown[]),
      batchCreate: jest.fn(async (rows: unknown[]) => rows),
    },
    stockSummary: { applyChanges: jest.fn(async () => {}) },
    warehouseSync: { syncAdd: jest.fn(async () => {}) },
    audit: {},
  };
}

async function queue() {
  const response = await receiveExpress(new Request("http://fixture/express") as NextRequest);
  return { response, json: await response.json() };
}

function approveFixture() {
  return approve(new Request("http://fixture/approve", { method: "POST", body: "{}" }) as NextRequest, {
    params: Promise.resolve({ id: documents[0].document_id }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  documents = [makeDocument()];
  sheetRows = [];
  repository = createRepository();
  jest.mocked(getRepository).mockReturnValue(repository as unknown as ReturnType<typeof getRepository>);
  jest.mocked(readSheet).mockReset().mockImplementation(async name =>
    name === SHEETS.EXPRESS_RECEIVE ? sheetRows.map(row => row.map(String)) : []);
  jest.mocked(appendRows).mockReset().mockImplementation(async (name, rows) => {
    expect(name).toBe(SHEETS.EXPRESS_RECEIVE);
    sheetRows.push(...rows);
    return undefined as never;
  });
  expressStatusMap.clear();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test("approval registers Express before any warehouse sync and does not duplicate stock on a repeated click", async () => {
  expect((await queue()).json.data).toHaveLength(0);
  repository.warehouseSync.syncAdd.mockImplementation(async () => {
    expect(sheetRows).toHaveLength(2);
    expect(JSON.parse(documents[0].note).express_tag).toBe("นำเข้าสินค้าเข้าExpress");
  });
  expect((await approveFixture()).status).toBe(200);
  expect((await queue()).json.data).toHaveLength(2);
  expect((await approveFixture()).status).toBe(409);
  expect(repository.movements.batchCreate).toHaveBeenCalledTimes(1);
  expect(repository.stockSummary.applyChanges).toHaveBeenCalledTimes(1);
  expect(appendRows).toHaveBeenCalledTimes(1);
});

test("all 19 lines are visible while warehouse sync is interrupted, even when both Express writes failed", async () => {
  documents = [makeDocument(19)];
  jest.mocked(appendRows).mockRejectedValueOnce(new Error("simulated sheet failure"));
  repository.documents.updateNote.mockRejectedValueOnce(new Error("simulated metadata failure"));
  let signalStarted!: () => void;
  let releaseSync!: () => void;
  const syncStarted = new Promise<void>(resolve => { signalStarted = resolve; });
  const syncBarrier = new Promise<void>(resolve => { releaseSync = resolve; });
  repository.warehouseSync.syncAdd.mockImplementationOnce(async () => {
    signalStarted();
    await syncBarrier;
  });
  const pendingApproval = approveFixture();
  await syncStarted;
  try {
    expect(documents[0].status).toBe("POSTED");
    expect(sheetRows).toHaveLength(0);
    expect(JSON.parse(documents[0].note).express_tag).toBeUndefined();
    // Clearing process memory models a new serverless instance after a timeout.
    expressStatusMap.clear();
    const { json } = await queue();
    expect(json.data).toHaveLength(19);
    expect(json.data.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0))
      .toBe(JSON.parse(documents[0].note).rows.reduce((sum: number, row: unknown[]) => sum + Number(row[4]), 0));
    expect(json.data.every((item: { status: string }) => item.status === "PENDING")).toBe(true);
  } finally {
    releaseSync();
    await pendingApproval;
  }
});

test.each(["POSTED", "APPROVED", "COMPLETED"])("%s receipts appear without Express metadata or sheet rows", async status => {
  documents[0].status = status;
  const { json } = await queue();
  expect(json.data).toHaveLength(2);
  expect(json.data[0].document_no).toBe(documents[0].document_no);
});

test("a retry that reconciles previously created movements also leaves the receipt in the Express queue", async () => {
  repository.movements.findByDocumentId.mockResolvedValueOnce([{ movement_id: "existing" }]);
  expect((await approveFixture()).status).toBe(200);
  expressStatusMap.clear();
  expect((await queue()).json.data).toHaveLength(2);
  expect(repository.movements.batchCreate).not.toHaveBeenCalled();
  expect(repository.stockSummary.applyChanges).not.toHaveBeenCalled();
  expect(repository.warehouseSync.syncAdd).not.toHaveBeenCalled();
});

test.each(["PENDING", "DRAFT", "PROCESSING", "REJECTED", "CANCELLED"])("%s documents stay out of the queue, including stale sheet rows", async status => {
  documents[0].status = status;
  sheetRows = [["SKU0", "A1", documents[0].document_no, "โกดัง1", "2026-10-06", "Fixture 0", "รอนำเข้า Express", 3, "12345678"]];
  expect((await queue()).json.data).toHaveLength(0);
});

test("plans, transfers and legacy production receipts do not become Express receive items", async () => {
  const plan = { ...makeDocument(), document_id: "plan", document_no: "PLN-001", document_type: "RECEIVE_PLAN", status: "COMPLETED" };
  const transfer = { ...makeDocument(), document_id: "transfer", document_no: "TRF-001", document_type: "TRANSFER", status: "POSTED" };
  const production = { ...makeDocument(), document_id: "production", document_no: "PRD-001", status: "POSTED" };
  documents = [plan, transfer, production];
  expect((await queue()).json.data).toHaveLength(0);
});

test("a partially written sheet preserves split locations and repeated allocations of the same SKU", async () => {
  documents[0].status = "POSTED";
  documents[0].note = JSON.stringify({ target_sheet: "โกดัง1", rows: [
    ["SKU0", "A1", "12345678", "Fixture 0", 3],
    ["SKU0", "A1", "12345678", "Fixture 0", 3],
    ["SKU0", "B1", "12345678", "Fixture 0", 4],
  ] });
  sheetRows = [["SKU0", "A1", documents[0].document_no, "โกดัง1", "2026-10-06", "Fixture 0", "รอนำเข้า Express", 3, "12345678"]];
  const { json } = await queue();
  expect(json.data).toHaveLength(3);
  expect(json.data.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0)).toBe(10);
});

test("one receipt shown by both Express and document sources matches a location ID to its code", async () => {
  documents = [makeDocument(1)];
  documents[0].status = "POSTED";
  documents[0].note = JSON.stringify({ warehouse_id: "wh-01", target_sheet: "โกดัง1", rows: [
    ["ทดสอบ1", "1K14-1A", "12345678", "5678ทดสอบ", 1],
  ] });
  sheetRows = [["ทดสอบ1", "loc-a1", documents[0].document_no, "โกดัง1", "2026-10-13", "5678ทดสอบ", "รอนำเข้า Express", 1, "12345678"]];
  const { response, json } = await queue();
  expect(response.status).toBe(200);
  expect(json.data).toHaveLength(1);
  expect(json.data[0]).toMatchObject({ sku: "ทดสอบ1", quantity: 1, location: "1K14-1A" });
});

test("location aliases still preserve two real allocations of the same SKU", async () => {
  documents[0].status = "POSTED";
  documents[0].note = JSON.stringify({ target_sheet: "โกดัง1", rows: [
    ["SKU0", "1K14-1A", "12345678", "Fixture 0", 3],
    ["SKU0", "B1", "12345678", "Fixture 0", 3],
  ] });
  sheetRows = [["SKU0", "loc-a1", documents[0].document_no, "โกดัง1", "2026-10-06", "Fixture 0", "รอนำเข้า Express", 3, "12345678"]];
  const { json } = await queue();
  expect(json.data).toHaveLength(2);
  expect(json.data.map((item: { location: string }) => item.location).sort()).toEqual(["1K14-1A", "B1"]);
  expect(json.data.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0)).toBe(6);
});

test("an explicit A1 location is preserved even if the catalog suggests a different shelf", async () => {
  documents = [makeDocument(1)];
  documents[0].status = "POSTED";
  jest.mocked(readSheet).mockImplementation(async name => name === "wh-01"
    ? [["SKU0", "12345678", "Fixture 0", "", "", "", "OTHER-SHELF"]]
    : []);
  expect((await queue()).json.data[0].location).toBe("A1");
});

test("equal location codes in different warehouses are not merged", async () => {
  documents = [makeDocument(1)];
  documents[0].status = "POSTED";
  sheetRows = [["SKU0", "A1", documents[0].document_no, "โกดัง2", "2026-10-06", "Fixture 0", "รอนำเข้า Express", 3, "12345678"]];
  const { json } = await queue();
  expect(json.data).toHaveLength(2);
  expect(json.data.map((item: { warehouse_id: string }) => item.warehouse_id).sort()).toEqual(["wh-01", "wh-02"]);
});

test("a failed authoritative document read returns an error instead of a misleading empty queue", async () => {
  repository.documents.findAll.mockRejectedValueOnce(new Error("simulated read failure"));
  const { response, json } = await queue();
  expect(response.status).toBe(500);
  expect(json.success).toBe(false);
});

test("a failed Express sheet read preserves each SKU's saved import status in the document fallback", async () => {
  documents[0].status = "POSTED";
  const meta = JSON.parse(documents[0].note);
  meta.express_items = { sku0: "IMPORTED", sku1: "PENDING" };
  documents[0].note = JSON.stringify(meta);
  jest.mocked(readSheet).mockImplementation(async name => {
    if (name === SHEETS.EXPRESS_RECEIVE) throw new Error("simulated Express read failure");
    return [];
  });
  const { json } = await queue();
  expect(json.data).toHaveLength(2);
  expect(json.data.find((item: { sku: string }) => item.sku === "SKU0").status).toBe("IMPORTED");
  expect(json.data.find((item: { sku: string }) => item.sku === "SKU1").status).toBe("PENDING");
});
