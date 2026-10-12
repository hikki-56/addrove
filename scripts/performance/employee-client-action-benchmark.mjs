import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

// Execute callbacks extracted from current source, with synthetic state/network.
// No production requests, React rendering, or real barcode hardware is involved.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const quick = process.argv.includes("--quick");
const reportPath = path.join(root, "artifacts/performance/employee-client-action-benchmark.json");
const profiles = [];
const timers = new Set();
const originalGlobals = Object.fromEntries(["fetch", "window", "localStorage", "sessionStorage"].map((key) => [key, globalThis[key]]));
const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
globalThis.window = { location: { search: "" }, localStorage: storage, sessionStorage: storage, dispatchEvent: () => true };
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
const round = (number) => Number(number.toFixed(2));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function transpile(source, fileName) {
  return ts.transpileModule(source, { fileName, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
}
function moduleFromSource(relative, requireModule) {
  const exports = {};
  vm.runInThisContext(`(function(exports,require){${transpile(fs.readFileSync(path.join(root, relative), "utf8"), relative)}\n})`)(exports, requireModule);
  return exports;
}
const warehouse = moduleFromSource("src/lib/warehouse-utils.ts", (name) => { throw new Error(`Unexpected import: ${name}`); });
const notifications = moduleFromSource("src/lib/transfer-notification-utils.ts", (name) => {
  if (name === "./warehouse-utils") return warehouse;
  throw new Error(`Unexpected import: ${name}`);
});
const { createTransferStockSnapshot } = moduleFromSource("src/client/transfer-stock-snapshot.ts", (name) => { throw new Error(`Unexpected import: ${name}`); });

function sourceCallback(relative, name, context) {
  const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), "utf8"), ts.ScriptTarget.Latest, true);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      assert.ok(!initializer, `Ambiguous callback: ${name}`);
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(initializer && ts.isArrowFunction(initializer), `Callback missing: ${name}`);
  const js = transpile(`(${initializer.getText(source)})`, `${name}.ts`);
  return vm.runInContext(js, vm.createContext(context), { filename: `${relative}:${name}` });
}

function boundary() {
  const context = {
    console, Promise, Error, TypeError, Response, JSON, window: globalThis.window, localStorage: storage, sessionStorage: storage,
    normalizeWarehouseId: warehouse.normalizeWarehouseId,
    getDefaultLocationsForWarehouse: warehouse.getDefaultLocationsForWarehouse,
    whenTransferProgressSettled: notifications.whenTransferProgressSettled,
    markTransferWaitingApproval: notifications.markTransferWaitingApproval,
    selectedTask: { id: `fixture-${profiles.length}`, sku: "TEST-SKU", qty: 1, from_warehouse_id: "wh-01", to_warehouse_id: "wh-02", from_warehouse_name: "โกดัง1", to_warehouse_name: "โกดัง2", status: "PENDING" },
    sourceAllocations: [], sourceLocations: [], destLocations: [{ location_id: "DEST-A1", location_code: "DEST-A1", warehouse_id: "wh-02" }],
    scannedToLocation: "DEST-A1", scannedFromLocation: "", staffScanDestLocationInput: "",
    tabUser: { id: "fixture-staff", name: "Synthetic employee" }, isSubmittingTransfer: false,
    isStepTransitioningRef: { current: false }, staffError: "", staffSuccess: "", pendingTasks: [],
    sourceStockSnapshotRef: { current: createTransferStockSnapshot() },
    setTimeout: (callback, ms) => { const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms); timers.add(timer); return timer; },
  };
  for (const [setter, state] of Object.entries({ setStaffError: "staffError", setStaffSuccess: "staffSuccess", setSourceAllocations: "sourceAllocations", setScannedFromLocation: "scannedFromLocation", setStaffScanSourceLocationInput: "staffScanSourceLocationInput", setIsSubmittingTransfer: "isSubmittingTransfer", setPendingTasks: "pendingTasks", setStaffStep: "staffStep" })) {
    context[setter] = (next) => { context[state] = typeof next === "function" ? next(context[state]) : next; };
  }
  return context;
}

