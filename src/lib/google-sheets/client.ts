import { google, sheets_v4 } from "googleapis";
import {
  isLegacyAppsScriptMode,
  sendSignedAppsScriptRequest,
} from "./script-signer";

export { sendSignedAppsScriptRequest };

// ============================================================
// Google Sheets Client — Pure Real-time Single Source of Truth
// ============================================================

let sheetsInstance: sheets_v4.Sheets | null = null;

export function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsInstance) return sheetsInstance;

  let privateKey = (process.env.GOOGLE_PRIVATE_KEY ?? "").trim();
  if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  const credentials = {
    client_email: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || "").trim(),
    private_key: privateKey,
  };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsInstance = google.sheets({ version: "v4", auth });
  return sheetsInstance;
}

export const SPREADSHEET_ID = (process.env.GOOGLE_SHEET_ID || "").replace(/^["']|["']$/g, "").trim();

// Sheet tab names
export const SHEETS = {
  WAREHOUSES: "Warehouses",
  LOCATIONS: "Locations",
  SHELVES: "Shelves",
  PRODUCTS: "PRODUCTS",
  DOCUMENTS: "Documents",
  STOCK_MOVEMENTS: "StockMovements",
  STOCK_SUMMARY: "StockSummary",
  STOCK_COUNTS: "StockCounts",
  USERS: "Users",
  LOGIN_LOGS: "ประวัติการเข้าระบบ",
  EXPRESS_ISSUE: "เบิกสินค้าเข้าExpress",
  EXPRESS_RECEIVE: "นำเข้าสินค้าเข้าExpress",
  EXPRESS_TRANSFER: "ย้ายสินค้าเข้าExpress",
  BOM: "BOM",
  BOM_HEADERS: "BOM_Headers",
  BOM_ITEMS: "BOM_Items",
} as const;

// Helper to map warehouse ID to Google Sheets tab name (e.g. wh-5 -> โกดัง5)
export function getWarehouseSheetName(warehouseId: string): string {
  const map: Record<string, string> = {
    "wh-1": "โกดัง1",
    "wh-2": "โกดัง2",
    "wh-3": "โกดัง3",
    "wh-4": "โกดัง4",
    "wh-5": "โกดัง5",
    "wh-6": "สำนักงานใหญ่",
    "wh-01": "โกดัง1",
    "wh-02": "โกดัง2",
    "wh-03": "โกดัง3",
    "wh-04": "โกดัง4",
    "wh-05": "โกดัง5",
    "wh-06": "สำนักงานใหญ่",
  };
  return map[warehouseId] || warehouseId.replace(/\s+/g, "");
}

// Helper to generate all candidate variations for a sheet tab name
export function getPossibleSheetNames(sheetName: string): string[] {
  const names = new Set<string>();
  names.add(sheetName);
  names.add(sheetName.toUpperCase());
  names.add(sheetName.toLowerCase());
  names.add(`${sheetName}Table`);
  names.add(sheetName.replace(/\s+/g, ""));

  // Express sheet variations: เบิกสินค้าเข้าExpress <-> เบิกสินค้าเข้า Express <-> เบิกสินค้า Express
  if (sheetName.includes("เบิกสินค้า") || sheetName.toLowerCase().includes("express")) {
    names.add("เบิกสินค้าเข้าExpress");
    names.add("เบิกสินค้าเข้า Express");
    names.add("เบิกสินค้า เข้า Express");
    names.add("เบิกสินค้า Express");
    names.add("นำเข้าExpress_เบิกสินค้า");
  }
  if (sheetName.includes("รับสินค้า") || sheetName.includes("นำเข้าสินค้า")) {
    names.add("รับสินค้าเข้าExpress");
    names.add("รับสินค้าเข้า Express");
    names.add("รับสินค้า เข้า Express");
    names.add("นำเข้าสินค้าเข้าExpress");
    names.add("นำเข้าสินค้าเข้า Express");
    names.add("นำเข้าสินค้า เข้า Express");
    names.add("นำเข้าExpress_รับสินค้า");
  }
  if (sheetName.includes("ย้ายสินค้า")) {
    names.add("ย้ายสินค้าเข้าExpress");
    names.add("ย้ายสินค้าเข้า Express");
    names.add("ย้ายสินค้า เข้า Express");
  }

  // Thai warehouse tab variations: โกดัง4 <-> โกดัง 4 <-> WH-04 <-> WH4 <-> WH-4
  const whMatch = sheetName.match(/(?:โกดัง|WH|Warehouse)\s*-?\s*0*([0-9]+)/i);
  if (whMatch) {
    const num = whMatch[1];
    const padNum = num.padStart(2, "0");
    names.add(`โกดัง${num}`);
    names.add(`โกดัง ${num}`);
    names.add(`โกดัง${padNum}`);
    names.add(`โกดัง ${padNum}`);
    names.add(`WH-${padNum}`);
    names.add(`WH-${num}`);
    names.add(`WH${padNum}`);
    names.add(`WH${num}`);
    names.add(`Warehouse ${num}`);
    names.add(`Warehouse${num}`);
  }

  return Array.from(names);
}

// Known GIDs for fallback read
const SHEET_GID_MAP: Record<string, string> = {
  PRODUCTS: "389621789",
  Products: "389621789",
  "สินค้า": "389621789",
  "โกดัง1": "1895414134",
  "โกดัง 1": "1895414134",
  "โกดัง2": "1114507677",
  "โกดัง 2": "1114507677",
  "โกดัง3": "549341078",
  "โกดัง 3": "549341078",
  "โกดัง4": "1516974305",
  "โกดัง 4": "1516974305",
  "โกดัง5": "406847030",
  "โกดัง 5": "406847030",
  "สำนักงานใหญ่": "764863205",
  "Warehouses": "490213788",
  "Locations": "1002",
  "LOCATIONS": "1002",
  "Shelves": "845017691",
  "StockMovements": "1883873034",
  "StockSummary": "1226420589",
  "Documents": "178771498",
  Users: "0",
  USERS: "0",
};

// ------ Retry with exponential backoff for 429 ------
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 500
): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") ||
          error.message.includes("Quota exceeded") ||
          error.message.includes("RESOURCE_EXHAUSTED"));
      if (isRateLimit && attempt < retries - 1) {
        const backoff = delayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries reached");
}

