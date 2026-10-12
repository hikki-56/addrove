import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argumentsForBenchmarks = process.argv.includes("--quick") ? ["--quick"] : [];
console.log("Employee performance tester: synthetic fixtures only; no production writes or network requests.");
for (const script of ["employee-page-load-benchmark.mjs", "employee-client-action-benchmark.mjs", "employee-workflow-benchmark.mjs", "employee-performance-regressions.mjs"]) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/performance", script), ...argumentsForBenchmarks], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("PASS: employee page-data, scan/submit callbacks, and receive/transfer services. Reports: artifacts/performance/");
