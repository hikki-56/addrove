import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

// Optional public GET probe. Never submits stock, logs in, or accepts credentials.
// Authenticated employee APIs must be measured separately in the user's browser.
const input = process.argv.find((argument) => argument.startsWith("--url="))?.slice(6);
assert.ok(input, "Pass --url=https://your-app/dashboard?warehouse_id=wh-01");
const target = new URL(input);
assert.equal(target.protocol, "https:", "Use HTTPS for a live probe");
assert.ok(!target.username && !target.password, "Do not include credentials in the URL");
assert.ok([...target.searchParams.keys()].every((key) => ["warehouse_id", "wh"].includes(key)), "Only warehouse query parameters are allowed");
const rounds = process.argv.includes("--quick") ? 1 : 3;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const destination = path.join(root, "artifacts/performance/employee-live-read-benchmark.json");

async function probe() {
  const chain = [];
  let current = target;
  for (let hop = 0; hop < 5; hop++) {
    assert.equal(current.origin, target.origin, "Cross-origin redirects are not followed");
    const started = performance.now();
    const response = await fetch(current, { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const headersReadyMs = performance.now() - started;
    const body = await response.arrayBuffer();
    const elapsedMs = performance.now() - started;
    const location = response.headers.get("location");
    const next = location ? new URL(location, current) : null;
    chain.push({
      path: current.pathname, status: response.status,
      headers_ready_ms: Number(headersReadyMs.toFixed(2)), complete_ms: Number(elapsedMs.toFixed(2)), body_bytes: body.byteLength,
      server_timing: response.headers.get("server-timing"), cache_status: response.headers.get("x-vercel-cache"),
      redirect_path: next?.pathname ?? null,
    });
    if (response.status >= 300 && response.status < 400 && next) { current = next; continue; }
    return { chain, total_ms: Number(chain.reduce((sum, item) => sum + item.complete_ms, 0).toFixed(2)), final_path: current.pathname };
  }
  throw new Error("Too many redirects");
}

const results = [];
for (let round = 0; round < rounds; round++) results.push(await probe());
const report = {
  mode: "live-public-read-only", origin: target.origin, generated_at_utc: new Date().toISOString(), results,
  limitations: [
    "Unauthenticated public GET requests only; redirects to PIN login do not measure the protected dashboard or stock APIs.",
    "Headers-ready time includes DNS/TLS/connection overhead and is not pure server execution time.",
    "Does not load JavaScript, hydrate React, scan products, submit documents, or measure painting.",
    "Three sequential samples (one in quick mode); live deployment may differ from the local working tree.",
  ],
};
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
console.table(results.flatMap((result, index) => result.chain.map((hop) => ({ sample: index + 1, ...hop }))));
console.log(`Read-only public GET report: ${destination}`);
