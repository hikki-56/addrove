/**
 * Stockify — Production module schema migration "PRD-SCHEMA-P1"
 * ------------------------------------------------------------------------
 * Repo destination: scripts/migrations/production-schema-p1/production-schema-p1.gs
 * Design doc:       docs/production-schema-proposal.md (PRODUCTION_SCHEMA_PROPOSAL.md)
 *
 * WHAT IT DOES (all positional-safe):
 *   1. Checks row 1 headers of ProductionJobs / ProductionHistory /
 *      ProductionReports / ProductionNotifications against the expected
 *      layout. Aborts on ANY mismatch, headerless tab, or second header row.
 *   2. Appends NEW columns only at the END of each tab (never inserts,
 *      reorders or renames columns/tabs). Row 1 stays the single header row.
 *   3. Creates missing tabs (ProductionReports, ProductionNotifications,
 *      ProductionCounters, ProductionUnitRules) with a header row.
 *   4. Backfills the new columns (version=1, decimal_places, job_id links),
 *      normalises ProductionJobs!C (production date) to text YYYY-MM-DD,
 *      seeds job-number counters and unit rules (decimals=0, PENDING).
 *   5. Optional: renumbers duplicate job numbers (OFF by default),
 *      data-validation rules (ON, warn-only markers — never "reject" by default
 *      because Apps Script setValues can throw on rejected input), warning-only
 *      protection (OFF).
 *
 * SAFETY:
 *   - DRY RUN BY DEFAULT: dryRun() only plans and logs. applyMigration()
 *     refuses to run unless Script Property MIGRATION_CONFIRM equals
 *     "PRD-SCHEMA-P1:<spreadsheetId of THIS file>".
 *   - Refuses to touch the LIVE spreadsheet unless Script Property
 *     MIGRATION_ALLOW_LIVE equals "USER-APPROVED:PRD-SCHEMA-P1:<live id>".
 *     That value must only be set after the user explicitly approves.
 *   - Idempotent: re-running after success plans 0 actions.
 *   - Before writing: full Drive copy of the file + JSON snapshot of the
 *     production tabs + a JSON change log (cell before/after values).
 *   - rollbackMigration() reverses using the change log, only where the
 *     current value still equals what the migration wrote (unless force).
 *   - Runs under LockService.getScriptLock(); if pasted into the SAME
 *     container-bound project as the Stockify web app, this also blocks
 *     app writes (doPost uses the same script lock) for the duration.
 *
 * Never put secrets in this file. It needs no credentials: it runs as the
 * spreadsheet owner from Extensions → Apps Script of the TARGET file.
 */

var MIGRATION_ID = 'PRD-SCHEMA-P1';
var LIVE_SPREADSHEET_ID = '1tsndbJWnXPvY3_LQhtzVNPRMJxqjan3ScQXSvIUKPg4';
var BACKUP_FOLDER_NAME = 'Stockify-migration-backups';
var MAX_COLS_PER_ROW_APP = 30; // script-signer.ts + google-apps-script.gs limit

var DEFAULT_OPTIONS = {
  renumberDuplicateJobNo: false, // needs explicit user decision (open question)
  normalizeProductionDate: true,
  applyDataValidation: true,     // warn-only markers (see strictValidation)
  strictValidation: false,       // true = "reject input". Apps Script setValues (the app's write path)
                                 // can THROW on rejected values, so keep false unless tested on the copy.
  applyProtection: false,        // needs explicit user decision
  force: false                   // rollback only: override conflict checks
};

