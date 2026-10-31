// Offline test harness for production-schema-p1.gs — no network, no Google APIs.
// Repo destination: scripts/migrations/production-schema-p1/test/run-mock-tests.js
// Usage: node run-mock-tests.js            (exit code 0 = all pass)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const GS = fs.readFileSync(path.join(__dirname, '..', 'production-schema-p1.gs'), 'utf8');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-sample.json'), 'utf8'));
const LIVE_ID = '1tsndbJWnXPvY3_LQhtzVNPRMJxqjan3ScQXSvIUKPg4';

function revive(v) { return v && typeof v === 'object' && v.__date ? new Date(v.__date + 'T00:00:00+07:00') : v; }

// ---------------- minimal Apps Script mock ----------------
class MockRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  _cells(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet._get(this.r + i, this.c + j)); out.push(row); } return out; }
  getValue() { return this.sheet._get(this.r, this.c); }
  setValues(v) { if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('setValues shape mismatch'); this._cells((r, c, i, j) => this.sheet._set(r, c, v[i][j])); return this; }
  setValue(v) { this.sheet._set(this.r, this.c, v); return this; }
  clearContent() { this._cells((r, c) => this.sheet._set(r, c, '')); return this; }
  setFontWeight() { return this; }
  setNumberFormat(f) { this._cells((r, c) => { this.sheet.fmt[r + ':' + c] = f; }); return this; }
  getNumberFormat() { return this.sheet.fmt[this.r + ':' + this.c] || 'General'; }
  setDataValidation(rule) { this._cells((r, c) => { if (rule) this.sheet.dv[r + ':' + c] = rule; else delete this.sheet.dv[r + ':' + c]; }); return this; }
  getDataValidation() { return this.sheet.dv[this.r + ':' + this.c] || null; }
}
class MockSheet {
  constructor(name, rows, maxCols) {
    this.name = name; this.data = (rows || []).map(r => r.map(revive));
    this.maxCols = Math.max(maxCols || 26, ...this.data.map(r => r.length), 1);
    this.maxRows = Math.max(1000, this.data.length); this.fmt = {}; this.dv = {}; this.protections = [];
  }
  _assertGrid(r, c) { if (c > this.maxCols) throw new Error(`${this.name}: col ${c} beyond grid ${this.maxCols}`); if (r > this.maxRows) throw new Error(`${this.name}: row beyond grid`); }
  _get(r, c) { const row = this.data[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined || v === null ? '' : v; }
  _set(r, c, v) {
    this._assertGrid(r, c);
    // emulate "user-entered" parsing: YYYY-MM-DD string into a non-text cell becomes a Date
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && this.fmt[r + ':' + c] !== '@') v = new Date(v + 'T00:00:00+07:00');
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v;
  }
  getName() { return this.name; }
  getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(v => v !== '' && v !== undefined && v !== null)) return i + 1; return 0; }
  getLastColumn() { let m = 0; this.data.forEach(r => { for (let j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== undefined && r[j] !== null) { m = Math.max(m, j + 1); break; } }); return m; }
  getMaxColumns() { return this.maxCols; }
  getMaxRows() { return this.maxRows; }
  getRange(r, c, nr, nc) { return new MockRange(this, r, c, nr || 1, nc || 1); }
  insertColumnsAfter(after, n) { if (after !== this.maxCols) throw new Error('only append grid columns at end'); this.maxCols += n; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  setFrozenRows() {}
  deleteRow(r) { this.data.splice(r - 1, 1); }
  protect() { const p = { d: '', w: false, setDescription(d) { this.d = d; return this; }, setWarningOnly(w) { this.w = w; return this; }, getDescription() { return this.d; }, remove: () => { this.protections = this.protections.filter(x => x !== p); } }; this.protections.push(p); return p; }
  getProtections() { return this.protections.slice(); }
}
function makeSpreadsheet(id, tabs) {
  const sheets = {};
  Object.keys(tabs).forEach(n => { sheets[n] = new MockSheet(n, tabs[n].rows, tabs[n].maxCols); });
  return {
    sheets,
    getId: () => id, getName: () => 'ไฟ (COPY for migration test)', getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new MockSheet(n, [], 26)),
    deleteSheet: s => { delete sheets[s.name]; },
  };
}
function makeEnv(ss, props) {
  const logs = []; const files = {}; let fileSeq = 0;
  const mkFile = (name, content) => { const id = 'file-' + (++fileSeq); files[id] = { name, content }; return { getId: () => id, getBlob: () => ({ getDataAsString: () => files[id].content }) }; };
  const folder = { getId: () => 'folder-1', createFile: (n, c) => mkFile(n, c) };
  const dvBuilder = () => { const r = {}; const b = { requireValueInList(l) { r.list = l; return b; }, requireFormulaSatisfied(f) { r.formula = f; return b; }, setAllowInvalid(a) { r.allowInvalid = a; return b; }, setHelpText(h) { r.help = h; return b; }, build() { return { ...r, getHelpText: () => r.help }; } }; return b; };
  const ctx = {
    console, JSON, Math, Date, Object, String, Number, Array, isFinite, parseInt, RegExp, Error,
    Logger: { log: m => logs.push(String(m)) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, newDataValidation: dvBuilder, flush: () => {}, ProtectionType: { SHEET: 'SHEET' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => folder, getFolderById: () => folder,
      getFileById: id => id === ss.getId() ? { makeCopy: (n) => mkFile(n, 'COPY') } : { getBlob: () => ({ getDataAsString: () => files[id].content }) },
    },
    Utilities: {
      formatDate: (d, tz, f) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {}); return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second); },
      getUuid: () => require('crypto').randomUUID(),
    },
  };
  vm.createContext(ctx); vm.runInContext(GS, ctx);
  return { ctx, logs, files };
}
function liveLikeTabs(over) {
  const t = {};
  ['ProductionJobs', 'ProductionHistory', 'BOM_Headers', 'BOM_Items', 'โกดัง1', 'โกดัง2', 'โกดัง3', 'โกดัง4', 'โกดัง5', 'สำนักงานใหญ่']
    .forEach(n => { t[n] = { rows: JSON.parse(JSON.stringify(FIXTURE[n])), maxCols: n === 'ProductionJobs' ? 27 : undefined }; });
  return Object.assign(t, over || {});
}
const snapshot = ss => JSON.stringify(Object.keys(ss.sheets).sort().map(n => [n, ss.sheets[n].data.map(r => { const c = r.map(v => v instanceof Date ? 'D:' + v.toISOString() : v); while (c.length && c[c.length - 1] === '') c.pop(); return c; }).filter((r, i, a) => true)]));