// ------ Read public CSV from Google Sheets ------
async function readPublicSheetCsv(sheetName: string): Promise<string[][]> {
  if (!SPREADSHEET_ID) throw new Error("GOOGLE_SHEET_ID is required");

  const isSensitive =
    sheetName.toLowerCase() === "users" ||
    sheetName === SHEETS.USERS ||
    sheetName === SHEETS.LOGIN_LOGS ||
    sheetName === "ประวัติการเข้าระบบ";
  if (isSensitive) {
    return [];
  }

  const urls: string[] = [];
  const knownGid = SHEET_GID_MAP[sheetName];
  if (knownGid) {
    urls.push(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${knownGid}`);
  }
  urls.push(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`);
  urls.push(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`);

  let lastError: unknown = new Error(`ไม่สามารถอ่านชีต ${sheetName}`);
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastError = new Error(`Google Sheets CSV returned HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!text || text.trim().length <= 10 || text.includes("<!DOCTYPE html>")) continue;

      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length <= 1) continue;

      const rows = lines.slice(1).map((line) =>
        line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map((cell) => cell.replace(/^\"|\"$/g, "").trim())
      );
      if (rows.length > 0) {
        const isUsersTab = sheetName.toLowerCase() === "users";
        const hasBcryptHash = rows.some((r) => r[2]?.startsWith("$2b$"));
        if (!isUsersTab && hasBcryptHash) {
          console.warn(`[GoogleSheets Public CSV] ${sheetName} tab not found (redirected to USERS), trying next candidate`);
          continue;
        }
        return rows;
      }
    } catch (e) {
      lastError = e;
      console.warn(`[GoogleSheets Public CSV] Failed fetch via ${url}:`, e);
    }
  }

  throw lastError;
}

interface SheetMemoryCache {
  data: string[][];
  timestamp: number;
}

const sheetCache = new Map<string, SheetMemoryCache>();
const CACHE_TTL_MS = 10 * 1000; // 10s memory cache TTL

export function clearSheetCache(sheetName?: string) {
  if (sheetName) {
    for (const key of sheetCache.keys()) {
      if (key.startsWith(`${sheetName}:`)) {
        sheetCache.delete(key);
      }
    }
  } else {
    sheetCache.clear();
  }
}