async function receiveProfile(lines, quantity) {
  let submitted = false;
  let refreshed = 0;
  let error = "";
  let body;
  let requestStart;
  const started = performance.now();
  const context = {
    JSON, Error, TypeError, console, window: globalThis.window, localStorage: storage,
    locationInputs: {}, user: { name: "Synthetic employee" }, activePlan: null, RECEIVE_DRAFT_KEY: "fixture-draft",
    setError: (value) => { error = value; }, setConfirmModalOpen: () => {}, setSuccessMessage: () => {},
    setSubmitted: (value) => { submitted = value; }, refreshWarehouseData: () => { refreshed++; },
    fetch: async (url, init) => {
      assert.equal(url, "/api/movements/receive"); assert.equal(init.method, "POST");
      body = JSON.parse(init.body); requestStart = performance.now();
      await sleep(20);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  };
  const callback = sourceCallback("src/features/receive/hooks/use-receive-movement.ts", "onSubmit", context);
  const data = { lines: Array.from({ length: lines }, (_, index) => ({ product_id: `fixture-${index}`, location_id: "SOURCE-A1", qty: quantity, boxes: 1 })), warehouse_id: "wh-01" };
  await callback(data); // Warm the synthetic Response/JIT path outside measurement.
  assert.equal(error, "");
  submitted = false;
  refreshed = 0;
  const actionStarted = performance.now();
  await callback(data);
  assert.equal(error, ""); assert.ok(submitted); assert.equal(refreshed, 1);
  assert.equal(body.lines.length, lines);
  assert.equal(body.lines.reduce((sum, line) => sum + line.qty, 0), lines * quantity);
  profiles.push({ action: "receive-submit-callback", lines, quantity_per_line: quantity, api_calls: 1,
    requested_api_delay_ms: 20, preprocessing_ms: round(requestStart - actionStarted),
    total_ms: round(performance.now() - actionStarted), request_bytes: Buffer.byteLength(JSON.stringify(body)),
    setup_ms_excluded: round(actionStarted - started), passed: true });
}

async function sourceScanProfile(locations, quantity) {
  const context = boundary();
  context.selectedTask.qty = locations * quantity;
  context.sourceLocations = Array.from({ length: locations }, (_, index) => ({ location_id: `A${String(index).padStart(4, "0")}`, location_code: `A${String(index).padStart(4, "0")}`, warehouse_id: "wh-01" }));
  const products = context.sourceLocations.map((location) => ({ sku: "TEST-SKU", location: location.location_code, quantity }));
  let calls = 0;
  context.fetch = async (url) => {
    assert.equal(url, "/api/products?warehouse_id=wh-01"); calls++;
    await sleep(5);
    return new Response(JSON.stringify({ success: true, data: products }), { status: 200 });
  };
  const callback = sourceCallback("src/features/transfer/hooks/use-transfer-movement.ts", "handleVerifySourceLocationBarcode", context);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = context.fetch;
  await callback(context.sourceLocations[0].location_code, quantity);
  assert.equal(context.staffError, "");
  context.sourceAllocations = [];
  context.sourceStockSnapshotRef.current.clear();
  calls = 0;
  const started = performance.now();
  for (const location of context.sourceLocations) await callback(location.location_code, quantity);
  assert.equal(context.staffError, "");
  assert.equal(context.sourceAllocations.length, locations);
  assert.equal(context.sourceAllocations.reduce((sum, allocation) => sum + allocation.qty, 0), locations * quantity);
  assert.equal(calls, 1, "All scans within the snapshot window share one stock request");
  profiles.push({ action: "transfer-source-scan-callback", locations, quantity_per_location: quantity,
    api_calls: calls, requested_api_delay_ms: 5, total_ms: round(performance.now() - started), passed: true });
  globalThis.fetch = originalFetch;
}

async function transferSubmitProfile(progressDelay) {
  const context = boundary();
  const task = context.selectedTask;
  values.set("stockify_transfer_notifications", JSON.stringify([task]));
  let submitStarted;
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ path: url, method: init.method });
    if (url.endsWith("/progress")) { await sleep(progressDelay); }
    else {
      assert.equal(url, `/api/movements/transfer/${task.id}/submit`);
      submitStarted = performance.now(); await sleep(20);
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  globalThis.fetch = fakeFetch;
  context.fetch = fakeFetch;
  if (progressDelay > 0) notifications.updateTransferTaskProgress(task.id, 3);
  const callback = sourceCallback("src/features/transfer/hooks/use-transfer-movement.ts", "handleSubmitTransfer", context);
  const started = performance.now();
  await callback();
  assert.equal(context.staffError, ""); assert.equal(context.staffStep, 4); assert.equal(context.isSubmittingTransfer, false);
  const waitingMs = submitStarted - started;
  assert.ok(waitingMs < 200, "Submit starts without waiting for background progress");
  profiles.push({ action: "transfer-submit-callback", requested_progress_delay_ms: progressDelay,
    pre_submit_wait_ms: round(waitingMs), requested_submit_delay_ms: 20, total_ms: round(performance.now() - started),
    requests, passed: true });
  await notifications.whenTransferProgressSettled(task.id);
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
}