// vm-context arrays have a different prototype → compare as JSON
const eqJSON = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
let pass = 0; const results = [];
function test(name, fn) { try { fn(); pass++; results.push('PASS ' + name); } catch (e) { results.push('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n     ')); } }
const COPY_ID = '1COPYcopyCOPYcopyCOPYcopyCOPYcopyCOPYcopy00';

test('dryRun on live-like copy: plans actions, no aborts, writes nothing', () => {
  const ss = makeSpreadsheet(COPY_ID, liveLikeTabs()); const before = snapshot(ss);
  const { ctx } = makeEnv(ss, {});
  const plan = ctx.dryRun();
  eqJSON(plan.aborts, []);
  assert.ok(plan.actions.length > 5);
  assert.strictEqual(snapshot(ss), before, 'dry run must not write');
  const types = plan.actions.map(a => a.type + ':' + a.tab);
  ['createTab:ProductionReports', 'createTab:ProductionNotifications', 'createTab:ProductionCounters', 'createTab:ProductionUnitRules', 'writeHeaders:ProductionJobs', 'writeHeaders:ProductionHistory', 'ensureGridColumns:ProductionJobs']
    .forEach(t => assert.ok(types.includes(t), 'missing ' + t));
  assert.strictEqual(plan.findings.duplicateJobNo.length, 1);
});