function hasServiceAccountCredentials(): boolean {
  return Boolean(
    (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL) &&
      process.env.GOOGLE_PRIVATE_KEY
  );
}

async function assertAppsScriptSuccess(response: Response, operation: string): Promise<void> {
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}: ${responseText}`);
  }

  let payload: {
    success?: boolean;
    status?: string;
    error?: string;
    message?: string;
  };
  try {
    payload = JSON.parse(responseText) as typeof payload;
  } catch {
    throw new Error(`${operation} returned an invalid Apps Script response: ${responseText.slice(0, 200)}`);
  }

  // Accept both response formats for resilience:
  // - Signed envelope response: { success: true }
  // - Legacy response: { status: "success" }
  const isSuccess =
    payload.success === true ||
    payload.status?.toLowerCase() === "success";

  if (!isSuccess) {
    throw new Error(payload.error || payload.message || `${operation} was rejected: ${responseText.slice(0, 200)}`);
  }
}

// ------ Read rows from a sheet ------
export async function readSheet(
  sheetName: string,
  range?: string,
  options?: { forceFresh?: boolean }
): Promise<string[][]> {
  if (!SPREADSHEET_ID) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("GOOGLE_SHEET_ID is required");
    }
    return [];
  }

  const cacheKey = `${sheetName}:${range || "ALL"}`;

  if (!options?.forceFresh) {
    const cached = sheetCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const fetchFreshRows = async (): Promise<string[][]> => {
    const cleanSheet = sheetName.replace(/^'|'$/g, "").trim();
    const safeSheet = cleanSheet.includes(" ") || cleanSheet.includes("-") ? `'${cleanSheet}'` : cleanSheet;
    const fullRange = range ? `${safeSheet}!${range}` : `${safeSheet}!A1:Z5000`;

    if (process.env.GOOGLE_API_KEY) {
      try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(fullRange)}?key=${process.env.GOOGLE_API_KEY}`;
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          let googleRows = (json.values as string[][]) ?? [];
          if (googleRows.length > 0) {
            const firstCell = (googleRows[0][0] ?? "").toLowerCase().trim();
            const secondCell = (googleRows[0][1] ?? "").toLowerCase().trim();
            if (
              firstCell.includes("_id") ||
              firstCell.includes("sku") ||
              firstCell.includes("รหัส") ||
              firstCell.includes("ลำดับ") ||
              firstCell.includes("header") ||
              firstCell.includes("bom") ||
              firstCell.includes("id") ||
              secondCell.includes("sku") ||
              secondCell.includes("รหัส") ||
              secondCell.includes("barcode")
            ) {
              googleRows = googleRows.slice(1);
            }
          }
          return googleRows;
        } else {
          console.warn(`[GoogleSheets API Key] HTTP ${res.status} for ${url}:`, await res.text());
        }
      } catch (e) {
        console.warn(`[GoogleSheets API Key] ${sheetName} read failed:`, e);
      }
    }

    if (hasServiceAccountCredentials()) {
      const candidates = getPossibleSheetNames(sheetName);
      for (const cand of candidates) {
        try {
          const sheets = getSheetsClient();
          const safeCand = cand.startsWith("'") ? cand : `'${cand.replace(/'/g, "")}'`;
          const candRange = range ? `${safeCand}!${range}` : `${safeCand}`;
          const response = await withRetry(() =>
            sheets.spreadsheets.values.get({
              spreadsheetId: SPREADSHEET_ID,
              range: candRange,
            })
          );
          let googleRows = (response.data.values as string[][]) ?? [];
          if (googleRows.length > 0 && (googleRows[0][0]?.includes("_id") || googleRows[0][0]?.toLowerCase().includes("sku") || googleRows[0][0]?.includes("รหัสสินค้า"))) {
            googleRows = googleRows.slice(1);
          }
          return googleRows;
        } catch (err) {
          // Try next candidate
        }
      }
    }

    return readPublicSheetCsv(sheetName);
  };

  try {
    const freshRows = await fetchFreshRows();
    sheetCache.set(cacheKey, { data: freshRows, timestamp: Date.now() });
    return freshRows;
  } catch (error) {
    const cached = sheetCache.get(cacheKey);
    if (cached) {
      console.warn(`[GoogleSheets readSheet] Using fallback memory cached rows for ${sheetName} (${cached.data.length} rows)`);
      return cached.data;
    }
    console.warn(`[GoogleSheets readSheet] Could not fetch ${sheetName}, returning empty fallback:`, error);
    return [];
  }
}

