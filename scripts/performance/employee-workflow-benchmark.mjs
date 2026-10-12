#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { loadBenchmarkSource, root } from './load-benchmark-source.mjs';

// This harness calls real business services, never HTTP routes or live storage.
// Latency is an explicit model per repository operation, NOT measured Google latency.
globalThis.fetch = async () => { throw new Error('Benchmark forbids network requests'); };
process.env.NODE_ENV = 'benchmark';
const { InMemoryStockRepository } = loadBenchmarkSource('src/server/repositories/in-memory/in-memory-stock.repository.ts');
const { receiveStock, ReceiveStockSchema } = loadBenchmarkSource('src/server/services/stock/receive-stock.ts');
const { createTransfer, submitTransferMove, CreateTransferSchema, SubmitTransferSchema } = loadBenchmarkSource('src/server/services/stock/transfer-stock.ts');
const { defaultLockProvider } = loadBenchmarkSource('src/server/locking/lock-provider.ts');
const context = new AsyncLocalStorage();
const nativeInfo = console.info;
console.info = (...args) => {
  if (args[0] === '[StockAtomicTiming]') context.getStore()?.atomicTimings.push(JSON.parse(args[1]));
  else nativeInfo(...args);
};
const nativeAcquire = defaultLockProvider.acquire.bind(defaultLockProvider);
defaultLockProvider.acquire = async (...args) => {
  const start = performance.now();
  const release = await nativeAcquire(...args);
  context.getStore()?.lockWaits.push(performance.now() - start);
  return release;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rounded = (value) => Number(value.toFixed(3));
const percentile = (values, quantile) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * quantile;
  const lower = Math.floor(index);
  return ordered[lower] + (ordered[Math.ceil(index)] - ordered[lower]) * (index - lower);
};
const runs = process.argv.includes('--quick') ? 1 : 2;
const historyProfiles = [
  { name: 'small', historyRows: 100, productRows: 100, locationRows: 100 },
  { name: 'large', historyRows: 25000, productRows: 5000, locationRows: 2000 },
];

function fixture(profile) {
  const repo = new InMemoryStockRepository();
  const timestamp = '2026-10-12T00:00:00.000Z';
  // TS private fields are ordinary properties at runtime. Fixture seeding avoids
  // counting setup as workflow time and does not alter any production source.
  repo.products.products = Array.from({ length: profile.productRows }, (_, i) => ({
    product_id: `prod-${i}`, sku: `SKU-${i}`, barcode: `BAR-${i}`, product_name: `Fixture ${i}`,
    category: 'fixture', base_unit: 'piece', minimum_stock: 0, active: true,
    created_at: timestamp, updated_at: timestamp,
  }));
  repo.locations.locations = Array.from({ length: profile.locationRows }, (_, i) => ({
    location_id: `loc-${i}`, location_code: `loc-${i}`, warehouse_id: 'wh-1',
    location_name: `Fixture location ${i}`, active: true, created_at: timestamp, updated_at: timestamp,
  }));
  repo.documents.documents = Array.from({ length: profile.historyRows }, (_, i) => ({
    document_id: `history-doc-${i}`, document_no: `HISTORY-${i}`, document_type: 'RECEIVE',
    status: 'COMPLETED', document_date: '2026-01-01', reference_no: '', created_by: 'fixture',
    created_at: timestamp, note: JSON.stringify({ idempotency_key: `history-key-${i}`, lines: [] }),
  }));
  repo.movements.movements = Array.from({ length: profile.historyRows }, (_, i) => ({
    movement_id: `history-mov-${i}`, document_id: `history-doc-${i}`, product_id: 'historical-other-product',
    warehouse_id: 'wh-1', location_id: 'loc-0', qty_change: i % 2 ? -1 : 1,
    idempotency_key: `history-key-${i}`, movement_type: 'RECEIVE', created_at: timestamp,
  }));
  // Match the Sheets document interface's indexed method name and scan semantics;
  // only in-memory JSON is scanned. Service fallback can also be profiled below.
  repo.documents.existsByIdempotencyKey = async function (key) {
    return this.documents.some((doc) => {
      try { return JSON.parse(doc.note || '{}').idempotency_key === key; } catch { return false; }
    });
  };
  const products = repo.products.products.slice(-100);
  const location = `loc-${profile.locationRows - 1}`;
  for (const product of products) repo.movements.movements.push({
    movement_id: `seed-${product.product_id}`, document_id: 'seed', product_id: product.product_id,
    warehouse_id: 'wh-1', location_id: location, qty_change: 1000000,
    idempotency_key: `seed-${product.product_id}`, movement_type: 'RECEIVE', created_at: timestamp,
  });
  return { repo, products, location, timestamp };
}

