// PHASE 2: DO NOT APPLY OR DEPLOY WITHOUT USER APPROVAL (this file only tests the code offline)
// Offline tests for phase2/production-command.gs, run together with the REAL
// scripts/google-apps-script.gs (helpers getSheet, assertCellValue, sha256Hex, validatePayload, doPost).
// Repo destination: scripts/migrations/production-schema-p1/phase2/test/run-phase2-tests.js
// Usage: node run-phase2-tests.js [path/to/google-apps-script.gs]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');

const candidates = [
  process.argv[2],
  path.join(__dirname, '..', '..', '..', '..', 'google-apps-script.gs'),                 // repo: scripts/google-apps-script.gs
  '/workspace/stockify/live-prod-v2/stockify-app/scripts/google-apps-script.gs',       // box export of refactor/structure @ 15f92ff
].filter(Boolean);
const mainPath = candidates.find(p => fs.existsSync(p));
if (!mainPath) { console.error('google-apps-script.gs not found; pass its path as argv[2]'); process.exit(2); }
const MAIN = fs.readFileSync(mainPath, 'utf8');
const CMD = fs.readFileSync(path.join(__dirname, '..', 'production-command.gs'), 'utf8');
const PATCHED = process.env.PATCHED_GS ? fs.readFileSync(process.env.PATCHED_GS, 'utf8') : null;