// ------ Append rows to a sheet ------
export async function appendRows(
  sheetName: string,
  values: (string | number | boolean)[][]
): Promise<void> {
  clearSheetCache(sheetName);

  if (hasServiceAccountCredentials()) {
    const sheets = getSheetsClient();
    const possibleSheetNames = getPossibleSheetNames(sheetName);

    let lastAppendErr: unknown = null;
    for (const nameCandidate of possibleSheetNames) {
      try {
        const safeName = nameCandidate.startsWith("'") ? nameCandidate : `'${nameCandidate.replace(/'/g, "")}'`;
        await withRetry(() =>
          sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${safeName}!A1`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values },
          })
        );
        return;
      } catch (candidateErr) {
        lastAppendErr = candidateErr;
      }
    }

    console.error(`[GoogleSheets appendRows Service Account Failed for ${sheetName}]:`, lastAppendErr);
    if (!process.env.GOOGLE_SCRIPT_URL) {
      const errMsg = lastAppendErr instanceof Error ? lastAppendErr.message : String(lastAppendErr);
      throw new Error(`ไม่สามารถเพิ่มข้อมูลในชีต ${sheetName}: ${errMsg}`);
    }
  }

  if (process.env.GOOGLE_SCRIPT_URL) {
    try {
      const response = await sendSignedAppsScriptRequest({ action: "append", sheetName, values });
      await assertAppsScriptSuccess(response, `Append ${sheetName}`);
      return;
    } catch (error) {
      console.error(`[GoogleSheets appendRows Apps Script Error]:`, error);
      throw new Error(`ไม่สามารถเพิ่มข้อมูลในชีต ${sheetName}`, { cause: error });
    }
  }

  throw new Error(`ไม่สามารถเพิ่มข้อมูลในชีต ${sheetName} (กรุณาตรวจสอบชื่อชีตหรือสิทธิ์การเขียน)`);
}

// ------ Update a specific row (by row number, 1-indexed) ------
export async function updateRow(
  sheetName: string,
  rowNumber: number,
  values: (string | number | boolean)[]
): Promise<void> {
  clearSheetCache(sheetName);

  if (hasServiceAccountCredentials()) {
    const sheets = getSheetsClient();
    const colEnd = columnLetter(values.length);
    const possibleSheetNames = getPossibleSheetNames(sheetName);

    let lastUpdateErr: unknown = null;
    for (const nameCandidate of possibleSheetNames) {
      try {
        const safeName = nameCandidate.startsWith("'") ? nameCandidate : `'${nameCandidate.replace(/'/g, "")}'`;
        await withRetry(() =>
          sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${safeName}!A${rowNumber}:${colEnd}${rowNumber}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [values] },
          })
        );
        return;
      } catch (candidateErr) {
        lastUpdateErr = candidateErr;
      }
    }

    console.error(`[GoogleSheets updateRow Service Account Failed for ${sheetName} row ${rowNumber}]:`, lastUpdateErr);
    if (!process.env.GOOGLE_SCRIPT_URL) {
      const errMsg = lastUpdateErr instanceof Error ? lastUpdateErr.message : String(lastUpdateErr);
      throw new Error(`ไม่สามารถอัปเดตชีต ${sheetName} แถว ${rowNumber}: ${errMsg}`);
    }
  }

  if (process.env.GOOGLE_SCRIPT_URL) {
    try {
      const response = await sendSignedAppsScriptRequest({ action: "update", sheetName, rowNumber, values });
      await assertAppsScriptSuccess(response, `Update ${sheetName} row ${rowNumber}`);
      return;
    } catch (error) {
      console.error(`[GoogleSheets updateRow Apps Script Error]:`, error);
      throw new Error(`ไม่สามารถอัปเดตชีต ${sheetName} แถว ${rowNumber}`, { cause: error });
    }
  }

  throw new Error(`ไม่สามารถอัปเดตชีต ${sheetName} แถว ${rowNumber} (กรุณาตรวจสอบสิทธิ์การเขียน)`);
}