function instrument(repo, options, metrics) {
  let active = 0;
  const queue = [];
  const pending = new Set();
  let documentTail = Promise.resolve();
  async function enter() {
    if (active >= options.maxRepositoryConcurrency) await new Promise((resolve) => queue.push(resolve));
    else active++;
    metrics.peakRepositoryConcurrency = Math.max(metrics.peakRepositoryConcurrency, active);
  }
  function leave() {
    if (queue.length) queue.shift()();
    else active--;
  }
  for (const [domain, target] of Object.entries(repo)) {
    const methods = new Set([...Object.getOwnPropertyNames(Object.getPrototypeOf(target)), ...Object.keys(target)]);
    for (const method of methods) {
      if (method === 'constructor' || typeof target[method] !== 'function') continue;
      const original = target[method].bind(target);
      target[method] = (...args) => {
        const name = `${domain}.${method}`;
        const started = performance.now();
        const row = metrics.methods[name] ??= { calls: 0, totalMs: 0, activeElapsedMs: 0, injectedWaitMs: 0, queueMs: 0, maxMs: 0 };
        row.calls++;
        let previousDocument;
        let releaseDocument;
        // Optional repository-level model of Sheets' per-document-type numbering
        // lock. The real in-memory repository has no such lock; report separately.
        if (options.serializeDocumentCreate && name === 'documents.create') {
          previousDocument = documentTail;
          documentTail = new Promise((resolve) => { releaseDocument = resolve; });
        }
        const operation = (async () => {
          if (previousDocument) await previousDocument;
          await enter();
          const admitted = performance.now();
          row.queueMs += admitted - started;
          try {
            if (options.repositoryLatencyMs) {
              const delayStarted = performance.now();
              await sleep(options.repositoryLatencyMs);
              row.injectedWaitMs += performance.now() - delayStarted;
            }
            return await original(...args);
          } finally {
            const elapsed = performance.now() - started;
            row.activeElapsedMs += performance.now() - admitted;
            row.totalMs += elapsed;
            row.maxMs = Math.max(row.maxMs, elapsed);
            leave();
            releaseDocument?.();
          }
        })();
        pending.add(operation);
        operation.then(() => pending.delete(operation), () => pending.delete(operation));
        return operation;
      };
    }
  }
  return async () => { while (pending.size) await Promise.allSettled([...pending]); };
}

function receiveInput(f, lines, qty, key, split = false) {
  return {
    ...ReceiveStockSchema.parse({
      warehouse_id: 'wh-1', document_date: '2026-10-12', idempotency_key: key,
      ...(f.planDocumentId ? { plan_document_id: f.planDocumentId } : {}),
      lines: f.products.slice(0, lines).map((product) => ({
        product_id: product.product_id, location_id: f.location, qty,
        ...(split ? { location_allocations: [{ location_id: f.location, qty: qty / 2 }, { location_id: 'loc-0', qty: qty / 2 }] } : {}),
      })),
    }),
    user_id: 'fixture-staff', role: 'STAFF', user_name: 'Fixture Staff',
  };
}