async function sourceScanFailureCheck() {
  const context = boundary();
  context.sourceLocations = [{ location_id: "SOURCE-A1", location_code: "SOURCE-A1", warehouse_id: "wh-01" }];
  const callback = sourceCallback("src/features/transfer/hooks/use-transfer-movement.ts", "handleVerifySourceLocationBarcode", context);
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ success: false }, { status: 503 });
    await callback("SOURCE-A1", 1);
    assert.notEqual(context.staffError, "");
    assert.equal(context.sourceAllocations.length, 0, "Failed stock read must not pretend picking succeeded");
    globalThis.fetch = async () => Response.json({ success: true, data: [{ sku: "TEST-SKU", location: "SOURCE-A1", quantity: 1 }] });
    await callback("SOURCE-A1", 1);
    assert.equal(context.staffError, ""); assert.equal(context.sourceAllocations.length, 1);
  } finally { globalThis.fetch = previousFetch; }
}

try {
  for (const lines of [1, 10, 50, 100]) for (const quantity of [1, 1000]) await receiveProfile(lines, quantity);
  for (const locations of [1, 10, 50, 100]) for (const quantity of [1, 1000]) await sourceScanProfile(locations, quantity);
  for (const progressDelay of quick ? [0, 250] : [0, 250, 8500]) await transferSubmitProfile(progressDelay);
  await sourceScanFailureCheck();
  const report = {
    mode: "synthetic-client-callbacks", generated_at_utc: new Date().toISOString(), profiles,
    checks: ["Failed stock read leaves picks unchanged and can be retried successfully"],
    limitations: [
      "Actual callbacks extracted from current local TypeScript source; dependency/state boundaries are synthetic, not a rendered React/browser test.",
      "All network responses and products are synthetic; no production data is opened or modified.",
      "Source scan iterates synthetic locations programmatically, excluding human and barcode-hardware time.",
      "One sample per profile; requested timer delay can exceed its value because of OS scheduling. No production percentile/SLA claim.",
      "Source scans share a 10-second stock snapshot; the snapshot is cleared after warm-up so measured profiles include one stock request.",
      "Slow background progress is drained after measuring submission; this excluded cleanup does not measure real Apps Script lock contention.",
      "Receive and source-scan callbacks each have one synthetic warm-up invocation excluded from timings and request counts.",
      "Receive refresh is counted but its completion is excluded, matching the callback's non-awaited refresh behavior.",
    ],
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.table(profiles.map(({ action, lines, locations, quantity_per_line, quantity_per_location, api_calls, total_ms, pre_submit_wait_ms }) => ({ action, lines: lines ?? locations ?? 1, quantity: quantity_per_line ?? quantity_per_location ?? 1, api_calls, total_ms, pre_submit_wait_ms })));
  console.log(`PASS: ${profiles.length} actual client callback profiles. Synthetic report: ${reportPath}`);
} finally {
  for (const timer of timers) clearTimeout(timer);
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}
