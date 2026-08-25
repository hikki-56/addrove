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
 * - SIGNING_SECRET is stored in Script Properties (never hard-coded).
 * - Requests with missing, invalid, expired, or replayed signatures are rejected.
 * - doGet is read-only and returns no sensitive information.
 */

// ---- Configuration ----

var ALLOWED_ACTIONS = ['ping', 'append', 'update', 'deleteRow', 'atomicStockOperation'];
var ALLOWED_ATOMIC_ACTIONS = ['append', 'update', 'updateStatus', 'checkBalance'];
var ALLOWED_SHEETS = [
  'Warehouses', 'Locations', 'Shelves', 'PRODUCTS', 'Documents',
  'StockMovements', 'StockSummary', 'StockCounts', 'Users',
  '\u0e1b\u0e23\u0e30\u0e27\u0e31\u0e15\u0e34\u0e01\u0e32\u0e23\u0e40\u0e02\u0e49\u0e32\u0e23\u0e30\u0e1a\u0e1a', 'Idempotency', 'AuditLogs', 'OperationJournal',
  '\u0e42\u0e01\u0e14\u0e31\u0e071', '\u0e42\u0e01\u0e14\u0e31\u0e072', '\u0e42\u0e01\u0e14\u0e31\u0e073', '\u0e42\u0e01\u0e14\u0e31\u0e074', '\u0e42\u0e01\u0e14\u0e31\u0e075', '\u0e2a\u0e33\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e43\u0e2b\u0e0d\u0e48',
  '\u0e42\u0e01\u0e14\u0e31\u0e07 1', '\u0e42\u0e01\u0e14\u0e31\u0e07 2', '\u0e42\u0e01\u0e14\u0e31\u0e07 3', '\u0e42\u0e01\u0e14\u0e31\u0e07 4', '\u0e42\u0e01\u0e14\u0e31\u0e07 5', '\u0e42\u0e01\u0e14\u0e31\u0e076', '\u0e42\u0e01\u0e14\u0e31\u0e07 6',
  '\u0e42\u0e01\u0e14\u0e31\u0e0701', '\u0e42\u0e01\u0e14\u0e31\u0e0702', '\u0e42\u0e01\u0e14\u0e31\u0e0703', '\u0e42\u0e01\u0e14\u0e31\u0e0704', '\u0e42\u0e01\u0e14\u0e31\u0e0705', '\u0e42\u0e01\u0e14\u0e31\u0e0706',
  'WH-01', 'WH-02', 'WH-03', 'WH-04', 'WH-05', 'WH-06', 'WH-1', 'WH-2', 'WH-3', 'WH-4', 'WH-5', 'WH-6',
  'WH01', 'WH02', 'WH03', 'WH04', 'WH05', 'WH06', 'WH1', 'WH2', 'WH3', 'WH4', 'WH5', 'WH6'
];

var MAX_PAYLOAD_BYTES = 500000; // 500 KB
var MAX_ENVELOPE_BYTES = MAX_PAYLOAD_BYTES + 1000;
var MAX_ROWS_PER_APPEND = 100;
var MAX_COLS_PER_ROW = 30;
var MAX_CELL_BYTES = 50000;
var MAX_ROW_NUMBER = 1000000;
var MAX_ATOMIC_STEPS = 100;
var TIMESTAMP_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
var TIMESTAMP_MAX_FUTURE_SKEW_MS = 30000;
var NONCE_PROPERTY_PREFIX = 'STOCKIFY_NONCE_';
var SIGNING_SECRET_PROPERTY = 'SIGNING_SECRET';

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
  var secret = PropertiesService.getScriptProperties().getProperty(SIGNING_SECRET_PROPERTY);
  if (!secret || getUtf8ByteLength(secret) < 32) {
    throw new Error(SIGNING_SECRET_PROPERTY + ' must be configured with at least 32 bytes');
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

function getUtf8ByteLength(value) {
  return Utilities.newBlob(String(value), 'text/plain').getBytes().length;
}

function sha256Hex(value) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function assertValidRowNumber(value, operation) {
  var rowNumber = Number(value);
  if (!isFinite(rowNumber) || Math.floor(rowNumber) !== rowNumber ||
      rowNumber < 2 || rowNumber > MAX_ROW_NUMBER) {
    throw new Error(
      'VALIDATION: ' + operation + ' rowNumber must be an integer between 2 and ' + MAX_ROW_NUMBER
    );
  }
  return rowNumber;
}

function assertAllowedSheet(sheetName) {
  if (typeof sheetName !== 'string' || ALLOWED_SHEETS.indexOf(sheetName) === -1) {
    throw new Error('SHEET_DENIED: Unknown sheet "' + sheetName + '"');
  }
}

function assertCellValue(value) {
  var valueType = typeof value;
  if (value !== null && valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') {
    throw new Error('VALIDATION: cell values must be string, number, boolean, or null');
  }
  if (valueType === 'number' && !isFinite(value)) {
    throw new Error('VALIDATION: numeric cell values must be finite');
  }
  if (valueType === 'string' && getUtf8ByteLength(value) > MAX_CELL_BYTES) {
    throw new Error('VALIDATION: cell value exceeds maximum size');
  }
}

function assertRowValues(values, operation) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_COLS_PER_ROW) {
    throw new Error(
      'VALIDATION: ' + operation + ' values must contain 1-' + MAX_COLS_PER_ROW + ' columns'
    );
  }
  for (var i = 0; i < values.length; i++) {
    assertCellValue(values[i]);
  }
}