function transferInput(f, product, qty, key) {
  return {
    ...CreateTransferSchema.parse({
      from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2', from_location_id: f.location,
      to_location_id: 'DEST-1', product_id: product.product_id, qty, document_date: '2026-10-12',
      assigned_to_user_id: 'fixture-staff', idempotency_key: key,
    }),
    user_id: 'fixture-admin', role: 'ADMIN',
  };
}

async function scenario(spec, iteration) {
  const f = fixture(spec.profile);
  const { repo } = f;
  if (spec.planned) {
    f.planDocumentId = `plan-${spec.id}-${iteration}`;
    repo.documents.documents.push({
      document_id: f.planDocumentId, document_no: `PLAN-${iteration}`, document_type: 'RECEIVE_PLAN',
      status: 'PENDING', document_date: '2026-10-12', reference_no: '', created_by: 'fixture-admin',
      created_at: f.timestamp, note: JSON.stringify({ plan: {
        warehouse_id: 'wh-1', warehouse_name: 'โกดัง1', expected_date: '2026-10-12', note: '', receipts: [],
        lines: f.products.slice(0, spec.lines).map((product) => ({ ...product, expected_qty: spec.qty })),
      } }),
    });
  }
  const initialDocuments = repo.documents.documents.length;
  const initialMovements = repo.movements.movements.length;
  const initialQuantities = repo.movements.movements.map((movement) => movement.qty_change);
  const metrics = { methods: {}, lockWaits: [], atomicTimings: [], peakRepositoryConcurrency: 0 };
  const drain = instrument(repo, spec, metrics);
  const key = `benchmark-${spec.id}-${iteration}`;
  const inputs = [];
  let docs = [];
  // Seed existing admin tasks directly: employee submit is timed independently
  // from creating the task and from human scanning/physical handling time.
  if (spec.workflow === 'employee-transfer-submit') {
    for (let i = 0; i < spec.lines; i++) {
      const input = transferInput(f, f.products[i], spec.qty, `${key}-${i}`);
      repo.documents.documents.push({
        document_id: `${key}-doc-${i}`, document_no: `${key}-DOC-${i}`, document_type: 'TRANSFER',
        status: 'PENDING', document_date: input.document_date, reference_no: '', created_by: 'fixture-admin',
        assigned_to_user_id: 'fixture-staff', note: JSON.stringify(input), created_at: f.timestamp,
      });
    }
    docs = repo.documents.documents.slice(initialDocuments);
  }
  const started = performance.now();
  const results = await context.run(metrics, async () => {
    if (spec.workflow === 'employee-receive') {
      const workers = spec.workers ?? 1;
      inputs.push(...Array.from({ length: workers }, (_, i) => receiveInput(f, spec.lines, spec.qty, `${key}-${i}`, spec.split)));
      return Promise.all(inputs.map((input) => receiveStock({ repo }, input)));
    }
    if (spec.workflow === 'admin-transfer-create') {
      inputs.push(...f.products.slice(0, spec.lines).map((product, i) => transferInput(f, product, spec.qty, `${key}-${i}`)));
      return Promise.all(inputs.map((input) => createTransfer({ repo }, input)));
    }
    const submit = SubmitTransferSchema.parse({
      from_location_id: f.location, to_location_id: 'DEST-1',
      source_allocations: [{ location_id: f.location, qty: spec.qty }],
    });
    const updated = [];
    // Employee works one document at a time. Time is sum of service submissions;
    // this is a batch of tasks, not one employee HTTP request with many lines.
    for (const doc of docs) updated.push(await submitTransferMove({ repo }, doc.document_id, {
      fromLocationId: submit.from_location_id, toLocationId: submit.to_location_id,
      sourceAllocations: submit.source_allocations, userId: 'fixture-staff', userName: 'Fixture Staff', userRole: 'STAFF',
    }));
    return updated;
  });
  const responseMs = performance.now() - started;
  await drain(); // include asynchronous journal/idempotency/audit separately
  const settledMs = performance.now() - started;
  assert.equal(repo.movements.movements.length, initialMovements, 'Staff workflows must not mutate stock before approval');
  assert.ok(repo.movements.movements.every((movement, i) => movement.qty_change === initialQuantities[i]), 'Stock quantities must remain unchanged');
  assert.equal(repo.stockSummary.summaries.length, 0, 'Staff workflows must not change stock summaries');
  assert.equal(repo.documents.documents.length - initialDocuments, results.length, 'No missing or duplicate documents');
  assert.equal(new Set(results.map((doc) => doc.document_id)).size, results.length);
  for (const doc of results) {
    const note = JSON.parse(doc.note);
    if (spec.workflow === 'employee-receive') {
      assert.equal(doc.status, 'PENDING');
      assert.equal(note.lines.length, spec.lines * (spec.split ? 2 : 1));
      assert.equal(note.qty, spec.lines * spec.qty);
    } else if (spec.workflow === 'employee-transfer-submit') {
      assert.equal(doc.status, 'WAITING_APPROVAL');
      assert.equal(note.current_step, 4);
      assert.equal(note.source_allocations[0].qty, spec.qty);
      assert.equal(note.mover_user_id, 'fixture-staff');
    } else {
      assert.equal(doc.status, 'PENDING');
      assert.equal(note.qty, spec.qty);
    }
  }
  if (spec.planned) {
    const plan = repo.documents.documents.find((doc) => doc.document_id === f.planDocumentId);
    assert.equal(plan.status, 'COMPLETED');
    const receipts = JSON.parse(plan.note).plan.receipts;
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].document_id, results[0].document_id);
    assert.equal(receipts[0].lines.reduce((total, line) => total + line.qty, 0), spec.lines * spec.qty);
  }
  // Retry exact input after background completion: must return same document,
  // and never append stock/documents. Replay timings are separate from first send.
  const replayStart = performance.now();
  const firstSendMetrics = structuredClone(metrics);
  const countBeforeReplay = repo.documents.documents.length;
  if (spec.workflow === 'employee-transfer-submit') {
    for (const doc of results) {
      const repeat = await submitTransferMove({ repo }, doc.document_id, { userId: 'fixture-staff', userRole: 'STAFF' });
      assert.equal(repeat.document_id, doc.document_id);
      assert.equal(repeat.status, 'WAITING_APPROVAL');
      assert.equal(repeat.note, doc.note);
    }
  } else {
    const service = spec.workflow === 'employee-receive' ? receiveStock : createTransfer;
    const replay = await Promise.all(inputs.map((input) => service({ repo }, input)));
    assert.deepEqual(replay.map((doc) => doc.document_id), results.map((doc) => doc.document_id));
  }
  await drain();
  assert.equal(repo.documents.documents.length, countBeforeReplay, 'Retry must not duplicate documents');
  if (spec.planned) {
    const plan = repo.documents.documents.find((doc) => doc.document_id === f.planDocumentId);
    assert.equal(JSON.parse(plan.note).plan.receipts.length, 1, 'Retry must not duplicate plan receipts');
  }
  return { responseMs, settledMs, replayMs: performance.now() - replayStart, results: results.length, metrics: firstSendMetrics };
}

