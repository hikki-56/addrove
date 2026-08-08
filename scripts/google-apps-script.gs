/**
 * Google Apps Script for Stockify Google Sheets Backend
 *
 * DEPLOYMENT INSTRUCTIONS:
 * 1. Open your target Google Spreadsheet.
 * 2. Go to Extensions -> Apps Script.
 * 3. Replace all code in Code.gs with this script.
 * 4. Open Project Settings (gear icon) -> Script Properties.
 * 5. Add a property named "SIGNING_SECRET" with the same value as
 *    your Vercel GOOGLE_SCRIPT_SIGNING_SECRET environment variable.
 * 6. Click Deploy -> New deployment.
 * 7. Select type: "Web app".
 * 8. Set Execute as: "Me" (your Google account).
 * 9. Set Who has access: "Anyone" (needed for Vercel webhook POST).
 * 10. Copy the Web App URL and set it as GOOGLE_SCRIPT_URL in Vercel.
 *
 * SECURITY MODEL:
 * - The Web App is accessible to "Anyone" so Vercel can call it.
 * - EVERY mutation request must include a valid HMAC-SHA256 signed envelope.
 * - The SIGNING_SECRET is stored in Script Properties (never hard-coded).
 * - Requests with missing, invalid, expired, or replayed signatures are rejected.
 * - doGet is read-only and returns no sensitive information.
 */

// ---- Configuration ----

var ALLOWED_ACTIONS = ['ping', 'append', 'update', 'deleteRow', 'atomicStockOperation'];
var ALLOWED_SHEETS = [
  'Warehouses', 'Locations', 'Shelves', 'PRODUCTS', 'Documents',
  'StockMovements', 'StockSummary', 'StockCounts', 'Users',
  '\u0e1b\u0e23\u0e30\u0e27\u0e31\u0e15\u0e34\u0e01\u0e32\u0e23\u0e40\u0e02\u0e49\u0e32\u0e23\u0e30\u0e1a\u0e1a', 'Idempotency', 'AuditLog', 'OperationJournal',
  '\u0e42\u0e01\u0e14\u0e31\u0e071', '\u0e42\u0e01\u0e14\u0e31\u0e072', '\u0e42\u0e01\u0e14\u0e31\u0e073', '\u0e42\u0e01\u0e14\u0e31\u0e074', '\u0e42\u0e01\u0e14\u0e31\u0e075'
];

var MAX_PAYLOAD_BYTES = 500000; // 500 KB
var MAX_ROWS_PER_APPEND = 100;
var MAX_COLS_PER_ROW = 30;
var TIMESTAMP_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
var NONCE_CACHE_TTL_SECONDS = 360; // 6 minutes (> timestamp window)

// ---- Helpers ----

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(error, code) {
  return jsonResponse({ success: false, error: error, code: code || 'ERROR' });
}

// ---- HMAC-SHA256 Verification ----

function getSigningSecret() {
  var secret = PropertiesService.getScriptProperties().getProperty('SIGNING_SECRET');
  if (!secret) {
    throw new Error('SIGNING_SECRET not configured in Script Properties');
  }
  return secret;
}

function computeHmac(secret, message) {
  var signature = Utilities.computeHmacSha256Signature(message, secret);
  return signature.map(function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
}

/**
 * Timing-safe string comparison.
 * Iterates through every character regardless of mismatch.
 */
function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  var len = Math.max(a.length, b.length);
  var result = a.length === b.length ? 0 : 1;
  for (var i = 0; i < len; i++) {
    var ca = i < a.length ? a.charCodeAt(i) : 0;
    var cb = i < b.length ? b.charCodeAt(i) : 0;
    result |= ca ^ cb;
  }
  return result === 0;
}

/**
 * Verify the signed envelope. Returns the parsed payload object.
 * Throws on any verification failure.
 */