test('applyMigration refuses without MIGRATION_CONFIRM (default = dry run)', () => {
  const ss = makeSpreadsheet(COPY_ID, liveLikeTabs()); const before = snapshot(ss);
  const { ctx } = makeEnv(ss, {});
  assert.throws(() => ctx.applyMigration(), /REFUSED/); assert.strictEqual(snapshot(ss), before);
});

test('applyMigration refuses on LIVE id without MIGRATION_ALLOW_LIVE', () => {
  const ss = makeSpreadsheet(LIVE_ID, liveLikeTabs()); const before = snapshot(ss);
  const { ctx } = makeEnv(ss, { MIGRATION_CONFIRM: 'PRD-SCHEMA-P1:' + LIVE_ID });
  assert.throws(() => ctx.applyMigration(), /LIVE production/); assert.strictEqual(snapshot(ss), before);
});

let applied;
test('apply on copy: columns appended at end only, backfills, tabs created; re-plan = 0', () => {
  const ss = makeSpreadsheet(COPY_ID, liveLikeTabs());
  const origJobs = JSON.parse(JSON.stringify(ss.sheets.ProductionJobs.data.map(r => r.slice(0, 27).map(v => v instanceof Date ? 'D' : v))));
  const props = { MIGRATION_CONFIRM: 'PRD-SCHEMA-P1:' + COPY_ID };
  const env = makeEnv(ss, props);
  const res = env.ctx.applyMigration();
  assert.strictEqual(res.applied, true); assert.strictEqual(res.remaining, 0);
  const J = ss.sheets.ProductionJobs;
  assert.strictEqual(J.maxCols, 30);
  eqJSON(J.data[0].slice(27, 30), ['version', 'ทศนิยมที่อนุญาต', 'ลบร่างเมื่อ']);
  // first 27 columns untouched except C (date normalised to text)
  J.data.forEach((r, i) => r.slice(0, 27).forEach((v, j) => { if (j !== 2) eqJSON(v, origJobs[i][j], `cell ${i + 1}:${j + 1} changed`); }));
  assert.strictEqual(J.data[1][2], '2026-10-07'); assert.strictEqual(J.data[2][2], '2026-10-07');
  assert.strictEqual(J.data[1][27], 1); assert.strictEqual(J.data[1][28], 0);
  assert.strictEqual(J.data[1][1], J.data[2][1], 'renumber is OFF by default — duplicate stays');
  const H = ss.sheets.ProductionHistory;
  assert.strictEqual(H.data[1][8], J.data[1][0], 'history row 2 linked to AS017 job');
  assert.strictEqual(H.data[2][8], J.data[2][0], 'history row 3 linked to AS002CR job');
  assert.strictEqual(ss.sheets.ProductionReports.data[0].length, 28);
  assert.strictEqual(ss.sheets.ProductionNotifications.data[0].length, 12);
  eqJSON(ss.sheets.ProductionCounters.data[1].slice(0, 2), ['PRD-20261007', 1]);
  const units = ss.sheets.ProductionUnitRules.data.slice(1).map(r => r[0]);
  ['ชุด', 'ชิ้น', 'ใบ', 'อัน'].forEach(u => assert.ok(units.includes(u), 'unit ' + u));
  assert.ok(ss.sheets.ProductionUnitRules.data.slice(1).every(r => r[1] === 0 && r[2] === 'PENDING'));
  assert.ok(J.dv['2:4'] && J.dv['2:11'], 'validation on status/target');
  assert.strictEqual(J.dv['2:4'].allowInvalid, true, 'warn-only by default');
  applied = { ss, env, props };
});

test('idempotent: second apply is a no-op; verify OK', () => {
  const { ss, props } = applied; const before = snapshot(ss);
  const env2 = makeEnv(ss, props);
  const res = env2.ctx.applyMigration();
  assert.strictEqual(res.applied, false); assert.strictEqual(snapshot(ss), before);
  assert.strictEqual(env2.ctx.verifyMigration().ok, true);
});

test('rollback restores the original state exactly', () => {
  const ss = makeSpreadsheet(COPY_ID, liveLikeTabs()); const before = snapshot(ss);
  const props = { MIGRATION_CONFIRM: 'PRD-SCHEMA-P1:' + COPY_ID };
  const env = makeEnv(ss, props); env.ctx.applyMigration();
  const rb = env.ctx.rollbackMigration();
  eqJSON(rb.conflicts, []);
  assert.strictEqual(snapshot(ss), before);
});