async function checkDoubleSubmitAndInvalidStock() {
  const f = fixture(historyProfiles[0]);
  const metrics = { methods: {}, lockWaits: [], atomicTimings: [], peakRepositoryConcurrency: 0 };
  const drain = instrument(f.repo, { repositoryLatencyMs: 5, maxRepositoryConcurrency: 8 }, metrics);
  const documentCount = f.repo.documents.documents.length;
  const input = receiveInput(f, 10, 1000, 'benchmark-double-click');
  const attempts = await context.run(metrics, () => Promise.allSettled([
    receiveStock({ repo: f.repo }, input), receiveStock({ repo: f.repo }, input),
  ]));
  await drain();
  const successful = attempts.filter((attempt) => attempt.status === 'fulfilled');
  assert.ok(successful.length >= 1);
  assert.equal(new Set(successful.map((attempt) => attempt.value.document_id)).size, 1);
  for (const attempt of attempts.filter((attempt) => attempt.status === 'rejected')) {
    assert.equal(attempt.reason.name, 'IdempotencyInProgressError');
  }
  assert.equal(f.repo.documents.documents.length, documentCount + 1);
  const replay = await receiveStock({ repo: f.repo }, input);
  assert.equal(replay.document_id, successful[0].value.document_id);
  await drain();
  await assert.rejects(
    createTransfer({ repo: f.repo }, transferInput(f, f.products[0], 1000001, 'benchmark-insufficient-stock')),
    { name: 'InsufficientStockError' },
  );
  await drain();
  assert.equal(f.repo.documents.documents.length, documentCount + 1);
  assert.equal(f.repo.movements.movements.length, historyProfiles[0].historyRows + 100);
  return {
    concurrentDuplicateReceive: 'passed: one document, either cached replay or in-progress rejection',
    receiveRetryAfterSettlement: 'passed: same document ID',
    insufficientStockTransfer: 'passed: rejected, no extra document or stock mutation',
  };
}

