// ============================================================================
// PHASE 2: DO NOT APPLY OR DEPLOY WITHOUT USER APPROVAL
// ----------------------------------------------------------------------------
// productionCommand — one signed Apps Script action that applies a whole
// production mutation (CAS on ProductionJobs.version + updated_at, job-number
// counter, de-duplicated appends, read-merge-write of read_by) inside the
// script-wide lock that doPost already holds. Deploying this means
// redeploying the LIVE Apps Script web app, which needs the user's explicit OK.
//
// Repo destination: scripts/migrations/production-schema-p1/phase2/production-command.gs
// This file is the testable source. google-apps-script.phase2.patch inlines
// this exact text into scripts/google-apps-script.gs (single-file deployment).
// It relies on helpers from scripts/google-apps-script.gs: getSheet,
// assertCellValue, sha256Hex, MAX_COLS_PER_ROW.
//
// Contract (all ops are checked first; nothing is written unless every
// precondition passes):
//   { action: 'productionCommand', command: 'report', actorId: 'u-1',
//     idempotencyKey: '<uuid>' (optional),
//     ops: [
//       { op: 'requireRow', sheetName: 'ProductionJobs', key: '<job_id>',
//         expectVersion: 3, expectUpdatedAt: '2026-10-09T01:00:00.000Z',
//         expectStatusIn: ['IN_PROGRESS'], requireNotDeleted: true },
//       { op: 'nextJobNo', date: '20261009', as: 'job_no' },
//       { op: 'updateRow', sheetName: 'ProductionJobs', key: '<job_id>',
//         set: { '4': 'COMPLETED', '27': '<iso>' }, bumpVersion: true },
//       { op: 'appendUnique', sheetName: 'ProductionReports', keyCol: 17,
//         row: [ ...28 values..., '{{job_no}}' placeholders allowed ] },
//       { op: 'addToJsonArray', sheetName: 'ProductionNotifications',
//         key: '<notif_id>', col: 7, value: '<user_id>' } ] }
//   Precondition failure  -> { success:false, code:'PRD_VERSION_CONFLICT' | ... , current:{...} } (no writes)
//   Success               -> { success:true, replayed:false, bound:{...}, versions:{...}, results:[...] }
//   Replay of a completed idempotencyKey -> cached result with replayed:true
// ============================================================================

var PRD_CMD_SHEETS = ['ProductionJobs', 'ProductionReports', 'ProductionHistory',
  'ProductionNotifications', 'ProductionCounters'];
