import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { loadBenchmarkSource, root } from "./load-benchmark-source.mjs";

const require = createRequire(`${root}/package.json`);
const ts = require("typescript");
const checks = [];
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
function load(relative, dependencies, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(`${root}/${relative}`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ module, exports: module.exports,
    require: name => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Blocked import in regression harness: ${name}`);
    }, console, Buffer, Date, JSON, Promise, Error, performance, Response, setTimeout, clearTimeout,
    fetch: (...args) => globalThis.fetch(...args), process: { env: {} }, ...globals,
  });
  vm.runInContext(source, context, { filename: relative });
  return module.exports;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const note = { sku: "TEST-SKU", qty: 4, custom: "keep", current_step: 1 };
function row() { return ["fixture-doc", "TRF-fixture", "TRANSFER", "", "2026-10-12", "PENDING", JSON.stringify(note), "fixture-admin", "2026-10-12T00:00:00Z"]; }

try {
  const { createTransferStockSnapshot } = load("src/client/transfer-stock-snapshot.ts", {});
  let now = 1000;
  Date.now = () => now;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ success: true, data: [{ sku: "TEST-SKU", quantity: 4 }] }); };
  const snapshot = createTransferStockSnapshot();
  await Promise.all(Array.from({ length: 100 }, () => snapshot.get("wh-01")));
  assert.equal(calls, 1);
  await snapshot.get("wh-02"); assert.equal(calls, 2);
  now += 10_001;
  await snapshot.get("wh-01"); assert.equal(calls, 3);
  snapshot.clear(); await snapshot.get("wh-01"); assert.equal(calls, 4);
  snapshot.clear();
  globalThis.fetch = async () => Response.json({ success: false }, { status: 503 });
  await assert.rejects(snapshot.get("wh-01"));
  globalThis.fetch = async () => Response.json({ success: true, data: { items: [] } });
  assert.equal((await snapshot.get("wh-01")).length, 0);
  checks.push("100 concurrent stock reads share one request; warehouse isolation, TTL, clear and failed-request retry pass");
  Date.now = originalNow;

  let stored = row();
  let progressBarrier;
  let progressStarted;
  let progressWrites = 0;
  const sheets = {
    SHEETS: { DOCUMENTS: "Documents" },
    readSheet: async (_sheet, range) => { assert.equal(range, "A2:J"); return [[...stored]]; },
    appendRows: () => { throw new Error("No append permitted"); },
    clearSheetCache: () => {},
    updateRow: async (_sheet, rowNumber, values) => {
      assert.equal(rowNumber, 2); assert.equal(values.length, 9);
      stored.splice(0, 9, ...values);
    },
    updateDocumentProgressCell: async (rowNumber, value) => {
      assert.equal(rowNumber, 2); progressWrites++;
      progressStarted?.resolve();
      if (progressBarrier) await progressBarrier.promise;
      stored[9] = value;
    },
  };
  const locking = load("src/server/keyed-lock.ts", { async_hooks: require("node:async_hooks") });
  const { SheetsDocumentRepository } = load("src/server/repositories/sheets/document.repository.ts", {
    "@/server/google-sheets/client": sheets, "@/server/keyed-lock": locking,
    "@/lib/id": { generateUuid: () => "fixture-only" },
  });
  const repo = new SheetsDocumentRepository();
  let configuredDocuments = repo;
  const progressRoute = load("src/app/api/movements/transfer/[id]/progress/route.ts", {
    "@/server/auth-session": { getAuthSession: async () => ({ user: { id: "fixture-staff" } }) },
    "@/server/security": { createActorFromSession: async () => ({ id: "fixture-staff", role: "WAREHOUSE_STAFF" }) },
    "@/server/repositories": { getRepository: () => ({ documents: configuredDocuments }) },
    "@/server/api-response": {
      successResponse: data => Response.json({ success: true, data }),
      unauthorizedResponse: () => new Response(null, { status: 401 }),
      forbiddenResponse: () => new Response(null, { status: 403 }),
      notFoundResponse: () => new Response(null, { status: 404 }),
      serverErrorResponse: error => Response.json({ error: error.message }, { status: 500 }),
    },
    "@/server/stock-workflow-timing": { finishStockWorkflowTiming: response => response },
  });
  const progress = step => progressRoute.PATCH(new Request("http://fixture/progress", {
    method: "PATCH", body: JSON.stringify({ step }),
  }), { params: Promise.resolve({ id: "fixture-doc" }) });
  const { submitTransferMove } = loadBenchmarkSource("src/server/services/stock/transfer-stock.ts");
  const submit = () => submitTransferMove({ repo: { documents: repo } }, "fixture-doc", {
    fromLocationId: "SOURCE-A1", toLocationId: "DEST-A2",
    sourceAllocations: [{ location_id: "SOURCE-A1", qty: 4 }], userId: "fixture-staff",
  });
  const first = await progress(2);
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(stored[6]).current_step, 1, "Progress must never write business note G");
  assert.equal(JSON.parse((await repo.findById("fixture-doc")).note).current_step, 2);
  checks.push("Actual progress route uses isolated persistence; readers show pending progress without changing business note");

  stored = row(); progressBarrier = deferred(); progressStarted = deferred();
  const lateProgress = progress(3);
  await progressStarted.promise;
  // Progress is paused at its write. Submission must complete before releasing it.
  let timeout;
  let submitted;
  try {
    submitted = await Promise.race([submit(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Submission was blocked by the progress write")), 1000);
    })]);
  } finally { clearTimeout(timeout); progressBarrier.resolve(); }
  assert.equal(submitted.status, "WAITING_APPROVAL");
  progressBarrier.resolve();
  assert.equal((await lateProgress).status, 200);
  progressBarrier = null; progressStarted = null;
  const final = await repo.findById("fixture-doc", { forceFresh: true });
  const finalNote = JSON.parse(final.note);
  assert.equal(final.status, "WAITING_APPROVAL");
  assert.equal(finalNote.current_step, 4);
  assert.equal(finalNote.sku, "TEST-SKU"); assert.equal(finalNote.custom, "keep");
  assert.equal(finalNote.to_location_id, "DEST-A2");
  assert.equal(finalNote.source_allocations[0].qty, 4);
  const priorWrites = progressWrites;
  await progress(2); assert.equal(progressWrites, priorWrites);
  checks.push("Late progress write after actual submit preserves WAITING_APPROVAL, step 4, SKU, custom metadata and allocations");

  for (const status of ["WAITING_APPROVAL", "COMPLETED", "CANCELLED", "REJECTED"]) {
    stored[5] = status;
    assert.equal(JSON.parse((await repo.findById("fixture-doc")).note).current_step, 4);
  }
  stored = row(); stored[9] = "existing unrelated data";
  assert.equal((await progress(3)).status, 500);
  assert.equal(stored[9], "existing unrelated data");
  checks.push("Terminal documents ignore old progress; an occupied column J is rejected without overwriting it");
  configuredDocuments = { mutate() { throw new Error("Whole-row fallback must not be called"); } };
  const unsupported = await progress(3);
  assert.equal(unsupported.status, 500);
  assert.match((await unsupported.json()).error, /does not support isolated/);
  configuredDocuments = repo;
  checks.push("An unsupported repository rejects progress rather than falling back to a whole-row write");

  // Exercise the real Google API transport, not just a repository stub.
  const apiCalls = [];
  const api = { spreadsheets: {
    get: async () => ({ data: { sheets: [{ properties: { title: "Documents", sheetId: 1 } }] } }),
    values: { update: async request => { apiCalls.push(request); return {}; } },
  } };
  const signingEnv = { GOOGLE_SCRIPT_URL: "https://fixture.invalid", GOOGLE_SCRIPT_SIGNING_SECRET: "fixture-secret-used-only-in-tests-1234567890", GOOGLE_SCRIPT_LEGACY_MODE: "true" };
  const signer = load("src/server/google-sheets/script-signer.ts", { crypto: require("node:crypto") }, { process: { env: signingEnv } });
  const clientEnv = { GOOGLE_SERVICE_ACCOUNT_EMAIL: "fixture@example.invalid", GOOGLE_PRIVATE_KEY: "fixture", GOOGLE_SPREADSHEET_ID: "fixture" };
  const client = load("src/server/google-sheets/client.ts", {
    googleapis: { google: { auth: { GoogleAuth: class {} }, sheets: () => api } },
    "./script-signer": signer,
  }, { process: { env: clientEnv } });
  const progressJson = JSON.stringify({ kind: "stockify-transfer-progress-v1", current_step: 3, current_step_text: "fixture" });
  await client.updateDocumentProgressCell(2, progressJson);
  assert.equal(apiCalls.length, 1); assert.match(apiCalls[0].range, /!J2$/);
  assert.equal(apiCalls[0].requestBody.values[0].length, 1);
  assert.equal(apiCalls[0].valueInputOption, "RAW");
  checks.push("Actual Google API transport writes only J2 with RAW input");

  delete clientEnv.GOOGLE_PRIVATE_KEY;
  let payload;
  globalThis.fetch = async (_url, request) => {
    const envelope = JSON.parse(request.body);
    assert.equal(typeof envelope.signature, "string", "Isolated progress must be signed even in legacy mode");
    payload = JSON.parse(envelope.payload);
    return Response.json({ success: true });
  };
  await client.updateDocumentProgressCell(2, progressJson);
  assert.equal(payload.action, "updateDocumentProgress");
  globalThis.fetch = async () => Response.json({ success: false, error: "ACTION_DENIED" });
  await assert.rejects(client.updateDocumentProgressCell(2, progressJson), /ACTION_DENIED/);
  checks.push("Apps Script transport signs the isolated action; old backend rejection fails without whole-row fallback");

  // Load the actual Apps Script helpers against a fixture spreadsheet.
  let cell = "";
  const gasContext = vm.createContext({ console, JSON, Date, Math, isFinite,
    Utilities: { newBlob: value => ({ getBytes: () => Array.from(Buffer.from(value)) }) },
    SpreadsheetApp: { flush() {}, getActiveSpreadsheet: () => ({ getSheetByName: () => ({
      getLastRow: () => 2, getMaxColumns: () => 26,
      getRange: (r, c) => {
        assert.equal(r, 2); assert.equal(c, 10);
        return { getValue: () => cell, setValue: value => { cell = value; } };
      },
    }) }) },
  });
  const appsScriptArgument = process.argv.indexOf("--apps-script");
  const appsScriptSource = appsScriptArgument >= 0 ? process.argv[appsScriptArgument + 1] : `${root}/scripts/google-apps-script.gs`;
  if (!appsScriptSource) throw new Error("--apps-script requires a source file path");
  vm.runInContext(fs.readFileSync(appsScriptSource, "utf8"), gasContext);
  gasContext.validatePayload(payload);
  gasContext.doUpdateDocumentProgress(payload);
  assert.equal(cell, progressJson);
  cell = "prior unrelated value";
  assert.throws(() => gasContext.doUpdateDocumentProgress(payload));
  assert.equal(cell, "prior unrelated value");
  for (const invalid of [{ ...payload, sheetName: "Users" }, { ...payload, rowNumber: 1 }, { ...payload, progress: JSON.stringify({ kind: "stockify-transfer-progress-v1", current_step: 4 }) }]) {
    assert.throws(() => gasContext.validatePayload(invalid));
    assert.throws(() => signer.validateMutationPayload(invalid));
  }
  checks.push("Actual Apps Script writes column J only, rejects occupied cells, other sheets, headers and invalid steps");

  fs.mkdirSync(`${root}/artifacts/performance`, { recursive: true });
  fs.writeFileSync(`${root}/artifacts/performance/employee-performance-regressions.json`, JSON.stringify({
    mode: "isolated-regressions", generated_at_utc: new Date().toISOString(), passed: true, checks,
    limitations: ["All Sheets, HTTP, authentication and Apps Script platform services are synthetic; no production records or network used."],
  }, null, 2) + "\n");
  console.log(`PASS: ${checks.length} employee performance regression groups (isolated fixtures).`);
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
}