function assertAppendValues(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_ROWS_PER_APPEND) {
    throw new Error(
      'VALIDATION: append values must contain 1-' + MAX_ROWS_PER_APPEND + ' rows'
    );
  }

  var expectedColumns = null;
  for (var i = 0; i < values.length; i++) {
    assertRowValues(values[i], 'append');
    if (expectedColumns === null) expectedColumns = values[i].length;
    if (values[i].length !== expectedColumns) {
      throw new Error('VALIDATION: append rows must all have the same number of columns');
    }
  }
}

/**
 * Must be called while holding the script lock. Script Properties are used
 * instead of CacheService so replay protection is not lost to cache eviction.
 */
function registerNonce(nonce, timestamp, now) {
  var properties = PropertiesService.getScriptProperties();
  var nonceKey = NONCE_PROPERTY_PREFIX + sha256Hex(nonce);
  var existing = properties.getProperty(nonceKey);
  if (existing !== null) {
    throw new Error('HMAC_REPLAY: Nonce already used');
  }

  var allProperties = properties.getProperties();
  var staleKeys = [];
  Object.keys(allProperties).forEach(function(key) {
    if (key.indexOf(NONCE_PROPERTY_PREFIX) !== 0) return;
    var storedAt = Number(allProperties[key]);
    if (!isFinite(storedAt) || now - storedAt > TIMESTAMP_MAX_AGE_MS + TIMESTAMP_MAX_FUTURE_SKEW_MS) {
      staleKeys.push(key);
    }
  });
  for (var i = 0; i < staleKeys.length; i++) {
    properties.deleteProperty(staleKeys[i]);
  }

  properties.setProperty(nonceKey, String(timestamp));
}

/**
 * Verify the signed envelope. Returns the parsed payload object.
 * Throws on any verification failure.
 */
function verifyEnvelope(envelope) {
  // 1. Required fields
  if (!envelope || typeof envelope.timestamp !== 'number' ||
      typeof envelope.nonce !== 'string' || typeof envelope.payload !== 'string' ||
      typeof envelope.signature !== 'string') {
    throw new Error('HMAC_MISSING: Missing required envelope fields');
  }

  if (!isFinite(envelope.timestamp) || Math.floor(envelope.timestamp) !== envelope.timestamp ||
      envelope.timestamp <= 0) {
    throw new Error('HMAC_INVALID: Invalid timestamp');
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(envelope.nonce)) {
    throw new Error('HMAC_INVALID: Invalid nonce');
  }
  if (!envelope.payload || getUtf8ByteLength(envelope.payload) > MAX_PAYLOAD_BYTES) {
    throw new Error('HMAC_INVALID: Invalid payload size');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(envelope.signature)) {
    throw new Error('HMAC_INVALID: Invalid signature format');
  }

  // 2. Timestamp freshness
  var now = Date.now();
  var age = now - envelope.timestamp;
  if (age > TIMESTAMP_MAX_AGE_MS || age < -TIMESTAMP_MAX_FUTURE_SKEW_MS) {
    throw new Error('HMAC_EXPIRED: Timestamp outside acceptable window');
  }

  // 3. Verify signature
  var secret = getSigningSecret();
  var message = envelope.timestamp + '.' + envelope.nonce + '.' + envelope.payload;
  var expected = computeHmac(secret, message);

  if (!timingSafeCompare(envelope.signature, expected)) {
    throw new Error('HMAC_INVALID: Signature mismatch');
  }

  // 4. Parse and return payload. The caller registers the nonce after it
  // acquires the script-wide lock so concurrent replays cannot race.
  try {
    return JSON.parse(envelope.payload);
  } catch (parseError) {
    throw new Error('VALIDATION: Signed payload is not valid JSON');
  }
}