// ------ Batch update multiple rows ------
export async function batchUpdateRows(
  sheetName: string,
  updates: { rowNumber: number; values: (string | number | boolean)[] }[]
): Promise<void> {
  if (updates.length === 0) return;
  clearSheetCache(sheetName);

  if (updates.length === 1) {
    await updateRow(sheetName, updates[0].rowNumber, updates[0].values);
    return;
  }

  if (hasServiceAccountCredentials()) {
    const sheets = getSheetsClient();
    const possibleSheetNames = getPossibleSheetNames(sheetName);

    let lastBatchErr: unknown = null;
    for (const nameCandidate of possibleSheetNames) {
      try {
        const safeName = nameCandidate.startsWith("'") ? nameCandidate : `'${nameCandidate.replace(/'/g, "")}'`;
        const data = updates.map(({ rowNumber, values }) => ({
          range: `${safeName}!A${rowNumber}:${columnLetter(values.length)}${rowNumber}`,
          values: [values],
        }));

        await withRetry(() =>
          sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
              valueInputOption: "USER_ENTERED",
              data,
            },
          })
        );
        return;
      } catch (candidateErr) {
        lastBatchErr = candidateErr;
      }
    }
    console.warn(`[batchUpdateRows Service Account Failed for ${sheetName}]:`, lastBatchErr);
  }

  // Fallback if Apps Script or Service Account batch fails
  for (const { rowNumber, values } of updates) {
    await updateRow(sheetName, rowNumber, values);
  }
}

// ------ Batch append multiple rows ------
export async function batchAppendRows(
  sheetName: string,
  rows: (string | number | boolean)[][]
): Promise<void> {
  if (rows.length === 0) return;
  await appendRows(sheetName, rows);
}

// ------ Get numeric sheet ID by tab name ------
export async function getSheetId(sheetName: string): Promise<number | null> {
  if (!SPREADSHEET_ID) return null;
  try {
    const sheets = getSheetsClient();
    const meta = await withRetry(() =>
      sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
    );
    const sheet = meta.data.sheets?.find(
      (s) => s.properties?.title === sheetName
    );
    return sheet?.properties?.sheetId ?? null;
  } catch (e) {
    console.warn(`[GoogleSheets] getSheetId failed for ${sheetName}:`, e);
    return null;
  }
}

// ------ Delete specific rows by 0-indexed row numbers ------
export async function deleteRows(
  sheetName: string,
  rowIndices: number[]
): Promise<void> {
  if (rowIndices.length === 0) return;
  clearSheetCache(sheetName);

  const sorted = [...new Set(rowIndices)].sort((a, b) => b - a);

  if (hasServiceAccountCredentials()) {
    try {
      const sheetId = await getSheetId(sheetName);
      if (sheetId === null) throw new Error(`ไม่พบชีต ${sheetName}`);
      const requests = sorted.map((rowIndex) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowIndex,
            endIndex: rowIndex + 1,
          },
        },
      }));

      const sheets = getSheetsClient();
      await withRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: { requests },
        })
      );
      return;
    } catch (err) {
      console.warn(`[GoogleSheets deleteRows Service Account Error]:`, err);
    }
  }

  if (process.env.GOOGLE_SCRIPT_URL) {
    try {
      for (const idx of sorted) {
        const rowNumber = idx + 1;
        try {
          const response = await sendSignedAppsScriptRequest({ action: "deleteRow", sheetName, rowNumber });
          await assertAppsScriptSuccess(response, `Delete ${sheetName} row ${rowNumber}`);
        } catch (scriptErr) {
          console.warn(`[deleteRows] Apps Script deleteRow failed/unsupported for ${sheetName} row ${rowNumber}, blanking row via update:`, scriptErr);
          await updateRow(sheetName, rowNumber, ["", "", "", "", "", "", "", "", ""]);
        }
      }
      return;
    } catch (error) {
      throw new Error(`ไม่สามารถลบแถวในชีต ${sheetName}`, { cause: error });
    }
  }

  throw new Error("ไม่ได้ตั้งค่าช่องทางเขียน Google Sheets");
}

function columnLetter(colIndex: number): string {
  let letter = "";
  while (colIndex > 0) {
    const rem = (colIndex - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    colIndex = Math.floor((colIndex - 1) / 26);
  }
  return letter;
}

export function parseBoolean(val: string | undefined): boolean {
  return val === "TRUE" || val === "true" || val === "1";
}

export function formatBoolean(val: boolean): string {
  return val ? "TRUE" : "FALSE";
}