var PRD_CMD_OPS = ['requireRow', 'updateRow', 'appendUnique', 'addToJsonArray', 'nextJobNo'];
var PRD_CMD_MAX_OPS = 50;
var PRD_JOB_STATUSES = ['DRAFT', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
// ProductionJobs columns (1-based) after migration PRD-SCHEMA-P1
var PRD_JOB_COL = { ID: 1, JOB_NO: 2, STATUS: 4, UPDATED_AT: 27, VERSION: 28, DECIMALS: 29, DELETED_AT: 30 };
// Columns appendUnique may de-duplicate on (A = id; plus the per-tab request/dedupe key)
var PRD_UNIQUE_COLS = {
  ProductionJobs: [1],
  ProductionReports: [1, 17],      // A report_id, Q idempotency_key
  ProductionHistory: [1, 12],      // A history_id, L request key
  ProductionNotifications: [1, 11] // A notif_id, K dedupe key
};
// Columns the server owns on ProductionJobs (never set by the client)
var PRD_JOB_SERVER_COLS = [PRD_JOB_COL.ID, PRD_JOB_COL.VERSION];
var PRD_IDEMP_PREFIX = 'prdcmd:';

function prdIsInt_(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
function prdStr_(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= max; }
function prdNorm_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return String(v).trim();
}

function validateProductionCommand(parsed) {
  if (!prdStr_(parsed.command, 40) || !/^[a-z][a-zA-Z0-9_-]*$/.test(parsed.command)) {
    throw new Error('VALIDATION: productionCommand requires a valid command name');
  }
  if (parsed.idempotencyKey !== undefined &&
      (!prdStr_(parsed.idempotencyKey, 200) || parsed.idempotencyKey.length < 8)) {
    throw new Error('VALIDATION: productionCommand idempotencyKey must be 8-200 chars');
  }
  if (parsed.actorId !== undefined && !prdStr_(parsed.actorId, 200)) {
    throw new Error('VALIDATION: productionCommand actorId is invalid');
  }
  if (!Array.isArray(parsed.ops) || parsed.ops.length === 0 || parsed.ops.length > PRD_CMD_MAX_OPS) {
    throw new Error('VALIDATION: productionCommand requires 1-' + PRD_CMD_MAX_OPS + ' ops');
  }
  var required = {};
  for (var i = 0; i < parsed.ops.length; i++) {
    var op = parsed.ops[i];
    var where = 'productionCommand op ' + i;
    if (!op || typeof op !== 'object' || PRD_CMD_OPS.indexOf(op.op) === -1) {
      throw new Error('ACTION_DENIED: Unknown ' + where);
    }
    if (op.op !== 'nextJobNo' && PRD_CMD_SHEETS.indexOf(op.sheetName) === -1) {
      throw new Error('SHEET_DENIED: ' + where + ' may not target "' + op.sheetName + '"');
    }
    if (op.op === 'requireRow') {
      if (!prdStr_(op.key, 200)) throw new Error('VALIDATION: ' + where + ' requires key');
      if (op.expectVersion !== undefined && !(prdIsInt_(op.expectVersion) && op.expectVersion >= 1)) {
        throw new Error('VALIDATION: ' + where + ' expectVersion must be an integer >= 1');
      }
      if (op.expectUpdatedAt !== undefined && !prdStr_(op.expectUpdatedAt, 64)) {
        throw new Error('VALIDATION: ' + where + ' expectUpdatedAt is invalid');
      }
      if (op.expectStatusIn !== undefined) {
        if (!Array.isArray(op.expectStatusIn) || op.expectStatusIn.length === 0 ||
            op.expectStatusIn.some(function (s) { return PRD_JOB_STATUSES.indexOf(s) === -1; })) {
          throw new Error('VALIDATION: ' + where + ' expectStatusIn is invalid');
        }
      }
      if (op.sheetName !== 'ProductionJobs' &&
          (op.expectVersion !== undefined || op.expectStatusIn !== undefined || op.requireNotDeleted)) {
        throw new Error('VALIDATION: ' + where + ' version/status checks apply to ProductionJobs only');
      }
      if (op.sheetName === 'ProductionJobs' && op.expectVersion === undefined) {
        throw new Error('VALIDATION: ' + where + ' must send expectVersion for ProductionJobs');
      }
      required[op.sheetName + '\u0000' + op.key] = true;
    } else if (op.op === 'updateRow') {
      if (!prdStr_(op.key, 200)) throw new Error('VALIDATION: ' + where + ' requires key');
      if (!op.set || typeof op.set !== 'object' || Array.isArray(op.set)) {
        throw new Error('VALIDATION: ' + where + ' requires set');
      }
      var cols = Object.keys(op.set);
      if (cols.length === 0 && !op.bumpVersion) throw new Error('VALIDATION: ' + where + ' sets nothing');
      cols.forEach(function (c) {
        var n = Number(c);
        if (!prdIsInt_(n) || n < 2 || n > MAX_COLS_PER_ROW) {
          throw new Error('VALIDATION: ' + where + ' column ' + c + ' is out of range 2-' + MAX_COLS_PER_ROW);
        }
        if (op.sheetName === 'ProductionJobs' && PRD_JOB_SERVER_COLS.indexOf(n) !== -1) {
          throw new Error('VALIDATION: ' + where + ' may not set server-owned column ' + n);
        }
        assertCellValue(op.set[c]);
      });
      if (op.bumpVersion && op.sheetName !== 'ProductionJobs') {
        throw new Error('VALIDATION: ' + where + ' bumpVersion applies to ProductionJobs only');
      }
      if (op.sheetName === 'ProductionJobs' && !required['ProductionJobs\u0000' + op.key]) {
        throw new Error('VALIDATION: ' + where + ' must follow a requireRow (version check) for the same job');
      }
      if (op.sheetName === 'ProductionJobs' && !op.bumpVersion) {
        throw new Error('VALIDATION: ' + where + ' must bumpVersion when changing a job');
      }
    } else if (op.op === 'appendUnique') {
      var allowedCols = PRD_UNIQUE_COLS[op.sheetName];
      if (!allowedCols || allowedCols.indexOf(op.keyCol) === -1) {
        throw new Error('VALIDATION: ' + where + ' keyCol is not a unique column of ' + op.sheetName);
      }
      if (!Array.isArray(op.row) || op.row.length === 0 || op.row.length > MAX_COLS_PER_ROW) {
        throw new Error('VALIDATION: ' + where + ' row must contain 1-' + MAX_COLS_PER_ROW + ' columns');
      }
      op.row.forEach(assertCellValue);
      if (!prdStr_(String(op.row[0] === null || op.row[0] === undefined ? '' : op.row[0]), 200) ||
          !prdStr_(String(op.row[op.keyCol - 1] === null || op.row[op.keyCol - 1] === undefined ? '' : op.row[op.keyCol - 1]), 200)) {
        throw new Error('VALIDATION: ' + where + ' row needs an id in column A and a value in keyCol');
      }
    } else if (op.op === 'addToJsonArray') {
      if (op.sheetName !== 'ProductionNotifications' || op.col !== 7) {
        throw new Error('VALIDATION: ' + where + ' only supports ProductionNotifications column G');
      }
      if (!prdStr_(op.key, 200) || !prdStr_(op.value, 200)) {
        throw new Error('VALIDATION: ' + where + ' requires key and value');
      }
    } else if (op.op === 'nextJobNo') {
      if (typeof op.date !== 'string' || !/^\d{8}$/.test(op.date)) {
        throw new Error('VALIDATION: ' + where + ' date must be YYYYMMDD');
      }
      if (typeof op.as !== 'string' || !/^[a-z_]{1,30}$/.test(op.as)) {
        throw new Error('VALIDATION: ' + where + ' as must be a placeholder name');
      }
    }
  }
}

// Must run while holding the script lock (doPost acquires it before routing).
function doProductionCommand(parsed) {
  var actorId = parsed.actorId || 'system';
  var idempKey = parsed.idempotencyKey ? PRD_IDEMP_PREFIX + parsed.command + ':' + parsed.idempotencyKey : null;
  var payloadHash = sha256Hex(JSON.stringify({ command: parsed.command, actorId: actorId, ops: parsed.ops }));
  var idempSheet = null;

  if (idempKey) {
    idempSheet = getSheet('Idempotency');
    var idempData = idempSheet.getDataRange().getValues();
    for (var i = 1; i < idempData.length; i++) {
      if (idempData[i][0] !== idempKey) continue;
      if (idempData[i][3] && idempData[i][3] !== payloadHash) {
        return { success: false, code: 'PRD_IDEMPOTENCY_KEY_REUSED', error: 'Key was already used with a different payload' };
      }
      if (idempData[i][4] === 'COMPLETED') {
        var cached = JSON.parse(idempData[i][5] || '{}');
        cached.replayed = true;
        return cached;
      }
      if (idempData[i][4] === 'PROCESSING') {
        return { success: false, code: 'PRD_IDEMPOTENCY_IN_PROGRESS', error: 'Command is being processed' };
      }
      return { success: false, code: 'PRD_IDEMPOTENCY_FAILED', error: 'Previous attempt failed mid-write; manual recovery required', detail: idempData[i][6] };
    }
  }

  // ---- Phase A: read + check everything, write nothing ----
  var cache = {};
  function tab(name) {
    if (!cache[name]) {
      var sh = getSheet(name);
      cache[name] = { sheet: sh, data: sh.getDataRange().getValues(), appended: 0, maxCols: sh.getMaxColumns() };
    }
    return cache[name];
  }
  function findRows(name, col, key) {
    var t = tab(name), out = [];
    for (var r = 1; r < t.data.length; r++) if (prdNorm_(t.data[r][col - 1]) === key) out.push(r);
    return out;
  }
  function fail(code, error, extra) {
    var res = { success: false, code: code, error: error };
    if (extra) Object.keys(extra).forEach(function (k) { res[k] = extra[k]; });
    return res;
  }
  function jobSnapshot(row) {
    return {
      job_id: prdNorm_(row[PRD_JOB_COL.ID - 1]), job_no: prdNorm_(row[PRD_JOB_COL.JOB_NO - 1]),
      status: prdNorm_(row[PRD_JOB_COL.STATUS - 1]), updated_at: prdNorm_(row[PRD_JOB_COL.UPDATED_AT - 1]),
      version: prdVersionOf_(row), deleted_at: prdNorm_(row[PRD_JOB_COL.DELETED_AT - 1])
    };
  }
  var bound = {};
  function bind(v) {
    if (typeof v !== 'string' || v.indexOf('{{') === -1) return v;
    return v.replace(/\{\{([a-z_]{1,30})\}\}/g, function (m, name) {
      if (!Object.prototype.hasOwnProperty.call(bound, name)) throw new Error('VALIDATION: unbound placeholder ' + m);
      return bound[name];
    });
  }

  var writes = [];      // { sheetName, row (0-based data index), col, value }
  var appends = [];     // { sheetName, values }
  var versions = {};    // job_id -> new version
  var bumped = {};
  var results = [];

  for (var k = 0; k < parsed.ops.length; k++) {
    var op = parsed.ops[k];
    if (op.op === 'requireRow') {
      var hits = findRows(op.sheetName, 1, op.key);
      if (hits.length === 0) return fail('PRD_ROW_NOT_FOUND', op.sheetName + ' ' + op.key + ' not found', { op: k });
      if (hits.length > 1) return fail('PRD_DUPLICATE_KEY', op.sheetName + ' ' + op.key + ' appears ' + hits.length + ' times', { op: k });
      var row = tab(op.sheetName).data[hits[0]];
      if (op.sheetName === 'ProductionJobs') {
        var cur = jobSnapshot(row);
        if (op.requireNotDeleted && cur.deleted_at) return fail('PRD_ROW_DELETED', 'job was deleted', { op: k, current: cur });
        if (op.expectStatusIn && op.expectStatusIn.indexOf(cur.status) === -1) {
          return fail('PRD_INVALID_TRANSITION', 'status is ' + cur.status, { op: k, current: cur });
        }
        if (cur.version !== op.expectVersion) {
          return fail('PRD_VERSION_CONFLICT', 'expected version ' + op.expectVersion + ' but found ' + cur.version,
            { op: k, expected_version: op.expectVersion, current: cur });
        }
        if (op.expectUpdatedAt !== undefined && cur.updated_at !== op.expectUpdatedAt) {
          return fail('PRD_VERSION_CONFLICT', 'updated_at changed', { op: k, expected_updated_at: op.expectUpdatedAt, current: cur });
        }
      }
      results.push({ op: k, rowNumber: hits[0] + 1 });
    } else if (op.op === 'updateRow') {
      var uh = findRows(op.sheetName, 1, op.key);
      if (uh.length !== 1) return fail(uh.length ? 'PRD_DUPLICATE_KEY' : 'PRD_ROW_NOT_FOUND', op.sheetName + ' ' + op.key, { op: k });
      var t = tab(op.sheetName), ri = uh[0];
      Object.keys(op.set).forEach(function (c) {
        var n = Number(c);
        if (n > t.maxCols) throw new Error('VALIDATION: ' + op.sheetName + ' column ' + n + ' is beyond the sheet grid (run migration PRD-SCHEMA-P1 first)');
        var v = bind(op.set[c]);
        writes.push({ sheetName: op.sheetName, row: ri, col: n, value: v });
        t.data[ri][n - 1] = v;
      });
      if (op.bumpVersion && !bumped[op.key]) {
        if (PRD_JOB_COL.VERSION > t.maxCols) throw new Error('VALIDATION: ProductionJobs has no version column (run migration PRD-SCHEMA-P1 first)');
        var next = prdVersionOf_(t.data[ri]) + 1;
        writes.push({ sheetName: op.sheetName, row: ri, col: PRD_JOB_COL.VERSION, value: next });
        t.data[ri][PRD_JOB_COL.VERSION - 1] = next;
        bumped[op.key] = true; versions[op.key] = next;
      }
      results.push({ op: k, rowNumber: ri + 1 });
    } else if (op.op === 'appendUnique') {
      var at = tab(op.sheetName);
      var vals = op.row.map(bind);
      if (vals.length > at.maxCols) throw new Error('VALIDATION: ' + op.sheetName + ' row is wider than the sheet grid');
      var keyVal = prdNorm_(vals[op.keyCol - 1]);
      var dupe = findRows(op.sheetName, op.keyCol, keyVal);
      var idDupe = op.keyCol === 1 ? dupe : findRows(op.sheetName, 1, prdNorm_(vals[0]));
      if (dupe.length) { results.push({ op: k, skipped: true, reason: 'duplicate key', rowNumber: dupe[0] + 1 }); continue; }
      if (idDupe.length) return fail('PRD_DUPLICATE_KEY', op.sheetName + ' id ' + prdNorm_(vals[0]) + ' already exists with another key', { op: k });
      at.data.push(vals.slice());
      at.appended++;
      appends.push({ sheetName: op.sheetName, values: vals });
      results.push({ op: k, appended: true });
    } else if (op.op === 'addToJsonArray') {
      var nh = findRows(op.sheetName, 1, op.key);
      if (nh.length !== 1) return fail(nh.length ? 'PRD_DUPLICATE_KEY' : 'PRD_ROW_NOT_FOUND', op.sheetName + ' ' + op.key, { op: k });
      var nt = tab(op.sheetName), raw = prdNorm_(nt.data[nh[0]][op.col - 1]), arr;
      try { arr = raw ? JSON.parse(raw) : []; } catch (e) { return fail('PRD_CORRUPT_CELL', op.sheetName + ' ' + op.key + ' read_by is not JSON', { op: k }); }
      if (!Array.isArray(arr)) return fail('PRD_CORRUPT_CELL', op.sheetName + ' ' + op.key + ' read_by is not an array', { op: k });
      if (arr.indexOf(op.value) === -1) {
        arr.push(op.value);
        var json = JSON.stringify(arr);
        writes.push({ sheetName: op.sheetName, row: nh[0], col: op.col, value: json });
        nt.data[nh[0]][op.col - 1] = json;
        results.push({ op: k, rowNumber: nh[0] + 1 });
      } else {
        results.push({ op: k, skipped: true, reason: 'already present', rowNumber: nh[0] + 1 });
      }
    } else if (op.op === 'nextJobNo') {
      var counterKey = 'PRD-' + op.date;
      var ct = tab('ProductionCounters');
      var ch = findRows('ProductionCounters', 1, counterKey);
      if (ch.length > 1) return fail('PRD_DUPLICATE_KEY', 'ProductionCounters ' + counterKey, { op: k });
      var last = ch.length ? Number(ct.data[ch[0]][1]) || 0 : 0;
      var n2 = last + 1, jobNo;
      // never hand out a number that already exists (live already has a duplicate)
      while (true) {
        jobNo = counterKey + '-' + ('000000' + n2).slice(-6);
        if (!findRows('ProductionJobs', PRD_JOB_COL.JOB_NO, jobNo).length) break;
        n2++;
      }
      var nowIso = new Date().toISOString();
      if (ch.length) {
        writes.push({ sheetName: 'ProductionCounters', row: ch[0], col: 2, value: n2 });
        writes.push({ sheetName: 'ProductionCounters', row: ch[0], col: 3, value: nowIso });
        writes.push({ sheetName: 'ProductionCounters', row: ch[0], col: 4, value: parsed.command + ':' + actorId });
        ct.data[ch[0]][1] = n2;
      } else {
        var crow = [counterKey, n2, nowIso, parsed.command + ':' + actorId];
        ct.data.push(crow.slice()); ct.appended++;
        appends.push({ sheetName: 'ProductionCounters', values: crow });
      }
      bound[op.as] = jobNo;
      results.push({ op: k, bound: op.as, value: jobNo });
    }
  }

  var response = { success: true, replayed: false, command: parsed.command, bound: bound, versions: versions, results: results };

  // ---- Phase B: write (all preconditions passed) ----
  var idempRow = null, createdAt = new Date().toISOString();
  if (idempKey) {
    idempSheet.appendRow([idempKey, 'productionCommand:' + parsed.command, actorId, payloadHash, 'PROCESSING', '', '', createdAt, createdAt]);
    idempRow = idempSheet.getLastRow();
  }
  try {
    writes.forEach(function (w) {
      tab(w.sheetName).sheet.getRange(w.row + 1, w.col).setValue(w.value);
    });
    appends.forEach(function (a) {
      var sh = tab(a.sheetName).sheet;
      var lastRow = sh.getLastRow();
      if (lastRow + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
      sh.getRange(lastRow + 1, 1, 1, a.values.length).setValues([a.values]);
    });
    SpreadsheetApp.flush();
  } catch (err) {
    if (idempRow) {
      idempSheet.getRange(idempRow, 5, 1, 5).setValues([['FAILED', '', String(err).slice(0, 1000), createdAt, new Date().toISOString()]]);
      SpreadsheetApp.flush();
    }
    throw err;
  }
  if (idempRow) {
    idempSheet.getRange(idempRow, 5, 1, 5).setValues([['COMPLETED', JSON.stringify(response), '', createdAt, new Date().toISOString()]]);
    SpreadsheetApp.flush();
  }
  return response;
}

// Blank version (rows written before migration / by old code) counts as 1.
// A non-integer value returns 0, which never matches expectVersion (>= 1), so the
// command fails closed with PRD_VERSION_CONFLICT instead of overwriting.
function prdVersionOf_(row) {
  var v = row[PRD_JOB_COL.VERSION - 1];
  if (v === '' || v === null || v === undefined) return 1;
  var n = Number(v);
  return prdIsInt_(n) && n >= 1 ? n : 0;
}