function verifyEnvelope(envelope) {
  // 1. Required fields
  if (!envelope || !envelope.timestamp || !envelope.nonce ||
      !envelope.payload || !envelope.signature) {
    throw new Error('HMAC_MISSING: Missing required envelope fields');
  }

  // 2. Timestamp freshness
  var now = Date.now();
  var age = now - Number(envelope.timestamp);
  if (age > TIMESTAMP_MAX_AGE_MS || age < -30000) {
    throw new Error('HMAC_EXPIRED: Timestamp outside acceptable window');
  }

  // 3. Nonce replay check
  var cache = CacheService.getScriptCache();
  var nonceKey = 'nonce_' + envelope.nonce;
  if (cache.get(nonceKey) !== null) {
    throw new Error('HMAC_REPLAY: Nonce already used');
  }

  // 4. Verify signature
  var secret = getSigningSecret();
  var message = envelope.timestamp + '.' + envelope.nonce + '.' + envelope.payload;
  var expected = computeHmac(secret, message);

  if (!timingSafeCompare(envelope.signature, expected)) {
    throw new Error('HMAC_INVALID: Signature mismatch');
  }

  // 5. Store nonce to prevent replay
  cache.put(nonceKey, '1', NONCE_CACHE_TTL_SECONDS);

  // 6. Parse and return payload
  return JSON.parse(envelope.payload);
}

// ---- Payload Validation ----

function validatePayload(parsed) {
  var action = parsed.action;

  // Action allowlist
  if (ALLOWED_ACTIONS.indexOf(action) === -1) {
    throw new Error('ACTION_DENIED: Unknown action "' + action + '"');
  }

  // Sheet allowlist (except ping)
  if (action !== 'ping' && action !== 'atomicStockOperation') {
    if (!parsed.sheetName) {
      throw new Error('VALIDATION: Missing sheetName');
    }
    if (ALLOWED_SHEETS.indexOf(parsed.sheetName) === -1) {
      throw new Error('SHEET_DENIED: Unknown sheet "' + parsed.sheetName + '"');
    }
  }

  // Per-action validation
  if (action === 'append') {
    if (!Array.isArray(parsed.values) || parsed.values.length === 0) {
      throw new Error('VALIDATION: append requires non-empty values array');
    }
    if (parsed.values.length > MAX_ROWS_PER_APPEND) {
      throw new Error('VALIDATION: append max ' + MAX_ROWS_PER_APPEND + ' rows per request');
    }
    for (var i = 0; i < parsed.values.length; i++) {
      if (!Array.isArray(parsed.values[i]) || parsed.values[i].length > MAX_COLS_PER_ROW) {
        throw new Error('VALIDATION: each row must be an array with max ' + MAX_COLS_PER_ROW + ' columns');
      }
    }
  }

  if (action === 'update') {
    var rowNum = Number(parsed.rowNumber);
    if (!rowNum || rowNum < 2) {
      throw new Error('VALIDATION: update rowNumber must be >= 2');
    }
    if (!Array.isArray(parsed.values) || parsed.values.length > MAX_COLS_PER_ROW) {
      throw new Error('VALIDATION: update values must be an array with max ' + MAX_COLS_PER_ROW + ' columns');
    }
  }

  if (action === 'deleteRow') {
    var delRow = Number(parsed.rowNumber);
    if (!delRow || delRow < 2) {
      throw new Error('VALIDATION: deleteRow rowNumber must be >= 2');
    }
  }

  if (action === 'atomicStockOperation') {
    if (!parsed.idempotencyKey || !parsed.operationType) {
      throw new Error('VALIDATION: atomicStockOperation requires idempotencyKey and operationType');
    }
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error('VALIDATION: atomicStockOperation requires non-empty steps array');
    }
    // Validate each step's sheetName
    for (var j = 0; j < parsed.steps.length; j++) {
      var step = parsed.steps[j];
      if (step.sheetName && ALLOWED_SHEETS.indexOf(step.sheetName) === -1) {
        throw new Error('SHEET_DENIED: Unknown sheet "' + step.sheetName + '" in step ' + j);
      }
    }
  }
}