var JOB_STATUSES = ['DRAFT', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
var PRIORITIES = ['NORMAL', 'URGENT', 'CRITICAL'];
var WAREHOUSE_UNIT_TABS = ['\u0e42\u0e01\u0e14\u0e31\u0e071', '\u0e42\u0e01\u0e14\u0e31\u0e072',
  '\u0e42\u0e01\u0e14\u0e31\u0e073', '\u0e42\u0e01\u0e14\u0e31\u0e074', '\u0e42\u0e01\u0e14\u0e31\u0e075',
  '\u0e2a\u0e33\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e43\u0e2b\u0e0d\u0e48']; // โกดัง1-5, สำนักงานใหญ่

// ---------------------------------------------------------------------------
// Layout spec. `existing` = columns that already exist (must match exactly,
// same order). `append` = columns added at the end, in this order.
// ---------------------------------------------------------------------------
var SPEC = {
  ProductionJobs: {
    idPrefix: 'prj-',
    createIfMissing: false,
    existing: ['job_id', 'เลขใบสั่งผลิต', 'วันที่ผลิต', 'สถานะ', 'โต๊ะ', 'ความสำคัญ', 'product_id',
      'รหัสสินค้า', 'ชื่อสินค้า', 'หน่วย', 'เป้าหมาย', 'หมายเหตุ', 'ตำแหน่งเก็บ',
      'ผู้สร้าง', 'ชื่อผู้สร้าง', 'สร้างเมื่อ', 'ส่งงานเมื่อ', 'ผู้เริ่มผลิต', 'เริ่มเมื่อ',
      'จบเมื่อ', 'ยกเลิกเมื่อ', 'ชื่อผู้ยกเลิก', 'เหตุผลยกเลิก', 'เหตุผลจบงาน', 'เหตุผลเปิดใหม่',
      'จำนวนครั้งเปิดใหม่', 'อัปเดตเมื่อ'],
    append: ['version', 'ทศนิยมที่อนุญาต', 'ลบร่างเมื่อ'] // AB, AC, AD
  },
  ProductionReports: {
    idPrefix: 'prr-',
    createIfMissing: true,
    existing: ['report_id', 'เลขใบสั่งผลิต', 'รอบที่', 'ชนิด', 'ประเภทรายงาน', 'ผลิตดี', 'ของเสีย',
      'สาเหตุของเสีย', 'เหตุผล', 'หมายเหตุ', 'ลิงก์รูปภาพ', 'ผู้รายงาน', 'ชื่อผู้รายงาน',
      'รายงานเมื่อ', 'ดีสะสม', 'เสียสะสม', 'idempotency_key'],
    append: ['สถานะรายงาน', 'job_id', 'ดีสะสมก่อน', 'เสียสะสมก่อน', 'สถานะงานก่อน', 'สถานะงานหลัง',
      'version งานหลังบันทึก', 'โกดังรับเข้า', 'คีย์ movement สต๊อก', 'สถานะลงสต๊อก', 'หน่วย'] // R..AB
  },
  ProductionHistory: {
    idPrefix: 'prh-',
    createIfMissing: false,
    existing: ['history_id', 'เลขใบสั่งผลิต', 'การกระทำ', 'ผู้ดำเนินการ', 'ชื่อผู้ดำเนินการ', 'เมื่อ',
      'เหตุผล', 'รายละเอียด (JSON)'],
    append: ['job_id', 'version ก่อน', 'version หลัง', 'คีย์คำขอ'] // I..L
  },
  ProductionNotifications: {
    idPrefix: 'prn-',
    createIfMissing: true,
    existing: ['notif_id', 'ถึงบทบาท', 'เลขใบสั่งผลิต', 'ข้อความ', 'สร้างเมื่อ', 'ผู้แจ้ง', 'อ่านแล้วโดย (JSON)'],
    // H type + I payload(JSON) follow api-contract.md §3.4; J..L are DB-side links/dedupe
    append: ['ประเภท', 'ข้อมูลประกอบ (JSON)', 'job_id', 'คีย์กันแจ้งซ้ำ', 'ถึงผู้ใช้'] // H..L
  },
  ProductionCounters: {
    idPrefix: 'PRD-',
    createIfMissing: true,
    existing: [],
    append: ['counter_key', 'เลขล่าสุด', 'อัปเดตเมื่อ', 'อัปเดตโดย']
  },
  ProductionUnitRules: {
    idPrefix: null,
    createIfMissing: true,
    existing: [],
    append: ['หน่วย', 'ทศนิยมที่อนุญาต', 'สถานะยืนยัน', 'หมายเหตุ', 'อัปเดตเมื่อ']
  }
};
var TAB_ORDER = ['ProductionJobs', 'ProductionReports', 'ProductionHistory', 'ProductionNotifications',
  'ProductionCounters', 'ProductionUnitRules'];

// ===========================================================================
// Public entry points (run from the Apps Script editor)
// ===========================================================================

/** Plan only. Never writes. */
function dryRun() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var opts = loadOptions_();
  var plan = buildPlan_(ss, opts);
  logPlan_(plan, 'DRY RUN');
  return plan;
}

/** Apply. Requires MIGRATION_CONFIRM (and MIGRATION_ALLOW_LIVE for the live file). */
function applyMigration() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertTargetAllowed_(ss, 'apply');
  var opts = loadOptions_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('LOCK_TIMEOUT: could not acquire script lock');
  try {
    var plan = buildPlan_(ss, opts);
    logPlan_(plan, 'APPLY (pre-check)');
    if (plan.aborts.length) throw new Error('ABORTED: ' + plan.aborts.join(' | '));
    if (plan.actions.length === 0) {
      Logger.log('Nothing to do — migration already applied (idempotent no-op).');
      return { applied: false, plan: plan };
    }
    var backup = makeBackup_(ss);
    var log = { migrationId: MIGRATION_ID, spreadsheetId: ss.getId(), startedAt: new Date().toISOString(),
      options: opts, backup: backup, entries: [] };
    try {
      executePlan_(ss, plan, log);
      log.finishedAt = new Date().toISOString();
      log.status = 'COMPLETED';
    } catch (e) {
      log.status = 'FAILED';
      log.error = String(e);
      throw e;
    } finally {
      saveLog_(ss, log, backup.folderId);
    }
    var after = buildPlan_(ss, opts);
    Logger.log('Post-apply re-plan: ' + after.actions.length + ' action(s) remaining (expected 0).');
    return { applied: true, plan: plan, log: log, remaining: after.actions.length };
  } finally {
    lock.releaseLock();
  }
}

/** Read-only checks after apply. */
function verifyMigration() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var plan = buildPlan_(ss, loadOptions_());
  var ok = plan.aborts.length === 0 && plan.actions.length === 0;
  Logger.log((ok ? 'VERIFY OK' : 'VERIFY FAILED') + ' — actions pending: ' + plan.actions.length +
    ', aborts: ' + JSON.stringify(plan.aborts) + ', findings: ' + JSON.stringify(plan.findings));
  return { ok: ok, plan: plan };
}

/** Reverse the last apply on THIS file using its change log. */
function rollbackMigration() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  assertTargetAllowed_(ss, 'rollback');
  var opts = loadOptions_();
  var props = PropertiesService.getScriptProperties();
  var fileId = props.getProperty('MIGRATION_LOG_FILE_ID_' + ss.getId());
  if (!fileId) throw new Error('No migration log found for this spreadsheet.');
  var log = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('LOCK_TIMEOUT');
  try {
    var result = rollbackFromLog_(ss, log, opts);
    Logger.log('ROLLBACK ' + (result.conflicts.length ? 'PARTIAL' : 'OK') + ': ' + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

// ===========================================================================
// Guards & options
// ===========================================================================

function loadOptions_() {
  var raw = PropertiesService.getScriptProperties().getProperty('MIGRATION_OPTIONS');
  var opts = {};
  for (var k in DEFAULT_OPTIONS) opts[k] = DEFAULT_OPTIONS[k];
  if (raw) {
    var o = JSON.parse(raw);
    for (var k2 in o) if (Object.prototype.hasOwnProperty.call(DEFAULT_OPTIONS, k2)) opts[k2] = o[k2];
  }
  return opts;
}

function assertTargetAllowed_(ss, mode) {
  var props = PropertiesService.getScriptProperties();
  var id = ss.getId();
  var confirm = props.getProperty('MIGRATION_CONFIRM');
  if (confirm !== MIGRATION_ID + ':' + id) {
    throw new Error('REFUSED (' + mode + '): set Script Property MIGRATION_CONFIRM = "' + MIGRATION_ID + ':' + id +
      '" to confirm the target. Default is dry run — use dryRun().');
  }
  if (id === LIVE_SPREADSHEET_ID) {
    var allow = props.getProperty('MIGRATION_ALLOW_LIVE');
    if (allow !== 'USER-APPROVED:' + MIGRATION_ID + ':' + LIVE_SPREADSHEET_ID) {
      throw new Error('REFUSED (' + mode + '): this is the LIVE production spreadsheet. ' +
        'It requires the user\'s explicit approval (Script Property MIGRATION_ALLOW_LIVE). Run on a COPY first.');
    }
  }
}

// ===========================================================================
// Planning (read-only)
// ===========================================================================

function norm_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function colLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function pad6_(n) { var s = String(n); while (s.length < 6) s = '0' + s; return s; }
function isBlank_(v) { return norm_(v) === ''; }

function readAll_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 1) return [];
  return sheet.getRange(1, 1, lastRow, lastCol).getValues();
}

