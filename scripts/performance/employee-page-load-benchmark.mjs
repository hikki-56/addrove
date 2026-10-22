import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

// Runs the actual warehouse-data callback with synthetic HTTP responses.
// React rendering, authentication, network, Sheets, and browser painting are excluded.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const samples = process.argv.includes("--quick") ? 1 : 3;
const reportPath = path.join(root, "artifacts/performance/employee-page-load-benchmark.json");
const originalGlobals = Object.fromEntries(
  ["window", "localStorage", "sessionStorage", "fetch"].map((key) => [key, globalThis[key]])
);

function compile(relativeFile, requireModule) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, relativeFile), "utf8"), {
    fileName: relativeFile,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  assert.equal(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  const exports = {};
  vm.runInThisContext(`(function(exports, require){${result.outputText}\n})`, {
    filename: relativeFile,
  })(exports, requireModule);
  return exports;
}

function installStorage() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = { location: { search: "" }, localStorage: storage, sessionStorage: storage, setTimeout, clearTimeout };
  globalThis.localStorage = storage;
  globalThis.sessionStorage = storage;
}

installStorage();
const warehouse = compile("src/lib/warehouse-utils.ts", (name) => { throw new Error(`Unexpected import: ${name}`); });

function createHook(options) {
  const states = [];
  const reactBoundary = {
    useState: (initial) => {
      const index = states.length;
      states.push(typeof initial === "function" ? initial() : initial);
      return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useCallback: (callback) => callback,
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
  };
  const { useWarehouseData: createWarehouseData } = compile("src/hooks/use-warehouse-data.ts", (name) => {
    if (name === "react") return reactBoundary;
    if (name === "@/lib/warehouse-utils") return warehouse;
    throw new Error(`Unexpected import: ${name}`);
  });
  return { hook: createWarehouseData({ initialWarehouseId: "wh-01", ...options }), states };
}

function installSyntheticFetch({ productRows, delays, productPrefix = "product", failProducts = false }) {
  const calls = [];
  const products = Array.from({ length: productRows }, (_, index) => ({
    product_id: `${productPrefix}-${index}`, sku: `SKU-${index}`, barcode: `TEST-${index}`,
    product_name: `Synthetic product ${index}`, warehouse_id: "wh-01", location: "TEST-A1",
    quantity: 1000, base_unit: "piece", active: true,
  }));
  const payloads = {
    "/api/warehouses": JSON.stringify({ success: true, data: [{ warehouse_id: "wh-01", warehouse_name: "โกดัง1", active: true }] }),
    "/api/locations": JSON.stringify({ success: true, data: [{ location_id: "TEST-A1", warehouse_id: "wh-01", active: true }] }),
    "/api/products": JSON.stringify({ success: true, data: products }),
  };
  globalThis.fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const endpoint = new URL(url, "https://synthetic.invalid").pathname;
    assert.ok(Object.hasOwn(payloads, endpoint), `Unexpected request: ${url}`);
    const started = performance.now();
    const call = { endpoint, start_ms: started, duration_ms: 0, bytes: Buffer.byteLength(payloads[endpoint]), aborted: false };
    calls.push(call);
    let timer;
    const abort = () => {
      clearTimeout(timer);
      call.aborted = true;
      call.duration_ms = performance.now() - started;
      reject(init.signal?.reason ?? new Error("Aborted"));
    };
    if (init.signal?.aborted) return abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      init.signal?.removeEventListener("abort", abort);
      call.duration_ms = performance.now() - started;
      resolve(new Response(payloads[endpoint], { status: endpoint === "/api/products" && failProducts ? 503 : 200 }));
    }, delays[endpoint] ?? 0);
  });
  return calls;
}

const round = (value) => Number(value.toFixed(2));
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.ceil(sorted.length * fraction) - 1]);
}