// ---- Payload Validation ----

function validatePayload(parsed) {
  if (!parsed || Object.prototype.toString.call(parsed) !== '[object Object]') {
    throw new Error('VALIDATION: payload must be a JSON object');
  }

  var action = parsed.action;

  // Action allowlist
  if (typeof action !== 'string' || ALLOWED_ACTIONS.indexOf(action) === -1) {
    throw new Error('ACTION_DENIED: Unknown action "' + action + '"');
  }

  // Sheet allowlist (except ping)
  if (action !== 'ping' && action !== 'atomicStockOperation') {
    if (!parsed.sheetName) {
      throw new Error('VALIDATION: Missing sheetName');
    }
    assertAllowedSheet(parsed.sheetName);
  }

  // Per-action validation
  if (action === 'append') {
    assertAppendValues(parsed.values);
  }

  if (action === 'update') {
    assertValidRowNumber(parsed.rowNumber, 'update');
    assertRowValues(parsed.values, 'update');
  }

  if (action === 'deleteRow') {
    assertValidRowNumber(parsed.rowNumber, 'deleteRow');
  }

  if (action === 'atomicStockOperation') {
    if (typeof parsed.idempotencyKey !== 'string' || !parsed.idempotencyKey ||
        parsed.idempotencyKey.length > 200 || typeof parsed.operationType !== 'string' ||
        !parsed.operationType || parsed.operationType.length > 100) {
      throw new Error('VALIDATION: atomicStockOperation requires idempotencyKey and operationType');
    }
    if (parsed.actorId !== undefined &&
        (typeof parsed.actorId !== 'string' || !parsed.actorId || parsed.actorId.length > 200)) {
      throw new Error('VALIDATION: atomicStockOperation actorId is invalid');
    }
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0 ||
        parsed.steps.length > MAX_ATOMIC_STEPS) {
      throw new Error(
        'VALIDATION: atomicStockOperation requires 1-' + MAX_ATOMIC_STEPS + ' steps'
      );
    }

    for (var j = 0; j < parsed.steps.length; j++) {
      var step = parsed.steps[j];
      if (!step || typeof step !== 'object' ||
          ALLOWED_ATOMIC_ACTIONS.indexOf(step.action) === -1) {
        throw new Error('ACTION_DENIED: Unknown atomic action in step ' + j);
      }

      if (step.action === 'append') {
        assertAllowedSheet(step.sheetName);
        assertAppendValues(step.values);
      } else if (step.action === 'update') {
        assertAllowedSheet(step.sheetName);
        assertValidRowNumber(step.rowNumber, 'atomic update');
        assertRowValues(step.values, 'atomic update');
      } else if (step.action === 'updateStatus') {
        if (step.sheetName !== 'Documents') {
          throw new Error('SHEET_DENIED: updateStatus may only target Documents');
        }
        if (typeof step.documentId !== 'string' || !step.documentId || step.documentId.length > 200) {
          throw new Error('VALIDATION: updateStatus requires a valid documentId');
        }
        if (typeof step.newStatus !== 'string' ||
            ['DRAFT', 'PENDING', 'PROCESSING', 'POSTED', 'COMPLETED', 'REJECTED', 'CANCELLED'].indexOf(step.newStatus) === -1) {
          throw new Error('VALIDATION: updateStatus contains an invalid status');
        }
        if (step.statusColumnIndex !== undefined && step.statusColumnIndex !== 5) {
          throw new Error('VALIDATION: Documents status column index must be 5');
        }
      } else if (step.action === 'checkBalance') {
        if (step.sheetName !== 'StockMovements') {
          throw new Error('SHEET_DENIED: checkBalance may only target StockMovements');
        }
        if (typeof step.productId !== 'string' || !step.productId ||
            typeof step.warehouseId !== 'string' || !step.warehouseId ||
            typeof step.locationId !== 'string' || !step.locationId ||
            typeof step.minRequired !== 'number' || !isFinite(step.minRequired) ||
            step.minRequired < 0) {
          throw new Error('VALIDATION: checkBalance step is invalid');
        }
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
  if (lastRow + numRows > MAX_ROW_NUMBER || lastRow + numRows > sheet.getMaxRows()) {
    throw new Error('VALIDATION: append exceeds sheet row bounds');
  }
  if (numCols > sheet.getMaxColumns()) {
    throw new Error('VALIDATION: append exceeds sheet column bounds');
  }
  sheet.getRange(lastRow + 1, 1, numRows, numCols).setValues(values);
  SpreadsheetApp.flush();
  return { success: true, message: 'Appended rows successfully', rowCount: numRows };
}

function doUpdate(parsed) {
  var sheet = getSheet(parsed.sheetName);
  var rowNumber = assertValidRowNumber(parsed.rowNumber, 'update');
  var rowValues = parsed.values;

  if (rowNumber > sheet.getLastRow()) {
    throw new Error('VALIDATION: rowNumber exceeds last row');
  }
  if (rowValues.length > sheet.getMaxColumns()) {
    throw new Error('VALIDATION: update exceeds sheet column bounds');
  }

  sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]);
  SpreadsheetApp.flush();
  return { success: true, message: 'Updated row successfully', rowNumber: rowNumber };
}