function buildPlan_(ss, opts) {
  var plan = { migrationId: MIGRATION_ID, spreadsheetId: ss.getId(), spreadsheetName: ss.getName(),
    isLive: ss.getId() === LIVE_SPREADSHEET_ID, options: opts, actions: [], aborts: [], warnings: [], findings: {} };
  var tz = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : 'Asia/Bangkok';
  var state = {};

  // ---- 1) header / layout checks ----
  TAB_ORDER.forEach(function (tab) {
    var spec = SPEC[tab];
    var full = spec.existing.concat(spec.append);
    if (full.length > MAX_COLS_PER_ROW_APP) plan.aborts.push(tab + ': layout has ' + full.length + ' cols > app limit ' + MAX_COLS_PER_ROW_APP);
    var sheet = ss.getSheetByName(tab);
    if (!sheet) {
      if (spec.createIfMissing) {
        plan.actions.push({ type: 'createTab', tab: tab, headers: full });
        state[tab] = { created: true, rows: [full], appendPending: [] };
      } else {
        plan.aborts.push(tab + ': tab is missing (expected to exist)');
      }
      return;
    }
    var values = readAll_(sheet);
    var row1 = values[0] || [];
    var row2 = values[1] || [];
    // headerless tab? (row 1 is a data row)
    if (spec.idPrefix && norm_(row1[0]).indexOf(spec.idPrefix) === 0 && tab !== 'ProductionCounters') {
      plan.aborts.push(tab + ': row 1 looks like DATA (' + norm_(row1[0]).slice(0, 12) + '…). Insert a header row ABOVE row 1 first (separate, approved step). Never type over row 1.');
      return;
    }
    if (tab === 'ProductionCounters' && /^PRD-\d{8}$/.test(norm_(row1[0]))) {
      plan.aborts.push(tab + ': row 1 looks like data'); return;
    }
    if (full.length && norm_(row2[0]) === full[0]) {
      plan.aborts.push(tab + ': row 2 repeats the header text — only ONE header row is allowed');
    }
    // existing columns must match exactly
    for (var i = 0; i < spec.existing.length; i++) {
      if (norm_(row1[i]) !== spec.existing[i]) {
        plan.aborts.push(tab + '!' + colLetter_(i + 1) + '1: expected "' + spec.existing[i] + '" but found "' + norm_(row1[i]) + '"');
      }
    }
    // appended columns: present (skip) / empty column (add) / conflict (abort)
    var pending = [];
    for (var j = 0; j < spec.append.length; j++) {
      var pos = spec.existing.length + j; // 0-based
      var h = norm_(row1[pos]);
      if (h === spec.append[j]) continue;
      if (h !== '') {
        plan.aborts.push(tab + '!' + colLetter_(pos + 1) + '1: expected empty or "' + spec.append[j] + '" but found "' + h + '"');
        continue;
      }
      var hasData = false;
      for (var r = 1; r < values.length; r++) if (!isBlank_(values[r][pos])) { hasData = true; break; }
      if (hasData) { plan.aborts.push(tab + '!' + colLetter_(pos + 1) + ': header empty but column has data — refusing to guess'); continue; }
      pending.push(j);
    }
    // anything beyond the spec width?
    for (var x = full.length; x < row1.length; x++) {
      if (!isBlank_(row1[x])) plan.warnings.push(tab + '!' + colLetter_(x + 1) + '1 has unexpected header "' + norm_(row1[x]) + '" beyond spec width');
    }
    if (pending.length) {
      // contiguity: never leave a gap — all pending must be the tail
      for (var p = 0; p < pending.length; p++) {
        if (pending[p] !== spec.append.length - pending.length + p) {
          plan.aborts.push(tab + ': appended columns are partially present out of order — manual review required');
          break;
        }
      }
      var needCols = full.length;
      if (sheet.getMaxColumns() < needCols) plan.actions.push({ type: 'ensureGridColumns', tab: tab, needed: needCols, have: sheet.getMaxColumns() });
      plan.actions.push({ type: 'writeHeaders', tab: tab, startCol: spec.existing.length + pending[0] + 1,
        headers: pending.map(function (q) { return spec.append[q]; }) });
    }
    state[tab] = { created: false, rows: values, appendPending: pending };
  });
  if (plan.aborts.length) return plan;

  var jobs = (state.ProductionJobs.rows || []).slice(1);
  var jobsSpec = SPEC.ProductionJobs;
  var J = { id: 0, no: 1, date: 2, status: 3, table: 4, prio: 5, pid: 6, sku: 7, unit: 9, target: 10,
    createdAt: 15, updatedAt: 26, reopen: 25, version: 27, decimals: 28, deletedAt: 29 };

  // ---- 2) unit rules (seed distinct units, decimals 0, PENDING) ----
  var unitRows = (state.ProductionUnitRules.rows || []).slice(1);
  var knownUnits = {};
  unitRows.forEach(function (r) { if (!isBlank_(r[0])) knownUnits[norm_(r[0])] = Number(r[1]); });
  var discovered = {};
  function addUnit(u) { u = norm_(u); if (u && !/^#/.test(u)) discovered[u] = true; }
  var bh = ss.getSheetByName('BOM_Headers'); if (bh) readAll_(bh).slice(1).forEach(function (r) { addUnit(r[4]); });
  var bi = ss.getSheetByName('BOM_Items'); if (bi) readAll_(bi).slice(1).forEach(function (r) { addUnit(r[6]); });
  WAREHOUSE_UNIT_TABS.forEach(function (t) { var s = ss.getSheetByName(t); if (s) readAll_(s).slice(1).forEach(function (r) { addUnit(r[4]); }); });
  jobs.forEach(function (r) { addUnit(r[J.unit]); });
  addUnit('ชิ้น');
  var nowIso = new Date().toISOString();
  var newUnits = Object.keys(discovered).filter(function (u) { return !(u in knownUnits); }).sort();
  if (newUnits.length) {
    plan.actions.push({ type: 'seedRows', tab: 'ProductionUnitRules', rows: newUnits.map(function (u) {
      return [u, 0, 'PENDING', 'ค่าเริ่มต้นจาก ' + MIGRATION_ID + ' (จำนวนเต็ม) — รอผู้ใช้ยืนยัน', nowIso];
    }) });
  }
  var unitDecimals = {};
  Object.keys(discovered).forEach(function (u) { unitDecimals[u] = 0; });
  Object.keys(knownUnits).forEach(function (u) { unitDecimals[u] = isFinite(knownUnits[u]) ? knownUnits[u] : 0; });

  // ---- 3) data findings on jobs ----
  var seenId = {}, byNo = {};
  var f = { duplicateJobId: [], duplicateJobNo: [], invalidStatus: [], invalidTable: [], nonPositiveTarget: [],
    badVersion: [], productionDateNotIso: [], historyUnlinked: [], reportFindings: [] };
  jobs.forEach(function (r, i) {
    var rowNo = i + 2, id = norm_(r[J.id]);
    if (!id) return;
    if (seenId[id]) f.duplicateJobId.push(id); seenId[id] = true;
    var no = norm_(r[J.no]);
    if (no) (byNo[no] = byNo[no] || []).push({ row: rowNo, id: id, createdAt: norm_(r[J.createdAt]), sku: norm_(r[J.sku]), r: r });
    if (JOB_STATUSES.indexOf(norm_(r[J.status]).toUpperCase()) < 0) f.invalidStatus.push(rowNo);
    var t = Number(r[J.table]); if (!(t >= 1 && t <= 5 && t === Math.floor(t))) f.invalidTable.push(rowNo);
    var tg = Number(r[J.target]); if (!(tg > 0)) f.nonPositiveTarget.push(rowNo);
    var v = r[J.version]; if (!isBlank_(v) && !(Number(v) >= 1 && Number(v) === Math.floor(Number(v)))) f.badVersion.push(rowNo);
  });
  Object.keys(byNo).forEach(function (no) { if (byNo[no].length > 1) f.duplicateJobNo.push({ job_no: no, rows: byNo[no].map(function (x) { return x.row; }), job_ids: byNo[no].map(function (x) { return x.id; }) }); });
  if (f.badVersion.length) plan.aborts.push('ProductionJobs: non-integer/invalid version values at rows ' + f.badVersion.join(','));

  // ---- 4) backfill ProductionJobs new columns ----
  var jobCells = [];
  jobs.forEach(function (r, i) {
    var rowNo = i + 2, id = norm_(r[J.id]);
    if (!id) return;
    if (isBlank_(r[J.version])) jobCells.push({ row: rowNo, col: J.version + 1, key: id, before: '', after: 1 });
    if (isBlank_(r[J.decimals])) {
      var d = unitDecimals[norm_(r[J.unit])]; if (!(d >= 0)) d = 0;
      jobCells.push({ row: rowNo, col: J.decimals + 1, key: id, before: '', after: d });
    }
  });

  // production date → text YYYY-MM-DD
  var dateCells = [];
  if (opts.normalizeProductionDate) {
    jobs.forEach(function (r, i) {
      var rowNo = i + 2, id = norm_(r[J.id]); if (!id) return;
      var v = r[J.date], ymd = null, kind = typeof v;
      if (v instanceof Date) { ymd = Utilities.formatDate(v, tz, 'yyyy-MM-dd'); kind = 'date'; }
      else if (typeof v === 'number' && v > 30000 && v < 80000) { ymd = serialToYmd_(v); kind = 'serial'; }
      else if (/^\d{4}-\d{2}-\d{2}$/.test(norm_(v))) { ymd = null; }
      else { f.productionDateNotIso.push({ row: rowNo, value: norm_(v) }); }
      if (ymd) dateCells.push({ row: rowNo, col: J.date + 1, key: id, before: { t: kind, ymd: ymd }, after: ymd });
    });
    plan.actions.push({ type: 'setTextFormat', tab: 'ProductionJobs', col: J.date + 1, onlyIfNot: '@' });
  }
  if (dateCells.length) plan.actions.push({ type: 'writeCells', tab: 'ProductionJobs', purpose: 'normalize production_date', cells: dateCells, textFormat: true });

  // ---- 5) optional renumbering of duplicate job_no ----
  var counters = {};
  function bump(no) { var m = /^(PRD-\d{8})-(\d{1,})$/.exec(no); if (m) { var n = parseInt(m[2], 10); if (!(counters[m[1]] >= n)) counters[m[1]] = n; } }
  Object.keys(byNo).forEach(bump);
  var renumberMap = {}; // job_id -> {old,new,row}
  var historyAppends = [];
  if (f.duplicateJobNo.length) {
    if (opts.renumberDuplicateJobNo) {
      f.duplicateJobNo.forEach(function (d) {
        var group = byNo[d.job_no].slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.row - b.row; });
        var prefix = d.job_no.replace(/-\d+$/, '');
        group.slice(1).forEach(function (g) {
          counters[prefix] = (counters[prefix] || 0) + 1;
          var newNo = prefix + '-' + pad6_(counters[prefix]);
          renumberMap[g.id] = { oldNo: d.job_no, newNo: newNo, row: g.row };
          var vBefore = Number(g.r[J.version]) || 1;
          jobCells.push({ row: g.row, col: J.no + 1, key: g.id, before: d.job_no, after: newNo });
          // version bump: replace the version backfill for this row (or add)
          var vb = jobCells.filter(function (c) { return c.row === g.row && c.col === J.version + 1; })[0];
          if (vb) vb.after = vBefore + 1; else jobCells.push({ row: g.row, col: J.version + 1, key: g.id, before: g.r[J.version], after: vBefore + 1 });
          jobCells.push({ row: g.row, col: J.updatedAt + 1, key: g.id, before: norm_(g.r[J.updatedAt]), after: nowIso });
          historyAppends.push([newHistoryId_(), newNo, 'RENUMBER', 'system-migration', 'Migration ' + MIGRATION_ID, nowIso,
            'แก้เลขใบสั่งผลิตซ้ำ (เลขเดิมถูกใช้กับงานอื่น)', JSON.stringify({ old_job_no: d.job_no, new_job_no: newNo, migration: MIGRATION_ID }),
            g.id, vBefore, vBefore + 1, MIGRATION_ID + ':renumber:' + g.id]);
        });
      });
    } else {
      plan.warnings.push('Duplicate job_no left as-is (renumberDuplicateJobNo=false): ' + JSON.stringify(f.duplicateJobNo));
    }
  }
  if (jobCells.length) plan.actions.push({ type: 'writeCells', tab: 'ProductionJobs', purpose: 'backfill version/decimal_places' + (Object.keys(renumberMap).length ? ' + renumber' : ''), cells: jobCells });

  // ---- 6) ProductionHistory: backfill job_id (I) + renumbered job_no ----
  var hist = (state.ProductionHistory.rows || []).slice(1);
  var histCells = [];
  hist.forEach(function (r, i) {
    var rowNo = i + 2, hid = norm_(r[0]); if (!hid) return;
    if (!isBlank_(r[8])) return; // already linked
    var no = norm_(r[1]), cands = byNo[no] || [];
    var jobId = null;
    if (cands.length === 1) jobId = cands[0].id;
    else if (cands.length > 1) {
      var sku = null; try { sku = JSON.parse(norm_(r[7]) || '{}').sku || null; } catch (e) { sku = null; }
      var at = norm_(r[5]);
      var m = cands.filter(function (c) { return sku && c.sku === sku && (!c.createdAt || c.createdAt <= at); });
      if (m.length === 1) jobId = m[0].id;
    }
    if (!jobId) { f.historyUnlinked.push(rowNo); return; }
    histCells.push({ row: rowNo, col: 9, key: hid, before: '', after: jobId });
    if (renumberMap[jobId] && no === renumberMap[jobId].oldNo) histCells.push({ row: rowNo, col: 2, key: hid, before: no, after: renumberMap[jobId].newNo });
  });
  if (histCells.length) plan.actions.push({ type: 'writeCells', tab: 'ProductionHistory', purpose: 'backfill job_id', cells: histCells });
  if (historyAppends.length) plan.actions.push({ type: 'appendRows', tab: 'ProductionHistory', rows: historyAppends, keyCol: 1 });

  // ---- 7) ProductionReports (only if it already had rows) ----
  if (!state.ProductionReports.created) {
    var reps = state.ProductionReports.rows.slice(1), repCells = [], seenKey = {};
    var jobUnitById = {}; jobs.forEach(function (r) { jobUnitById[norm_(r[J.id])] = norm_(r[J.unit]); });
    reps.forEach(function (r, i) {
      var rowNo = i + 2, rid = norm_(r[0]); if (!rid) return;
      var k = norm_(r[16]); if (k) { if (seenKey[k]) f.reportFindings.push('duplicate idempotency_key row ' + rowNo); seenKey[k] = true; }
      var kind = norm_(r[3]).toUpperCase();
      if (kind === 'REPORT' && (Number(r[5]) < 0 || Number(r[6]) < 0)) f.reportFindings.push('negative qty in REPORT row ' + rowNo);
      if (isBlank_(r[17])) repCells.push({ row: rowNo, col: 18, key: rid, before: '', after: 'CONFIRMED' });
      var cands = byNo[norm_(r[1])] || [];
      var jid = cands.length === 1 ? cands[0].id : null;
      if (isBlank_(r[18])) { if (jid) repCells.push({ row: rowNo, col: 19, key: rid, before: '', after: jid }); else f.reportFindings.push('cannot link job_id row ' + rowNo); }
      if (isBlank_(r[19]) && !isBlank_(r[14])) repCells.push({ row: rowNo, col: 20, key: rid, before: '', after: Number(r[14]) - Number(r[5] || 0) });
      if (isBlank_(r[20]) && !isBlank_(r[15])) repCells.push({ row: rowNo, col: 21, key: rid, before: '', after: Number(r[15]) - Number(r[6] || 0) });
      if (isBlank_(r[27]) && jid && jobUnitById[jid]) repCells.push({ row: rowNo, col: 28, key: rid, before: '', after: jobUnitById[jid] });
    });
    if (repCells.length) plan.actions.push({ type: 'writeCells', tab: 'ProductionReports', purpose: 'backfill report links', cells: repCells });
  }

  // ---- 8) ProductionNotifications legacy rows ----
  if (!state.ProductionNotifications.created) {
    var nCells = [];
    state.ProductionNotifications.rows.slice(1).forEach(function (r, i) {
      var rowNo = i + 2, nid = norm_(r[0]); if (!nid) return;
      var cands = byNo[norm_(r[2])] || [];
      // H type = LEGACY (contract §3.4); I payload stays blank (API returns null fields); J job_id when unambiguous
      if (isBlank_(r[7])) nCells.push({ row: rowNo, col: 8, key: nid, before: '', after: 'LEGACY' });
      if (isBlank_(r[9]) && cands.length === 1) nCells.push({ row: rowNo, col: 10, key: nid, before: '', after: cands[0].id });
      if (isBlank_(r[10])) nCells.push({ row: rowNo, col: 11, key: nid, before: '', after: 'legacy:' + nid });
    });
    if (nCells.length) plan.actions.push({ type: 'writeCells', tab: 'ProductionNotifications', purpose: 'backfill legacy notifications', cells: nCells });
  }

  // ---- 9) counters ----
  var ctrRows = (state.ProductionCounters.rows || []).slice(1), ctrExisting = {};
  ctrRows.forEach(function (r, i) { if (!isBlank_(r[0])) ctrExisting[norm_(r[0])] = { row: i + 2, value: Number(r[1]) || 0 }; });
  var ctrSeed = [], ctrCells = [];
  Object.keys(counters).sort().forEach(function (k) {
    if (!(k in ctrExisting)) ctrSeed.push([k, counters[k], nowIso, MIGRATION_ID]);
    else if (ctrExisting[k].value < counters[k]) ctrCells.push({ row: ctrExisting[k].row, col: 2, key: k, before: ctrExisting[k].value, after: counters[k] });
  });
  if (ctrSeed.length) plan.actions.push({ type: 'seedRows', tab: 'ProductionCounters', rows: ctrSeed });
  if (ctrCells.length) plan.actions.push({ type: 'writeCells', tab: 'ProductionCounters', purpose: 'raise counters to max used', cells: ctrCells });

  // ---- 10) data validation / protection ----
  if (opts.applyDataValidation) {
    validationRules_().forEach(function (v) {
      var sheet = ss.getSheetByName(v.tab);
      if (sheet && sheet.getMaxRows() >= 2) {
        var existing = sheet.getRange(2, v.col).getDataValidation();
        if (existing) { if (!(existing.getHelpText && existing.getHelpText() === v.help)) plan.warnings.push(v.tab + '!' + colLetter_(v.col) + ': has an existing validation rule — left untouched'); return; }
      }
      plan.actions.push({ type: 'dataValidation', tab: v.tab, col: v.col, rule: v });
    });
  }
  if (opts.applyProtection) {
    ['ProductionJobs', 'ProductionReports', 'ProductionHistory', 'ProductionNotifications', 'ProductionCounters', 'ProductionUnitRules'].forEach(function (tab) {
      var sheet = ss.getSheetByName(tab);
      var already = sheet && sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).some(function (p) { return p.getDescription() === MIGRATION_ID; });
      if (!already) plan.actions.push({ type: 'protectWarningOnly', tab: tab });
    });
  }

  // setTextFormat is a no-op when already '@' → drop it from the plan in that case
  plan.actions = plan.actions.filter(function (a) {
    if (a.type !== 'setTextFormat') return true;
    var s = ss.getSheetByName(a.tab);
    return !s || s.getMaxRows() < 2 || s.getRange(2, a.col).getNumberFormat() !== '@';
  });

  plan.findings = f;
  return plan;
}