// ---- Sheet Operations ----

function getSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    // Do NOT auto-create sheets — fail closed
    throw new Error('SHEET_NOT_FOUND: Sheet "' + sheetName + '" does not exist');
  }
  return sheet;
}

function doAppend(parsed) {
  var sheet = getSheet(parsed.sheetName);
  var values = parsed.values;
  var lastRow = sheet.getLastRow();
  var numRows = values.length;
  var numCols = values[0].length;
  sheet.getRange(lastRow + 1, 1, numRows, numCols).setValues(values);
  SpreadsheetApp.flush();
  return { success: true, message: 'Appended rows successfully', rowCount: numRows };
}

function doUpdate(parsed) {
  var sheet = getSheet(parsed.sheetName);
  var rowNumber = Number(parsed.rowNumber);
  var rowValues = parsed.values;

  if (rowNumber > sheet.getLastRow()) {
    throw new Error('VALIDATION: rowNumber exceeds last row');
  }

  sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]);
  SpreadsheetApp.flush();
  return { success: true, message: 'Updated row successfully', rowNumber: rowNumber };
}

function doDeleteRow(parsed) {
  var sheet = getSheet(parsed.sheetName);
  var rowNumber = Number(parsed.rowNumber);

  if (rowNumber > sheet.getLastRow()) {
    throw new Error('VALIDATION: rowNumber exceeds last row');
  }

  sheet.deleteRow(rowNumber);
  SpreadsheetApp.flush();
  return { success: true, message: 'Deleted row successfully', rowNumber: rowNumber };
}

// ---- Atomic Stock Operation ----

/**
 * Execute a multi-step stock operation within a single LockService lock.
 *
 * Steps are executed sequentially. If the idempotency key has already been
 * processed, the cached result is returned immediately.
 *
 * The lock prevents concurrent execution across ALL Vercel instances.
 */