class Range {
  constructor(s, r, c, nr, nc) { Object.assign(this, { s, r, c, nr, nc }); }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.s.get(this.r + i, this.c + j)); o.push(row); } return o; }
  setValues(v) { if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('shape'); for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.s.set(this.r + i, this.c + j, v[i][j]); return this; }
  setValue(v) { if (this.s.failOnWrite) throw new Error('simulated write failure'); this.s.set(this.r, this.c, v); return this; }
  setFontWeight() { return this; }
}
class Sheet {
  constructor(name, rows, maxCols) { this.name = name; this.data = rows.map(r => r.slice()); this.maxCols = maxCols || Math.max(26, ...rows.map(r => r.length)); this.maxRows = 1000; }
  get(r, c) { const row = this.data[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined || v === null ? '' : v; }
  set(r, c, v) { if (c > this.maxCols) throw new Error(this.name + ' col beyond grid'); while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(v => v !== '' && v != null)) return i + 1; return 0; }
  getMaxColumns() { return this.maxCols; } getMaxRows() { return this.maxRows; }
  insertRowsAfter(a, n) { this.maxRows += n; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  getDataRange() { const lr = Math.max(this.getLastRow(), 1); const lc = Math.max(1, ...this.data.map(r => r.length)); return new Range(this, 1, 1, lr, lc); }
  appendRow(v) { this.set(this.getLastRow() + 1, 1, v[0]); v.forEach((x, j) => this.set(this.getLastRow(), j + 1, x)); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
}
const JOB_HEAD = ['job_id', 'เลขใบสั่งผลิต', 'วันที่ผลิต', 'สถานะ', 'โต๊ะ', 'ความสำคัญ', 'product_id', 'รหัสสินค้า', 'ชื่อสินค้า', 'หน่วย', 'เป้าหมาย', 'หมายเหตุ', 'ตำแหน่งเก็บ', 'ผู้สร้าง', 'ชื่อผู้สร้าง', 'สร้างเมื่อ', 'ส่งงานเมื่อ', 'ผู้เริ่มผลิต', 'เริ่มเมื่อ', 'จบเมื่อ', 'ยกเลิกเมื่อ', 'ชื่อผู้ยกเลิก', 'เหตุผลยกเลิก', 'เหตุผลจบงาน', 'เหตุผลเปิดใหม่', 'จำนวนครั้งเปิดใหม่', 'อัปเดตเมื่อ', 'version', 'ทศนิยมที่อนุญาต', 'ลบร่างเมื่อ'];
function job(id, no, status, version, updated) { const r = new Array(30).fill(''); r[0] = id; r[1] = no; r[2] = '2026-10-09'; r[3] = status; r[4] = 1; r[9] = 'ชิ้น'; r[10] = 100; r[26] = updated; r[27] = version; r[28] = 0; return r; }
function makeWorld(opts) {
  opts = opts || {};
  const sheets = {
    ProductionJobs: new Sheet('ProductionJobs', [JOB_HEAD, job('prj-1', 'PRD-20261009-000001', 'IN_PROGRESS', 3, '2026-10-09T01:00:00.000Z'), job('prj-2', 'PRD-20261009-000002', 'DRAFT', '', '2026-10-09T01:00:05.000Z')], opts.jobCols || 30),
    ProductionReports: new Sheet('ProductionReports', [['report_id', 'เลขใบสั่งผลิต', 'รอบที่', 'ชนิด', 'ประเภทรายงาน', 'ผลิตดี', 'ของเสีย', 'สาเหตุของเสีย', 'เหตุผล', 'หมายเหตุ', 'ลิงก์รูปภาพ', 'ผู้รายงาน', 'ชื่อผู้รายงาน', 'รายงานเมื่อ', 'ดีสะสม', 'เสียสะสม', 'idempotency_key', 'สถานะรายงาน', 'job_id']], 28),
    ProductionHistory: new Sheet('ProductionHistory', [['history_id', 'เลขใบสั่งผลิต', 'การกระทำ', 'ผู้ดำเนินการ', 'ชื่อผู้ดำเนินการ', 'เมื่อ', 'เหตุผล', 'รายละเอียด (JSON)', 'job_id', 'version ก่อน', 'version หลัง', 'คีย์คำขอ']], 26),
    ProductionNotifications: new Sheet('ProductionNotifications', [['notif_id', 'ถึงบทบาท', 'เลขใบสั่งผลิต', 'ข้อความ', 'สร้างเมื่อ', 'ผู้แจ้ง', 'อ่านแล้วโดย (JSON)', 'ประเภท', 'ข้อมูลประกอบ (JSON)', 'job_id', 'คีย์กันแจ้งซ้ำ', 'ถึงผู้ใช้'], ['prn-1', 'ADMIN', 'PRD-20261009-000001', 'msg', '', '', '["u-9"]', 'REPORT_PARTIAL', '', 'prj-1', 'REPORT_PARTIAL:prr-0', '']], 26),
    ProductionCounters: new Sheet('ProductionCounters', [['counter_key', 'เลขล่าสุด', 'อัปเดตเมื่อ', 'อัปเดตโดย'], ['PRD-20261009', 1, '', '']], 26),
    Idempotency: new Sheet('Idempotency', [['key', 'operation_type', 'actor_id', 'payload_hash', 'status', 'response_payload', 'error_message', 'created_at', 'updated_at']], 26),
  };
  const props = { SIGNING_SECRET: 'x'.repeat(40) };
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n, [], 30)) };
  const ctx = {
    JSON, Math, Date, Object, String, Number, Array, isFinite, RegExp, Error, console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, getKeys: () => Object.keys(props), getProperties: () => Object.assign({}, props), deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {
      newBlob: s => ({ getBytes: () => Buffer.from(String(s), 'utf8') }),
      computeDigest: (alg, v) => Array.from(crypto.createHash('sha256').update(String(v), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (m, s) => Array.from(crypto.createHmac('sha256', s).update(m).digest()).map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: () => crypto.randomUUID(),
    },
  };
  vm.createContext(ctx);
  if (PATCHED) vm.runInContext(PATCHED, ctx); else { vm.runInContext(MAIN, ctx); vm.runInContext(CMD, ctx); }
  return { ctx, sheets, props };
}
const J = o => JSON.parse(JSON.stringify(o));
const reportOps = (key, version, updatedAt) => ([
  { op: 'requireRow', sheetName: 'ProductionJobs', key: 'prj-1', expectVersion: version, expectUpdatedAt: updatedAt, expectStatusIn: ['IN_PROGRESS'], requireNotDeleted: true },
  { op: 'appendUnique', sheetName: 'ProductionReports', keyCol: 17, row: ['prr-' + key, 'PRD-20261009-000001', 1, 'REPORT', 'PARTIAL', 60, 2, 'x', '', '', '', 'u-1', 'A', '2026-10-09T02:00:00.000Z', 60, 2, key, 'CONFIRMED', 'prj-1'] },
  { op: 'updateRow', sheetName: 'ProductionJobs', key: 'prj-1', set: { '27': '2026-10-09T02:00:00.000Z' }, bumpVersion: true },
  { op: 'appendUnique', sheetName: 'ProductionHistory', keyCol: 12, row: ['prh-' + key, 'PRD-20261009-000001', 'REPORT_PARTIAL', 'u-1', 'A', '2026-10-09T02:00:00.000Z', '', '{}', 'prj-1', version, version + 1, key] },
]);
// Unpatched main script: call the module validator directly. PATCHED_GS: go through the main validatePayload (allowlist + routing).
const validate = (w, p) => (PATCHED ? w.ctx.validatePayload(p) : w.ctx.validateProductionCommand(p));
function run(w, payload) { validate(w, payload); return J(w.ctx.doProductionCommand(payload)); }

let pass = 0; const out = [];
function test(name, fn) { try { fn(); pass++; out.push('PASS ' + name); } catch (e) { out.push('FAIL ' + name + '\n     ' + String(e.stack || e).split('\n').slice(0, 3).join('\n     ')); } }
const P = (ops, extra) => Object.assign({ action: 'productionCommand', command: 'report', actorId: 'u-1', ops }, extra || {});

test('report: CAS passes, appends report+history, bumps version 3->4', () => {
  const w = makeWorld();
  const r = run(w, P(reportOps('k-00000001', 3, '2026-10-09T01:00:00.000Z'), { idempotencyKey: 'k-00000001' }));
  assert.strictEqual(r.success, true); assert.strictEqual(r.versions['prj-1'], 4);
  assert.strictEqual(w.sheets.ProductionJobs.data[1][27], 4);
  assert.strictEqual(w.sheets.ProductionReports.getLastRow(), 2);
  assert.strictEqual(w.sheets.ProductionHistory.getLastRow(), 2);
  assert.strictEqual(w.sheets.Idempotency.data[1][4], 'COMPLETED');
});
test('replay with same idempotency key returns cached result and writes nothing', () => {
  const w = makeWorld(); const p = P(reportOps('k-00000002', 3, '2026-10-09T01:00:00.000Z'), { idempotencyKey: 'k-00000002' });
  run(w, p); const snap = JSON.stringify(w.sheets.ProductionReports.data) + JSON.stringify(w.sheets.ProductionJobs.data);
  const r2 = run(w, p);
  assert.strictEqual(r2.replayed, true); assert.strictEqual(r2.versions['prj-1'], 4);
  assert.strictEqual(JSON.stringify(w.sheets.ProductionReports.data) + JSON.stringify(w.sheets.ProductionJobs.data), snap);
});
test('same key with different payload -> PRD_IDEMPOTENCY_KEY_REUSED', () => {
  const w = makeWorld(); run(w, P(reportOps('k-00000003', 3, '2026-10-09T01:00:00.000Z'), { idempotencyKey: 'k-00000003' }));
  const ops = reportOps('k-00000003', 4, '2026-10-09T02:00:00.000Z'); ops[1].row[5] = 99;
  const r = run(w, P(ops, { idempotencyKey: 'k-00000003' }));
  assert.strictEqual(r.code, 'PRD_IDEMPOTENCY_KEY_REUSED');
});
test('stale version -> PRD_VERSION_CONFLICT with current job, no writes', () => {
  const w = makeWorld(); const before = JSON.stringify(w.sheets);
  const r = run(w, P(reportOps('k-00000004', 2, '2026-10-09T01:00:00.000Z'), { idempotencyKey: 'k-00000004' }));
  assert.strictEqual(r.code, 'PRD_VERSION_CONFLICT'); assert.strictEqual(r.current.version, 3); assert.strictEqual(r.current.status, 'IN_PROGRESS');
  assert.strictEqual(JSON.stringify(w.sheets), before);
});
test('version matches but updated_at differs (secondary check) -> conflict, no writes', () => {
  const w = makeWorld(); const before = JSON.stringify(w.sheets);
  const r = run(w, P(reportOps('k-00000005', 3, '2026-10-09T00:59:59.000Z')));
  assert.strictEqual(r.code, 'PRD_VERSION_CONFLICT'); assert.ok(r.expected_updated_at);
  assert.strictEqual(JSON.stringify(w.sheets), before);
});
test('wrong status -> PRD_INVALID_TRANSITION', () => {
  const w = makeWorld();
  const r = run(w, P([{ op: 'requireRow', sheetName: 'ProductionJobs', key: 'prj-2', expectVersion: 1, expectStatusIn: ['WAITING'] }, { op: 'updateRow', sheetName: 'ProductionJobs', key: 'prj-2', set: { '4': 'IN_PROGRESS' }, bumpVersion: true }], { command: 'start' }));
  assert.strictEqual(r.code, 'PRD_INVALID_TRANSITION');
});
test('blank version on legacy row counts as 1', () => {
  const w = makeWorld();
  const r = run(w, P([{ op: 'requireRow', sheetName: 'ProductionJobs', key: 'prj-2', expectVersion: 1, expectStatusIn: ['DRAFT'] }, { op: 'updateRow', sheetName: 'ProductionJobs', key: 'prj-2', set: { '30': '2026-10-09T03:00:00.000Z' }, bumpVersion: true }], { command: 'deleteDraft' }));
  assert.strictEqual(r.success, true); assert.strictEqual(w.sheets.ProductionJobs.data[2][27], 2); assert.strictEqual(w.sheets.ProductionJobs.data[2][29], '2026-10-09T03:00:00.000Z');
});
test('updateRow on a job without requireRow / without bumpVersion / touching version col is rejected by validation', () => {
  const w = makeWorld();
  assert.throws(() => validate(w, P([{ op: 'updateRow', sheetName: 'ProductionJobs', key: 'prj-1', set: { '4': 'X' }, bumpVersion: true }])), /must follow a requireRow/);
  assert.throws(() => validate(w, P([{ op: 'requireRow', sheetName: 'ProductionJobs', key: 'prj-1', expectVersion: 3 }, { op: 'updateRow', sheetName: 'ProductionJobs', key: 'prj-1', set: { '4': 'X' } }])), /must bumpVersion/);
  assert.throws(() => validate(w, P([{ op: 'requireRow', sheetName: 'ProductionJobs', key: 'prj-1', expectVersion: 3 }, { op: 'updateRow', sheetName: 'ProductionJobs', key: 'prj-1', set: { '28': 99 }, bumpVersion: true }])), /server-owned/);
  assert.throws(() => validate(w, P([{ op: 'requireRow', sheetName: 'ProductionJobs', key: 'prj-1' }])), /expectVersion/);
  assert.throws(() => validate(w, P([{ op: 'appendUnique', sheetName: 'StockMovements', keyCol: 1, row: ['a'] }])), /SHEET_DENIED/);
  assert.throws(() => validate(w, P([{ op: 'requireRow', sheetName: 'ProductionJobs', key: 'prj-1', expectVersion: 3 }, { op: 'updateRow', sheetName: 'ProductionJobs', key: 'prj-1', set: { '31': 'x' }, bumpVersion: true }])), /out of range/);
});
test('nextJobNo skips numbers already used and advances the counter; placeholder is bound', () => {
  const w = makeWorld();
  const r = run(w, P([{ op: 'nextJobNo', date: '20261009', as: 'job_no' }, { op: 'appendUnique', sheetName: 'ProductionJobs', keyCol: 1, row: ['prj-3', '{{job_no}}', '2026-10-09', 'WAITING'] }], { command: 'create', idempotencyKey: 'k-00000009' }));
  assert.strictEqual(r.bound.job_no, 'PRD-20261009-000003'); // 000002 already exists in ProductionJobs
  assert.strictEqual(w.sheets.ProductionCounters.data[1][1], 3);
  assert.strictEqual(w.sheets.ProductionJobs.data[3][1], 'PRD-20261009-000003');
  const r2 = run(w, P([{ op: 'nextJobNo', date: '20261010', as: 'job_no' }], { command: 'create' }));
  assert.strictEqual(r2.bound.job_no, 'PRD-20261010-000001'); assert.strictEqual(w.sheets.ProductionCounters.getLastRow(), 3);
});
test('appendUnique de-duplicates on the key column (notification dedupe_key)', () => {
  const w = makeWorld();
  const r = run(w, P([{ op: 'appendUnique', sheetName: 'ProductionNotifications', keyCol: 11, row: ['prn-2', 'ADMIN', 'PRD-20261009-000001', 'msg', '', '', '[]', 'REPORT_PARTIAL', '{}', 'prj-1', 'REPORT_PARTIAL:prr-0', ''] }], { command: 'notify' }));
  assert.strictEqual(r.results[0].skipped, true); assert.strictEqual(w.sheets.ProductionNotifications.getLastRow(), 2);
});
test('addToJsonArray merges read_by under the lock (no whole-row overwrite) and is idempotent', () => {
  const w = makeWorld();
  run(w, P([{ op: 'addToJsonArray', sheetName: 'ProductionNotifications', key: 'prn-1', col: 7, value: 'u-1' }], { command: 'markRead' }));
  const r = run(w, P([{ op: 'addToJsonArray', sheetName: 'ProductionNotifications', key: 'prn-1', col: 7, value: 'u-1' }], { command: 'markRead' }));
  assert.strictEqual(w.sheets.ProductionNotifications.data[1][6], '["u-9","u-1"]'); assert.strictEqual(r.results[0].skipped, true);
  assert.strictEqual(w.sheets.ProductionNotifications.data[1][3], 'msg');
});
test('fails closed before migration (ProductionJobs grid has no AB version column)', () => {
  const w = makeWorld({ jobCols: 27 });
  w.sheets.ProductionJobs.data.forEach(r => r.length = 27);
  assert.throws(() => run(w, P([{ op: 'requireRow', sheetName: 'ProductionJobs', key: 'prj-1', expectVersion: 1 }, { op: 'updateRow', sheetName: 'ProductionJobs', key: 'prj-1', set: { '27': 'x' }, bumpVersion: true }])), /run migration PRD-SCHEMA-P1 first/);
});
test('write failure mid-command marks the idempotency row FAILED and later retries are refused', () => {
  const w = makeWorld(); w.sheets.ProductionJobs.failOnWrite = true;
  const p = P(reportOps('k-00000013', 3, '2026-10-09T01:00:00.000Z'), { idempotencyKey: 'k-00000013' });
  assert.throws(() => run(w, p), /simulated write failure/);
  assert.strictEqual(w.sheets.Idempotency.data[1][4], 'FAILED');
  w.sheets.ProductionJobs.failOnWrite = false;
  assert.strictEqual(run(w, p).code, 'PRD_IDEMPOTENCY_FAILED');
});
if (PATCHED) test('patched main script routes productionCommand through validatePayload + doPost lock', () => {
  const w = makeWorld();
  const payload = P(reportOps('k-00000014', 3, '2026-10-09T01:00:00.000Z'), { idempotencyKey: 'k-00000014' });
  const timestamp = Date.now(); const nonce = crypto.randomUUID(); const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', w.props.SIGNING_SECRET).update(timestamp + '.' + nonce + '.' + body).digest('hex');
  const res = w.ctx.doPost({ postData: { contents: JSON.stringify({ timestamp, nonce, payload: body, signature }) } });
  const parsed = JSON.parse(res.text);
  if (parsed.code === 'AUTH_FAILED') throw new Error('signature format mismatch in test: ' + parsed.error);
  assert.strictEqual(parsed.success, true, res.text); assert.strictEqual(parsed.versions['prj-1'], 4);
  // same signed envelope again -> rejected as a replayed nonce before any production logic runs
  const again = JSON.parse(w.ctx.doPost({ postData: { contents: JSON.stringify({ timestamp, nonce, payload: body, signature }) } }).text);
  assert.strictEqual(again.code, 'AUTH_FAILED'); assert.ok(/REPLAY/.test(again.error));
  // unknown op is refused by validatePayload (VALIDATION_FAILED), nothing written
  const bad = JSON.stringify(P([{ op: 'deleteEverything' }]));
  const ts2 = Date.now(), n2 = crypto.randomUUID();
  const sig2 = crypto.createHmac('sha256', w.props.SIGNING_SECRET).update(ts2 + '.' + n2 + '.' + bad).digest('hex');
  const r3 = JSON.parse(w.ctx.doPost({ postData: { contents: JSON.stringify({ timestamp: ts2, nonce: n2, payload: bad, signature: sig2 }) } }).text);
  assert.strictEqual(r3.code, 'VALIDATION_FAILED');
});
console.log('google-apps-script.gs used: ' + mainPath + (PATCHED ? ' (PATCHED_GS=' + process.env.PATCHED_GS + ')' : ''));
console.log(out.join('\n')); console.log('\n' + pass + '/' + out.length + ' passed');
process.exit(pass === out.length ? 0 : 1);