function validationRules_() {
  var j = 'ProductionJobs', r = 'ProductionReports';
  return [
    { tab: j, col: 4, list: JOB_STATUSES, help: MIGRATION_ID + ': สถานะต้องเป็น ' + JOB_STATUSES.join('/') },
    { tab: j, col: 5, formula: '=AND(ISNUMBER(E2),E2>=1,E2<=5,E2=INT(E2))', help: MIGRATION_ID + ': โต๊ะ 1–5 จำนวนเต็ม' },
    { tab: j, col: 6, list: PRIORITIES, help: MIGRATION_ID + ': ความสำคัญ NORMAL/URGENT/CRITICAL' },
    { tab: j, col: 11, formula: '=AND(ISNUMBER(K2),K2>0,OR(AC2="",ROUND(K2,AC2)=K2))', help: MIGRATION_ID + ': เป้าหมายต้องมากกว่า 0 และทศนิยมไม่เกินค่าในคอลัมน์ AC' },
    { tab: j, col: 26, formula: '=AND(ISNUMBER(Z2),Z2>=0,Z2=INT(Z2))', help: MIGRATION_ID + ': จำนวนครั้งเปิดใหม่ ≥ 0' },
    { tab: j, col: 28, formula: '=AND(ISNUMBER(AB2),AB2>=1,AB2=INT(AB2))', help: MIGRATION_ID + ': version จำนวนเต็ม ≥ 1' },
    { tab: j, col: 29, formula: '=AND(ISNUMBER(AC2),AC2>=0,AC2<=3,AC2=INT(AC2))', help: MIGRATION_ID + ': ทศนิยม 0–3' },
    { tab: r, col: 4, list: ['REPORT', 'ADJUSTMENT'], help: MIGRATION_ID + ': ชนิด REPORT/ADJUSTMENT' },
    { tab: r, col: 5, formula: '=OR(E2="",E2="PARTIAL",E2="FINAL")', help: MIGRATION_ID + ': PARTIAL/FINAL/ว่าง' },
    { tab: r, col: 6, formula: '=OR($D2="ADJUSTMENT",AND(ISNUMBER(F2),F2>=0))', help: MIGRATION_ID + ': ผลิตดีห้ามติดลบ (ยกเว้นรายการปรับปรุง)' },
    { tab: r, col: 7, formula: '=OR($D2="ADJUSTMENT",AND(ISNUMBER(G2),G2>=0))', help: MIGRATION_ID + ': ของเสียห้ามติดลบ (ยกเว้นรายการปรับปรุง)' },
    { tab: r, col: 15, formula: '=AND(ISNUMBER(O2),O2>=0)', help: MIGRATION_ID + ': ดีสะสมห้ามติดลบ' },
    { tab: r, col: 16, formula: '=AND(ISNUMBER(P2),P2>=0)', help: MIGRATION_ID + ': เสียสะสมห้ามติดลบ' },
    { tab: r, col: 18, list: ['CONFIRMED'], help: MIGRATION_ID + ': สถานะรายงาน CONFIRMED' },
    { tab: 'ProductionNotifications', col: 2, list: ['ADMIN', 'APPROVER'], help: MIGRATION_ID + ': ถึงบทบาท ADMIN/APPROVER' },
    { tab: 'ProductionCounters', col: 2, formula: '=AND(ISNUMBER(B2),B2>=0,B2=INT(B2))', help: MIGRATION_ID + ': เลขล่าสุด ≥ 0' },
    { tab: 'ProductionUnitRules', col: 2, formula: '=AND(ISNUMBER(B2),B2>=0,B2<=3,B2=INT(B2))', help: MIGRATION_ID + ': ทศนิยม 0–3' },
    { tab: 'ProductionUnitRules', col: 3, list: ['CONFIRMED', 'PENDING'], help: MIGRATION_ID + ': CONFIRMED/PENDING' }
  ];
}