function doAtomicStockOperation(parsed) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Check idempotency within the lock
  var idempSheet = ss.getSheetByName('Idempotency');
  if (idempSheet) {
    var idempData = idempSheet.getDataRange().getValues();
    for (var i = 1; i < idempData.length; i++) {
      if (idempData[i][0] === parsed.idempotencyKey) {
        if (idempData[i][3] === 'COMPLETED') {
          // Return cached result
          var cachedResult = {};
          try {
            cachedResult = JSON.parse(idempData[i][4] || '{}');
          } catch (e) { /* ignore parse error */ }
          return {
            success: true,
            isReplay: true,
            result: cachedResult,
            message: 'Idempotent replay — already completed'
          };
        }
        if (idempData[i][3] === 'PROCESSING') {
          throw new Error('IDEMPOTENCY_IN_PROGRESS: Operation is currently being processed');
        }
      }
    }
  }

  // Record IN_PROGRESS
  if (!idempSheet) {
    idempSheet = ss.insertSheet('Idempotency');
    idempSheet.getRange(1, 1, 1, 6).setValues([['key', 'operation_type', 'actor_id', 'status', 'response_payload', 'timestamp']]);
  }
  var inProgressRow = [
    parsed.idempotencyKey,
    parsed.operationType,
    parsed.actorId || 'system',
    'PROCESSING',
    '',
    new Date().toISOString()
  ];
  idempSheet.appendRow(inProgressRow);
  var idempRowNum = idempSheet.getLastRow();
  SpreadsheetApp.flush();

  // Record journal
  var journalSheet = ss.getSheetByName('OperationJournal');
  if (!journalSheet) {
    journalSheet = ss.insertSheet('OperationJournal');
    journalSheet.getRange(1, 1, 1, 7).setValues([['operation_id', 'idempotency_key', 'operation_type', 'status', 'steps', 'last_error', 'timestamp']]);
  }
  var operationId = 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  journalSheet.appendRow([
    operationId,
    parsed.idempotencyKey,
    parsed.operationType,
    'IN_PROGRESS',
    JSON.stringify(parsed.steps.map(function(s) { return s.action; })),
    '',
    new Date().toISOString()
  ]);
  var journalRowNum = journalSheet.getLastRow();
  SpreadsheetApp.flush();

  var stepResults = [];
  var completedStepCount = 0;

  try {
    // Execute each step
    for (var s = 0; s < parsed.steps.length; s++) {
      var step = parsed.steps[s];

      if (step.action === 'append' && step.sheetName) {
        if (ALLOWED_SHEETS.indexOf(step.sheetName) === -1) {
          throw new Error('SHEET_DENIED: "' + step.sheetName + '"');
        }
        var appendSheet = getSheet(step.sheetName);
        var vals = step.values;
        if (Array.isArray(vals) && vals.length > 0) {
          var lr = appendSheet.getLastRow();
          appendSheet.getRange(lr + 1, 1, vals.length, vals[0].length).setValues(vals);
        }
        stepResults.push({ step: s, action: 'append', sheetName: step.sheetName, rowCount: vals ? vals.length : 0 });
      }

      else if (step.action === 'update' && step.sheetName) {
        if (ALLOWED_SHEETS.indexOf(step.sheetName) === -1) {
          throw new Error('SHEET_DENIED: "' + step.sheetName + '"');
        }
        var updateSheet = getSheet(step.sheetName);
        var rn = Number(step.rowNumber);
        if (rn < 2 || rn > updateSheet.getLastRow()) {
          throw new Error('VALIDATION: Invalid rowNumber ' + rn);
        }
        updateSheet.getRange(rn, 1, 1, step.values.length).setValues([step.values]);
        stepResults.push({ step: s, action: 'update', sheetName: step.sheetName, rowNumber: rn });
      }

      else if (step.action === 'updateStatus' && step.sheetName) {
        if (ALLOWED_SHEETS.indexOf(step.sheetName) === -1) {
          throw new Error('SHEET_DENIED: "' + step.sheetName + '"');
        }
        var statusSheet = getSheet(step.sheetName);
        // Find row by document_id in column A
        var statusData = statusSheet.getDataRange().getValues();
        var found = false;
        for (var r = 1; r < statusData.length; r++) {
          if (statusData[r][0] === step.documentId) {
            // Status is typically in a specific column; use step.statusColumn or default to column index from step
            var statusCol = step.statusColumnIndex || 4; // 0-indexed, so column E
            statusSheet.getRange(r + 1, statusCol + 1).setValue(step.newStatus);
            found = true;
            stepResults.push({ step: s, action: 'updateStatus', rowNumber: r + 1 });
            break;
          }
        }
        if (!found) {
          throw new Error('DOCUMENT_NOT_FOUND: ' + step.documentId);
        }
      }

      else if (step.action === 'checkBalance') {
        // Read StockMovements sheet and compute balance for product/warehouse/location
        var movSheet = ss.getSheetByName('StockMovements');
        if (!movSheet) {
          throw new Error('SHEET_NOT_FOUND: StockMovements');
        }
        var movData = movSheet.getDataRange().getValues();
        var balance = 0;
        // Columns: movement_id(0), document_id(1), product_id(2), warehouse_id(3), location_id(4), qty_change(5)
        for (var m = 1; m < movData.length; m++) {
          if (movData[m][2] === step.productId &&
              movData[m][3] === step.warehouseId &&
              movData[m][4] === step.locationId) {
            balance += Number(movData[m][5]) || 0;
          }
        }
        if (typeof step.minRequired === 'number' && balance < step.minRequired) {
          throw new Error('INSUFFICIENT_STOCK: Balance=' + balance + ' Required=' + step.minRequired);
        }
        stepResults.push({ step: s, action: 'checkBalance', balance: balance });
      }

      completedStepCount = s + 1;
    }

    SpreadsheetApp.flush();

    // Mark idempotency as COMPLETED
    var resultPayload = JSON.stringify({ steps: stepResults, operationId: operationId });
    idempSheet.getRange(idempRowNum, 4).setValue('COMPLETED');
    idempSheet.getRange(idempRowNum, 5).setValue(resultPayload);
    idempSheet.getRange(idempRowNum, 6).setValue(new Date().toISOString());

    // Update journal
    journalSheet.getRange(journalRowNum, 4).setValue('COMPLETED');
    journalSheet.getRange(journalRowNum, 7).setValue(new Date().toISOString());
    SpreadsheetApp.flush();

    return {
      success: true,
      isReplay: false,
      result: { steps: stepResults, operationId: operationId },
      message: 'Atomic operation completed successfully'
    };

  } catch (stepError) {
    // Mark idempotency as FAILED
    try {
      idempSheet.getRange(idempRowNum, 4).setValue('FAILED');
      idempSheet.getRange(idempRowNum, 5).setValue(stepError.toString());
      idempSheet.getRange(idempRowNum, 6).setValue(new Date().toISOString());

      // Update journal with failure
      journalSheet.getRange(journalRowNum, 4).setValue('FAILED');
      journalSheet.getRange(journalRowNum, 6).setValue(stepError.toString());
      journalSheet.getRange(journalRowNum, 7).setValue(new Date().toISOString());
      SpreadsheetApp.flush();
    } catch (cleanupErr) {
      // Log but don't swallow the original error
      console.error('Failed to record failure status:', cleanupErr);
    }

    throw stepError;
  }
}