async function measureProfile({ name, loadLocations, productRows, delays }) {
  const runs = [];
  for (let repeat = 0; repeat < samples; repeat++) {
    const calls = installSyntheticFetch({ productRows, delays });
    const { hook, states } = createHook({ loadLocations });
    const started = performance.now();
    await hook.refreshData();
    const duration = performance.now() - started;
    assert.equal(states[3].length, productRows, "Products must be loaded completely");
    assert.equal(states[4], false, "Loading must finish");
    assert.equal(states[5], null, "Successful data load must not produce an error");
    assert.equal(calls.length, loadLocations ? 3 : 2);
    assert.equal(calls.some((call) => call.endpoint === "/api/locations"), loadLocations);
    runs.push({ duration_ms: round(duration), calls: calls.map((call) => ({ ...call, start_ms: round(call.start_ms - started), duration_ms: round(call.duration_ms) })) });
  }
  return {
    name, product_rows: productRows, injected_endpoint_delay_ms: delays, samples,
    request_count: runs[0].calls.length,
    response_bytes: runs[0].calls.reduce((sum, call) => sum + call.bytes, 0),
    data_ready_p50_ms: percentile(runs.map((run) => run.duration_ms), 0.5),
    data_ready_p95_ms: percentile(runs.map((run) => run.duration_ms), 0.95),
    runs,
  };
}

async function verifyFailureAndCancellation() {
  installSyntheticFetch({ productRows: 1, delays: {}, failProducts: true });
  const failed = createHook({ loadLocations: false });
  await failed.hook.refreshData();
  assert.equal(failed.states[4], false);
  assert.match(failed.states[5], /โหลดสินค้าไม่สำเร็จ/);
  assert.equal(failed.states[3].length, 0);

  const oldCalls = installSyntheticFetch({ productRows: 2, delays: { "/api/products": 50 }, productPrefix: "old" });
  const replacement = createHook({ loadLocations: false });
  const oldRequest = replacement.hook.refreshData();
  installSyntheticFetch({ productRows: 3, delays: {}, productPrefix: "latest" });
  const newRequest = replacement.hook.refreshData();
  await Promise.all([oldRequest, newRequest]);
  assert.equal(oldCalls.filter((call) => call.aborted).length, 2);
  assert.equal(replacement.states[3].length, 3);
  assert.equal(replacement.states[3][0].product_id, "latest-0");
  assert.equal(replacement.states[4], false);
  assert.equal(replacement.states[5], null);
  return ["HTTP failure clears loading and exposes an error", "Cancelled response cannot overwrite the newer request"];
}

try {
  const profiles = [];
  for (const productRows of [10, 1000, 10000]) {
    for (const scenario of ["normal", "slow-locations"]) {
      const delays = { "/api/warehouses": 8, "/api/locations": scenario === "normal" ? 12 : 150, "/api/products": 20 };
      for (const loadLocations of [true, false]) {
        profiles.push(await measureProfile({ name: `${loadLocations ? "receive-move" : "employee-transfer"}:${scenario}`, loadLocations, productRows, delays }));
      }
    }
  }
  const checks = await verifyFailureAndCancellation();
  const report = {
    mode: "simulation", generated_at_utc: new Date().toISOString(),
    measured_code: "src/hooks/use-warehouse-data.ts: refreshData", profiles, checks,
    limitations: [
      "Synthetic latency and synthetic response data; these numbers are not production timings.",
      "Executes the real hook callback with a React boundary stub; excludes rendering, effects, widgets, authentication, real HTTP and Google Sheets.",
      "Response bytes represent synthetic JSON payloads, not production compressed network traffic.",
      "Three samples (one in quick mode); percentiles describe this deterministic experiment only.",
    ],
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log("Synthetic employee page-data benchmark (not browser or production timings)");
  console.table(profiles.map(({ name, product_rows, request_count, data_ready_p50_ms, data_ready_p95_ms }) => ({ name, product_rows, request_count, data_ready_p50_ms, data_ready_p95_ms })));
  console.log(`PASS: ${profiles.length} profiles; ${checks.length} failure/cancellation checks. Report: ${reportPath}`);
} finally {
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
}