function serialToYmd_(serial) {
  var ms = Math.round((serial - 25569) * 86400000); // 25569 = 1970-01-01
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
function newHistoryId_() { return 'prh-' + Utilities.getUuid(); }

function logPlan_(plan, label) {
  var summary = plan.actions.map(function (a) {
    return a.type + ' ' + a.tab + (a.cells ? ' (' + a.cells.length + ' cells: ' + a.purpose + ')' : '') +
      (a.rows ? ' (' + a.rows.length + ' rows)' : '') + (a.headers ? ' ' + JSON.stringify(a.headers) : '') +
      (a.col ? ' col ' + colLetter_(a.col) : '');
  });
  Logger.log('=== ' + label + ' — ' + MIGRATION_ID + ' on "' + plan.spreadsheetName + '" (' + plan.spreadsheetId + ')' + (plan.isLive ? ' [LIVE!]' : ''));
  Logger.log('Options: ' + JSON.stringify(plan.options));
  Logger.log('ABORTS (' + plan.aborts.length + '): ' + JSON.stringify(plan.aborts));
  Logger.log('WARNINGS (' + plan.warnings.length + '): ' + JSON.stringify(plan.warnings));
  Logger.log('ACTIONS (' + plan.actions.length + '):\n  ' + summary.join('\n  '));
  Logger.log('FINDINGS: ' + JSON.stringify(plan.findings));
}

// ===========================================================================
// Execution
// ===========================================================================

function executePlan_(ss, plan, log) {
  plan.actions.forEach(function (a) {
    var sheet = ss.getSheetByName(a.tab);
    switch (a.type) {
      case 'createTab': {
        if (sheet) throw new Error('createTab: ' + a.tab + ' appeared concurrently — re-run dryRun()');
        sheet = ss.insertSheet(a.tab);
        if (sheet.getMaxColumns() < a.headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), a.headers.length - sheet.getMaxColumns());
        sheet.getRange(1, 1, 1, a.headers.length).setValues([a.headers]).setFontWeight('bold');
        sheet.setFrozenRows(1);
        log.entries.push({ type: 'createTab', tab: a.tab, headers: a.headers });
        break;
      }
      case 'ensureGridColumns': {
        var have = sheet.getMaxColumns();
        if (have < a.needed) sheet.insertColumnsAfter(have, a.needed - have); // grid columns at the END only
        log.entries.push({ type: 'ensureGridColumns', tab: a.tab, before: have, after: Math.max(have, a.needed) });
        break;
      }
      case 'writeHeaders': {
        var rng = sheet.getRange(1, a.startCol, 1, a.headers.length);
        var cur = rng.getValues()[0];
        cur.forEach(function (c, k) { if (!isBlank_(c)) throw new Error('writeHeaders: ' + a.tab + '!' + colLetter_(a.startCol + k) + '1 is no longer empty'); });
        rng.setValues([a.headers]).setFontWeight('bold');
        log.entries.push({ type: 'writeHeaders', tab: a.tab, startCol: a.startCol, headers: a.headers });
        break;
      }
      case 'setTextFormat': {
        var r2 = sheet.getRange(2, a.col, Math.max(sheet.getMaxRows() - 1, 1), 1);
        var prev = sheet.getRange(2, a.col).getNumberFormat();
        r2.setNumberFormat('@');
        log.entries.push({ type: 'setTextFormat', tab: a.tab, col: a.col, before: prev });
        break;
      }
      case 'writeCells': {
        a.cells.forEach(function (c) {
          // verify-before-write: the row must still belong to the same record
          var keyNow = norm_(sheet.getRange(c.row, 1).getValue());
          if (keyNow !== c.key) throw new Error('writeCells: ' + a.tab + ' row ' + c.row + ' key changed ("' + keyNow + '" != "' + c.key + '") — rows moved; aborting');
          var cell = sheet.getRange(c.row, c.col);
          if (a.textFormat) cell.setNumberFormat('@');
          cell.setValue(c.after);
          log.entries.push({ type: 'cell', tab: a.tab, row: c.row, col: c.col, key: c.key, before: c.before, after: c.after, purpose: a.purpose });
        });
        break;
      }
      case 'seedRows':
      case 'appendRows': {
        var start = sheet.getLastRow() + 1;
        var width = a.rows[0].length;
        if (sheet.getMaxRows() < start + a.rows.length - 1) sheet.insertRowsAfter(sheet.getMaxRows(), start + a.rows.length - 1 - sheet.getMaxRows());
        if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
        sheet.getRange(start, 1, a.rows.length, width).setValues(a.rows);
        log.entries.push({ type: 'rows', tab: a.tab, keys: a.rows.map(function (r) { return String(r[0]); }), count: a.rows.length });
        break;
      }
      case 'dataValidation': {
        var v = a.rule;
        var b = SpreadsheetApp.newDataValidation();
        b = v.list ? b.requireValueInList(v.list, true) : b.requireFormulaSatisfied(v.formula);
        var rule = b.setAllowInvalid(!plan.options.strictValidation).setHelpText(v.help).build();
        sheet.getRange(2, v.col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
        log.entries.push({ type: 'dataValidation', tab: a.tab, col: v.col, help: v.help });
        break;
      }
      case 'protectWarningOnly': {
        var p = sheet.protect().setDescription(MIGRATION_ID);
        p.setWarningOnly(true);
        log.entries.push({ type: 'protect', tab: a.tab });
        break;
      }
      default:
        throw new Error('Unknown action ' + a.type);
    }
  });
  SpreadsheetApp.flush();
}

// ===========================================================================
// Backup, log, rollback
// ===========================================================================

function getBackupFolder_() {
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

function makeBackup_(ss) {
  var folder = getBackupFolder_();
  var stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyyMMdd-HHmmss");
  var copy = DriveApp.getFileById(ss.getId()).makeCopy('BACKUP ' + ss.getName() + ' before ' + MIGRATION_ID + ' ' + stamp, folder);
  var snap = {};
  TAB_ORDER.forEach(function (t) { var s = ss.getSheetByName(t); if (s) snap[t] = { maxColumns: s.getMaxColumns(), values: readAll_(s) }; });
  var snapFile = folder.createFile(MIGRATION_ID + '-snapshot-' + ss.getId() + '-' + stamp + '.json', JSON.stringify(snap), 'application/json');
  Logger.log('Backup copy: ' + copy.getId() + ' · snapshot: ' + snapFile.getId());
  return { folderId: folder.getId(), copyFileId: copy.getId(), snapshotFileId: snapFile.getId(), stamp: stamp };
}

function saveLog_(ss, log, folderId) {
  var folder = DriveApp.getFolderById(folderId);
  var file = folder.createFile(MIGRATION_ID + '-changelog-' + ss.getId() + '-' + log.backup.stamp + '.json', JSON.stringify(log, null, 1), 'application/json');
  PropertiesService.getScriptProperties().setProperty('MIGRATION_LOG_FILE_ID_' + ss.getId(), file.getId());
  Logger.log('Change log: ' + file.getId() + ' (' + log.entries.length + ' entries, status ' + log.status + ')');
}

function rollbackFromLog_(ss, log, opts) {
  if (log.spreadsheetId !== ss.getId()) throw new Error('Log belongs to another spreadsheet');
  var res = { restoredCells: 0, clearedColumns: 0, deletedTabs: 0, deletedRows: 0, removedValidations: 0, removedProtections: 0, conflicts: [] };
  var entries = log.entries.slice().reverse();
  var createdTabs = {};
  entries.forEach(function (e) { if (e.type === 'createTab') createdTabs[e.tab] = true; });

  entries.forEach(function (e) {
    var sheet = ss.getSheetByName(e.tab);
    if (!sheet) return;
    if (createdTabs[e.tab] && e.type !== 'createTab') return; // whole tab handled below
    if (e.type === 'protect') {
      sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { if (p.getDescription() === MIGRATION_ID) { p.remove(); res.removedProtections++; } });
    } else if (e.type === 'dataValidation') {
      var rg = sheet.getRange(2, e.col, Math.max(sheet.getMaxRows() - 1, 1), 1);
      var cur = sheet.getRange(2, e.col).getDataValidation();
      if (cur && cur.getHelpText() === e.help) { rg.setDataValidation(null); res.removedValidations++; }
    } else if (e.type === 'rows') {
      e.keys.forEach(function (k) {
        var vals = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues();
        for (var i = vals.length - 1; i >= 1; i--) if (norm_(vals[i][0]) === k) { sheet.deleteRow(i + 1); res.deletedRows++; break; }
      });
    } else if (e.type === 'cell') {
      var keyNow = norm_(sheet.getRange(e.row, 1).getValue());
      var cell = sheet.getRange(e.row, e.col);
      var curV = cell.getValue();
      var same = norm_(curV) === norm_(e.after);
      if (keyNow !== e.key || (!same && !opts.force)) { res.conflicts.push(e.tab + '!' + colLetter_(e.col) + e.row + ' changed since migration (now "' + norm_(curV) + '")'); return; }
      if (e.before && typeof e.before === 'object' && e.before.ymd) {
        cell.setNumberFormat('yyyy-mm-dd'); cell.setValue(e.before.ymd); // re-parsed as a date like the original
      } else {
        cell.setValue(e.before === undefined ? '' : e.before);
      }
      res.restoredCells++;
    } else if (e.type === 'setTextFormat') {
      // restore previous format only for rows that are not text-typed app data
      sheet.getRange(2, e.col, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat(e.before || 'yyyy-mm-dd');
    } else if (e.type === 'writeHeaders') {
      for (var k = 0; k < e.headers.length; k++) {
        var col = e.startCol + k;
        var last = sheet.getLastRow();
        var data = last >= 2 ? sheet.getRange(2, col, last - 1, 1).getValues() : [];
        var appData = data.some(function (r) { return !isBlank_(r[0]); });
        if (appData && !opts.force) { res.conflicts.push(e.tab + '!' + colLetter_(col) + ' still has data after cell restore — not cleared (use force)'); continue; }
        sheet.getRange(1, col, Math.max(last, 1), 1).clearContent();
        res.clearedColumns++;
      }
    }
  });
  Object.keys(createdTabs).forEach(function (t) {
    var s = ss.getSheetByName(t); if (!s) return;
    var seeded = 0; log.entries.forEach(function (e) { if (e.type === 'rows' && e.tab === t) seeded += e.count; });
    var dataRows = Math.max(s.getLastRow() - 1, 0);
    if (dataRows > seeded && !opts.force) { res.conflicts.push(t + ': has ' + (dataRows - seeded) + ' row(s) written after migration — tab kept (use force)'); return; }
    ss.deleteSheet(s); res.deletedTabs++;
  });
  SpreadsheetApp.flush();
  return res;
}