const specifications = [];
for (const profile of historyProfiles) for (const repositoryLatencyMs of [0, 5]) {
  for (const lines of [1, 10, 50, 100]) for (const qty of [1, 1000]) {
    for (const workflow of ['employee-receive', 'employee-transfer-submit', 'admin-transfer-create']) {
      specifications.push({
        id: `${workflow}-${profile.name}-${repositoryLatencyMs}ms-${lines}lines-${qty}qty`,
        workflow, profile, lines, qty, repositoryLatencyMs,
        maxRepositoryConcurrency: 1000, serializeDocumentCreate: false,
      });
    }
  }
}
specifications.push(
  { id: 'receive-split-allocations', workflow: 'employee-receive', profile: historyProfiles[1], lines: 100, qty: 1000, split: true, repositoryLatencyMs: 5 },
  { id: 'receive-four-employees-same-stock', workflow: 'employee-receive', profile: historyProfiles[1], lines: 10, qty: 1, workers: 4, repositoryLatencyMs: 5 },
  { id: 'admin-create-100-fanout-repository-cap-8', workflow: 'admin-transfer-create', profile: historyProfiles[1], lines: 100, qty: 1, maxRepositoryConcurrency: 8, repositoryLatencyMs: 5 },
  { id: 'admin-create-100-modeled-document-number-lock', workflow: 'admin-transfer-create', profile: historyProfiles[1], lines: 100, qty: 1, serializeDocumentCreate: true, repositoryLatencyMs: 5 },
);
for (const lines of [1, 100]) for (const qty of [1, 1000]) specifications.push({
  id: `receive-by-plan-${lines}lines-${qty}qty`, workflow: 'employee-receive', profile: historyProfiles[1],
  lines, qty, planned: true, repositoryLatencyMs: 5,
});