// ---- Request Handler ----

function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = false;

  try {
    // Payload size check
    if (!e || !e.postData || !e.postData.contents) {
      return errorResponse('Missing request body', 'MISSING_BODY');
    }
    if (e.postData.contents.length > MAX_PAYLOAD_BYTES) {
      return errorResponse('Payload too large (max ' + MAX_PAYLOAD_BYTES + ' bytes)', 'PAYLOAD_TOO_LARGE');
    }

    // Parse envelope
    var envelope;
    try {
      envelope = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return errorResponse('Invalid JSON in request body', 'INVALID_JSON');
    }

    // Verify HMAC signature (fail closed — reject unsigned/invalid)
    var parsed;
    try {
      parsed = verifyEnvelope(envelope);
    } catch (authErr) {
      return errorResponse(authErr.message, 'AUTH_FAILED');
    }

    // Validate payload
    try {
      validatePayload(parsed);
    } catch (valErr) {
      return errorResponse(valErr.message, 'VALIDATION_FAILED');
    }

    // Acquire lock
    hasLock = lock.tryLock(30000);
    if (!hasLock) {
      return errorResponse('Lock timeout: Could not acquire script lock within 30 seconds', 'LOCK_TIMEOUT');
    }

    // Route action
    var action = parsed.action;

    if (action === 'ping') {
      return jsonResponse({ success: true, message: 'pong', timestamp: new Date().toISOString() });
    }

    if (action === 'append') {
      return jsonResponse(doAppend(parsed));
    }

    if (action === 'update') {
      return jsonResponse(doUpdate(parsed));
    }

    if (action === 'deleteRow') {
      return jsonResponse(doDeleteRow(parsed));
    }

    if (action === 'atomicStockOperation') {
      return jsonResponse(doAtomicStockOperation(parsed));
    }

    return errorResponse('Unknown action: ' + action, 'UNKNOWN_ACTION');

  } catch (error) {
    return errorResponse(error.toString(), 'INTERNAL_ERROR');
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

/**
 * doGet — Read-only health check.
 * Returns minimal information. No secrets, no service details.
 */
function doGet() {
  return jsonResponse({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
}