function doDeleteRow(parsed) {
  var sheet = getSheet(parsed.sheetName);
  var rowNumber = assertValidRowNumber(parsed.rowNumber, 'deleteRow');

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
  var idempSheet = getSheet('Idempotency');
  var journalSheet = getSheet('OperationJournal');
  var actorId = parsed.actorId || 'system';
  var payloadHash = sha256Hex(JSON.stringify({
    operationType: parsed.operationType,
    actorId: actorId,
    steps: parsed.steps
  }));

  // Idempotency uses the repository schema:
  // key, operation_type, actor_id, payload_hash, status, response_payload,
  // error_message, created_at, updated_at.
  var idempData = idempSheet.getDataRange().getValues();
  for (var i = 1; i < idempData.length; i++) {
    if (idempData[i][0] !== parsed.idempotencyKey) continue;
    if (idempData[i][3] && idempData[i][3] !== payloadHash) {
      throw new Error('IDEMPOTENCY_CONFLICT: Key was already used with a different payload');
    }
    if (idempData[i][4] === 'COMPLETED') {
      var cachedResult = {};
      try {
        cachedResult = JSON.parse(idempData[i][5] || '{}');
      } catch (parseError) {
        throw new Error('IDEMPOTENCY_CORRUPT: Cached response is invalid JSON');
      }
      return {
        success: true,
        isReplay: true,
        result: cachedResult,
        message: 'Idempotent replay - already completed'
      };
    }
    if (idempData[i][4] === 'PROCESSING') {
      throw new Error('IDEMPOTENCY_IN_PROGRESS: Operation is currently being processed');
    }
    throw new Error('IDEMPOTENCY_FAILED: Previous attempt requires manual recovery');
  }

  var createdAt = new Date().toISOString();
  idempSheet.appendRow([
    parsed.idempotencyKey,
    parsed.operationType,
    actorId,
    payloadHash,
    'PROCESSING',
    '',
    '',
    createdAt,
    createdAt
  ]);
  var idempRowNum = idempSheet.getLastRow();

  // OperationJournal uses the repository's 12-column schema.
  var operationId = 'op-' + Utilities.getUuid();
  var journalSteps = parsed.steps.map(function(step, index) {
    return {
      step_name: step.action + '_' + index,
      status: 'PENDING'
    };
  });
  var completedStepNames = [];
  journalSheet.appendRow([
    operationId,
    parsed.idempotencyKey,
    parsed.operationType,
    payloadHash,
    actorId,
    JSON.stringify(journalSteps),
    JSON.stringify(completedStepNames),
    'IN_PROGRESS',
    0,
    '',
    createdAt,
    createdAt
  ]);
  var journalRowNum = journalSheet.getLastRow();
  SpreadsheetApp.flush();

  var stepResults = [];
  var completedStepCount = 0;

  try {
    for (var s = 0; s < parsed.steps.length; s++) {
      var step = parsed.steps[s];

      if (step.action === 'append') {
        var appendSheet = getSheet(step.sheetName);
        var vals = step.values;
        var lastRow = appendSheet.getLastRow();
        if (lastRow + vals.length > MAX_ROW_NUMBER ||
            lastRow + vals.length > appendSheet.getMaxRows()) {
          throw new Error('VALIDATION: atomic append exceeds sheet row bounds');
        }
        if (vals[0].length > appendSheet.getMaxColumns()) {
          throw new Error('VALIDATION: atomic append exceeds sheet column bounds');
        }
        appendSheet.getRange(lastRow + 1, 1, vals.length, vals[0].length).setValues(vals);
        stepResults.push({
          step: s,
          action: 'append',
          sheetName: step.sheetName,
          rowCount: vals.length
        });
      } else if (step.action === 'update') {
        var updateSheet = getSheet(step.sheetName);
        var rowNumber = assertValidRowNumber(step.rowNumber, 'atomic update');
        if (rowNumber > updateSheet.getLastRow()) {
          throw new Error('VALIDATION: atomic update rowNumber exceeds last row');
        }
        if (step.values.length > updateSheet.getMaxColumns()) {
          throw new Error('VALIDATION: atomic update exceeds sheet column bounds');
        }
        updateSheet.getRange(rowNumber, 1, 1, step.values.length).setValues([step.values]);
        stepResults.push({
          step: s,
          action: 'update',
          sheetName: step.sheetName,
          rowNumber: rowNumber
        });
      } else if (step.action === 'updateStatus') {
        var statusSheet = getSheet('Documents');
        var statusData = statusSheet.getDataRange().getValues();
        var found = false;
        var statusColumnIndex = step.statusColumnIndex === undefined ? 5 : step.statusColumnIndex;
        for (var r = 1; r < statusData.length; r++) {
          if (statusData[r][0] === step.documentId) {
            statusSheet.getRange(r + 1, statusColumnIndex + 1).setValue(step.newStatus);
            found = true;
            stepResults.push({ step: s, action: 'updateStatus', rowNumber: r + 1 });
            break;
          }
        }
        if (!found) {
          throw new Error('DOCUMENT_NOT_FOUND: ' + step.documentId);
        }
      } else if (step.action === 'checkBalance') {
        var movementSheet = getSheet('StockMovements');
        var movementData = movementSheet.getDataRange().getValues();
        var balance = 0;
        for (var m = 1; m < movementData.length; m++) {
          if (movementData[m][2] === step.productId &&
              movementData[m][3] === step.warehouseId &&
              movementData[m][4] === step.locationId) {
            var quantity = Number(movementData[m][5]);
            if (!isFinite(quantity)) {
              throw new Error('DATA_CORRUPT: StockMovements contains a non-numeric quantity');
            }
            balance += quantity;
          }
        }
        if (balance < step.minRequired) {
          throw new Error('INSUFFICIENT_STOCK: Balance=' + balance + ' Required=' + step.minRequired);
        }
        stepResults.push({ step: s, action: 'checkBalance', balance: balance });
      } else {
        throw new Error('ACTION_DENIED: Unknown atomic action');
      }

      completedStepCount = s + 1;
      var completedAt = new Date().toISOString();
      journalSteps[s].status = 'COMPLETED';
      journalSteps[s].executed_at = completedAt;
      completedStepNames.push(journalSteps[s].step_name);
      journalSheet.getRange(journalRowNum, 6).setValue(JSON.stringify(journalSteps));
      journalSheet.getRange(journalRowNum, 7).setValue(JSON.stringify(completedStepNames));
      journalSheet.getRange(journalRowNum, 12).setValue(completedAt);
      SpreadsheetApp.flush();
    }

    var result = { steps: stepResults, operationId: operationId };
    var resultPayload = JSON.stringify(result);
    var completedAt = new Date().toISOString();
    idempSheet.getRange(idempRowNum, 5).setValue('COMPLETED');
    idempSheet.getRange(idempRowNum, 6).setValue(resultPayload);
    idempSheet.getRange(idempRowNum, 7).setValue('');
    idempSheet.getRange(idempRowNum, 9).setValue(completedAt);
    journalSheet.getRange(journalRowNum, 8).setValue('COMPLETED');
    journalSheet.getRange(journalRowNum, 12).setValue(completedAt);
    SpreadsheetApp.flush();

    return {
      success: true,
      isReplay: false,
      result: result,
      message: 'Atomic operation completed successfully'
    };
  } catch (stepError) {
    try {
      var failedAt = new Date().toISOString();
      var errorMessage = stepError && stepError.message ? stepError.message : String(stepError);
      if (completedStepCount < journalSteps.length) {
        journalSteps[completedStepCount].status = 'FAILED';
        journalSteps[completedStepCount].error = errorMessage;
        journalSteps[completedStepCount].executed_at = failedAt;
      }
      idempSheet.getRange(idempRowNum, 5).setValue('FAILED');
      idempSheet.getRange(idempRowNum, 7).setValue(errorMessage);
      idempSheet.getRange(idempRowNum, 9).setValue(failedAt);
      journalSheet.getRange(journalRowNum, 6).setValue(JSON.stringify(journalSteps));
      journalSheet.getRange(journalRowNum, 7).setValue(JSON.stringify(completedStepNames));
      journalSheet.getRange(journalRowNum, 8).setValue('RECOVERABLE');
      journalSheet.getRange(journalRowNum, 10).setValue(errorMessage);
      journalSheet.getRange(journalRowNum, 12).setValue(failedAt);
      SpreadsheetApp.flush();
    } catch (cleanupError) {
      console.error('Failed to record failure status:', cleanupError);
    }
    throw stepError;
  }
}