const output = [];
try {
  for (const specification of specifications) {
    const spec = { maxRepositoryConcurrency: 1000, serializeDocumentCreate: false, ...specification };
    const samples = [];
    for (let i = 0; i < runs; i++) samples.push(await scenario(spec, i));
    const representative = samples.toSorted((a, b) => a.responseMs - b.responseMs)[Math.floor(samples.length / 2)];
    output.push({
      ...spec,
      timings: {
        samples: samples.map((sample) => ({ responseMs: rounded(sample.responseMs), settledMs: rounded(sample.settledMs), replayMs: rounded(sample.replayMs) })),
        responseMedianMs: rounded(percentile(samples.map((sample) => sample.responseMs), 0.5)),
        responseMaxMs: rounded(Math.max(...samples.map((sample) => sample.responseMs))),
        averageMsPerTask: rounded(percentile(samples.map((sample) => sample.responseMs), 0.5) / representative.results),
        settledMedianMs: rounded(percentile(samples.map((sample) => sample.settledMs), 0.5)),
      },
      correctness: { passed: true, documents: representative.results, stockChanged: false, exactReplayCreatesDuplicate: false },
      methodTimingSampleResponseMs: rounded(representative.responseMs),
      methodTimings: Object.fromEntries(Object.entries(representative.metrics.methods).map(([name, value]) => [name, {
        calls: value.calls, totalMs: rounded(value.totalMs), activeElapsedMs: rounded(value.activeElapsedMs),
        injectedWaitMs: rounded(value.injectedWaitMs), queueMs: rounded(value.queueMs), maxMs: rounded(value.maxMs),
      }])),
      peakRepositoryConcurrency: representative.metrics.peakRepositoryConcurrency,
      serviceAtomicTimings: representative.metrics.atomicTimings,
      lockWait: { acquisitions: representative.metrics.lockWaits.length, sumMs: rounded(representative.metrics.lockWaits.reduce((sum, value) => sum + value, 0)), maxMs: rounded(Math.max(0, ...representative.metrics.lockWaits)) },
    });
    if (output.length % 16 === 0) console.log(`Workflow benchmark: ${output.length}/${specifications.length} profiles passed`);
  }
  const safetyChecks = await checkDoubleSubmitAndInvalidStock();
  const observedTimerMs = [];
  for (let i = 0; i < 10; i++) {
    const started = performance.now();
    await sleep(5);
    observedTimerMs.push(rounded(performance.now() - started));
  }
  const report = {
    generatedAt: new Date().toISOString(), harness: 'real-business-services-with-in-memory-repository', runsPerProfile: runs,
    repositoryLatencyModel: '0 ms baseline or injected 5 ms per top-level repository method. Timer/CPU and queue overhead are measured locally; these values do not estimate live Sheets latency.',
    latencyCalibration: {
      requestedTimerMs: 5, samplesObservedMs: observedTimerMs,
      observedMedianMs: rounded(percentile(observedTimerMs, 0.5)),
      note: 'OS scheduling/timer resolution can make a requested 5 ms sleep much longer. Method injectedWaitMs records the actual timer wait separately from repository execution and queueing.',
    },
    taskDefinitions: {
      'employee-receive': 'One employee receive request containing N lines; PENDING document, no balance mutation.',
      'employee-transfer-submit': 'N pre-created transfer tasks submitted sequentially as an employee would handle individual tasks; WAITING_APPROVAL, no balance mutation. Average per task is the comparable request measure.',
      'admin-transfer-create': 'Supporting admin task-creation fan-out matching Promise.all in use-transfer-movement; N independent documents, not employee submit.',
    },
    limitations: [
      'No browser, HTTP/API auth/proxy, React/DOM, deployment cold start, Google Sheets, retries, network throttling, physical scanning or production data is tested.',
      'Fixture seeding, TS transpilation and request-schema validation run outside the timed business calls. Retries here are exact idempotency replay tests, not network retry simulation.',
      'Method times overlap; their sum is not user wait. Method counts and serviceAtomicTimings include first send plus asynchronous writes, and exclude exact replay.',
      'Method activeElapsedMs includes its own injectedWaitMs. Pure repository self-execution cannot be derived when nested wrapped calls overlap.',
      'In-memory movement balances scan the synthetic ledger; production movement repository uses warehouse sheet reads. History effects do not predict production balance cost.',
      'Document idempotency method is an in-memory scan equivalent to the Sheets interface; document create lock is modeled only in its explicitly named profile.',
      'In-memory repositories omit real Sheets read/write internals and distributed concurrency; no production throughput claim can be derived.',
      'One or two runs summarize local samples, not a statistically representative production percentile or SLA.',
    ],
    safetyChecks, profiles: output,
  };
  const destination = path.join(root, 'artifacts/performance/employee-workflow-benchmark.json');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Passed ${output.length} workflow profiles (${runs} runs each). Report: ${destination}`);
} catch (error) {
  console.error('Employee workflow benchmark failed:', error);
  process.exitCode = 1;
} finally {
  console.info = nativeInfo;
  defaultLockProvider.acquire = nativeAcquire;
}