test('rollback refuses to clobber data the app wrote after migration', () => {
  const ss = makeSpreadsheet(COPY_ID, liveLikeTabs());
  const props = { MIGRATION_CONFIRM: 'PRD-SCHEMA-P1:' + COPY_ID };
  const env = makeEnv(ss, props); env.ctx.applyMigration();
  ss.sheets.ProductionJobs.data[1][27] = 2;                     // app bumped version
  ss.sheets.ProductionReports.data.push(['prr-x', 'PRD-20261007-000002', 1, 'REPORT']); // app wrote a report
  const rb = env.ctx.rollbackMigration();
  assert.ok(rb.conflicts.some(c => /AB2/.test(c)));
  assert.ok(rb.conflicts.some(c => /ProductionReports/.test(c)));
  assert.ok(ss.sheets.ProductionReports, 'tab with app data kept');
  assert.strictEqual(ss.sheets.ProductionJobs.data[1][27], 2, 'app value kept');
});

test('aborts on headerless tab (state of this morning export)', () => {
  const ss = makeSpreadsheet(COPY_ID, liveLikeTabs({ ProductionJobs: { rows: FIXTURE.ProductionJobs_headerless, maxCols: 27 } }));
  const { ctx } = makeEnv(ss, {});
  const plan = ctx.dryRun();
  assert.ok(plan.aborts.some(a => /looks like DATA/.test(a)));
});

test('aborts on conflicting header where a new column should go', () => {
  const t = liveLikeTabs(); t.ProductionJobs.rows[0][27] = 'something_else';
  const ss = makeSpreadsheet(COPY_ID, t); const { ctx } = makeEnv(ss, {});
  assert.ok(ctx.dryRun().aborts.some(a => /AB1/.test(a)));
});

test('aborts when an existing header was renamed/reordered', () => {
  const t = liveLikeTabs(); t.ProductionHistory.rows[0][2] = 'action';
  const ss = makeSpreadsheet(COPY_ID, t); const { ctx } = makeEnv(ss, {});
  assert.ok(ctx.dryRun().aborts.some(a => /ProductionHistory!C1/.test(a)));
});

test('aborts on a second header row', () => {
  const t = liveLikeTabs(); t.ProductionHistory.rows.splice(1, 0, t.ProductionHistory.rows[0].slice());
  const ss = makeSpreadsheet(COPY_ID, t); const { ctx } = makeEnv(ss, {});
  assert.ok(ctx.dryRun().aborts.some(a => /only ONE header row/.test(a)));
});

test('renumber option (opt-in) fixes duplicate PRD-20261007-000001 and is reversible', () => {
  const ss = makeSpreadsheet(COPY_ID, liveLikeTabs()); const before = snapshot(ss);
  const props = { MIGRATION_CONFIRM: 'PRD-SCHEMA-P1:' + COPY_ID, MIGRATION_OPTIONS: JSON.stringify({ renumberDuplicateJobNo: true }) };
  const env = makeEnv(ss, props); const res = env.ctx.applyMigration();
  assert.strictEqual(res.remaining, 0);
  const J = ss.sheets.ProductionJobs.data, H = ss.sheets.ProductionHistory.data;
  assert.strictEqual(J[1][1], 'PRD-20261007-000001'); // earliest (AS017) keeps the number
  assert.strictEqual(J[2][1], 'PRD-20261007-000002'); // AS002CR renumbered
  assert.strictEqual(J[2][27], 2, 'version bumped');
  assert.strictEqual(H[2][1], 'PRD-20261007-000002');
  assert.strictEqual(H[3][2], 'RENUMBER');
  eqJSON(ss.sheets.ProductionCounters.data[1].slice(0, 2), ['PRD-20261007', 2]);
  const rb = env.ctx.rollbackMigration(); eqJSON(rb.conflicts, []);
  assert.strictEqual(snapshot(ss), before);
});

console.log(results.join('\n'));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