// ---- Python / Custom Direct Import Handler ----

/**
 * Handle direct data insertion from Python or external scripts
 * without requiring HMAC signature envelope, while still protecting
 * with LockService.
 */
function handleDirectPythonImport(body, lock) {
  var hasLock = lock.tryLock(30000);
  if (!hasLock) {
    return errorResponse('Lock timeout: Could not acquire script lock within 30 seconds', 'LOCK_TIMEOUT');
  }

  try {
    var sheetName = body.sheetName || 'test003';
    var rows = body.rows || body.data || [];
    var clearSheet = !!body.clearSheet;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);

    // If sheet tab does not exist, create it
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    // If clearSheet is requested, clear sheet
    if (clearSheet) {
      sheet.clear();
    }

    // Insert rows
    if (rows && rows.length > 0) {
      var numRows = rows.length;
      var numCols = rows[0].length;
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, numRows, numCols).setValues(rows);
      SpreadsheetApp.flush();
    }

    return jsonResponse({
      status: 'success',
      success: true,
      sheet: sheetName,
      count: rows.length,
      lastRow: sheet.getLastRow()
    });
  } catch (err) {
    return jsonResponse({
      status: 'error',
      success: false,
      message: err.toString(),
      error: err.toString()
    });
  } finally {
    lock.releaseLock();
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
    if (getUtf8ByteLength(e.postData.contents) > MAX_ENVELOPE_BYTES) {
      return errorResponse('Request envelope is too large', 'PAYLOAD_TOO_LARGE');
    }

    // Parse request body
    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return errorResponse('Invalid JSON in request body', 'INVALID_JSON');
    }

    // ------------------------------------------------------------------
    // Mode 1: Python / Direct Batch Import (No HMAC Envelope)
    // Runs when receiving raw { sheetName, rows, data, ... }
    // ------------------------------------------------------------------
    if (body && !body.signature && (body.rows !== undefined || body.data !== undefined || body.sheetName !== undefined)) {
      return handleDirectPythonImport(body, lock);
    }

    // ------------------------------------------------------------------
    // Mode 2: Stockify App Core Operations (HMAC-SHA256 Signed Envelope)
    // ------------------------------------------------------------------
    var envelope = body;

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

    // Acquire the script-wide lock before registering the nonce. This makes
    // replay detection and every subsequent mutation one serialized unit.
    hasLock = lock.tryLock(30000);
    if (!hasLock) {
      return errorResponse('Lock timeout: Could not acquire script lock within 30 seconds', 'LOCK_TIMEOUT');
    }

    try {
      var lockedNow = Date.now();
      var lockedAge = lockedNow - envelope.timestamp;
      if (lockedAge > TIMESTAMP_MAX_AGE_MS || lockedAge < -TIMESTAMP_MAX_FUTURE_SKEW_MS) {
        throw new Error('HMAC_EXPIRED: Timestamp outside acceptable window');
      }
      registerNonce(envelope.nonce, envelope.timestamp, lockedNow);
    } catch (replayErr) {
      return errorResponse(replayErr.message, 'AUTH_FAILED');
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
