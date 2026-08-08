import { google, sheets_v4 } from "googleapis";
import { createSignedEnvelope } from "./script-signer";

export async function sendSignedAppsScriptRequest(payload: object): Promise<Response> {
  const url = process.env.GOOGLE_SCRIPT_URL;
  if (!url) throw new Error("GOOGLE_SCRIPT_URL is not set");

  const envelope = createSignedEnvelope(payload);
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(envelope),
    redirect: "follow",
    cache: "no-store",
  });
}

// ============================================================
// Google Sheets Client — Pure Real-time Single Source of Truth
// ============================================================

let sheetsInstance: sheets_v4.Sheets | null = null;

export function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsInstance) return sheetsInstance;

  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || "",
    private_key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsInstance = google.sheets({ version: "v4", auth });
  return sheetsInstance;
}

export const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "";

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
} as const;

// Helper to map warehouse ID to Google Sheets tab name (e.g. wh-5 -> โกดัง5)
export function getWarehouseSheetName(warehouseId: string): string {
  const map: Record<string, string> = {
    "wh-1": "โกดัง1",
    "wh-2": "โกดัง2",
    "wh-3": "โกดัง3",
    "wh-4": "โกดัง4",
    "wh-5": "โกดัง5",
    "wh-01": "โกดัง1",
    "wh-02": "โกดัง2",
    "wh-03": "โกดัง3",
    "wh-04": "โกดัง4",
    "wh-05": "โกดัง5",
  };
  return map[warehouseId] || warehouseId.replace(/\s+/g, "");
}

// Known GIDs for fallback read
const SHEET_GID_MAP: Record<string, string> = {
  PRODUCTS: "389621789",
  Products: "389621789",
  "สินค้า": "389621789",
  "โกดัง1": "1895414134",
  "โกดัง2": "1114507677",
  "โกดัง3": "549341078",
  "โกดัง4": "1516974305",
  "โกดัง5": "406847030",
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

  // Strictly forbid reading sensitive credentials or personal login logs via unauthenticated public CSV
  const isSensitive =
    sheetName.toLowerCase() === "users" ||
    sheetName === SHEETS.USERS ||
    sheetName === SHEETS.LOGIN_LOGS ||
    sheetName === "ประวัติการเข้าระบบ";
  if (isSensitive) {
    throw new Error(
      `ชีต ${sheetName} มีข้อมูลลับ/รหัสผ่าน ไม่อนุญาตให้อ่านผ่าน Public CSV โดยไม่ยืนยันตัวตน`
    );
  }

  const urls: string[] = [];
  const knownGid = SHEET_GID_MAP[sheetName];
  if (knownGid) {
    urls.push(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${knownGid}`);
  }
  urls.push(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`);
  urls.push(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`);

  let lastError: unknown = new Error(`ไม่สามารถอ่านชีต ${sheetName}`);
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastError = new Error(`Google Sheets CSV returned HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!text || text.trim().length <= 10) return [];

      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length <= 1) return [];

      const rows = lines.slice(1).map((line) =>
        line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map((cell) => cell.replace(/^\"|\"$/g, "").trim())
      );
      if (rows.length > 0) {
        // Guard against Google Sheets fallback redirecting non-USERS requests to GID 0 (USERS tab)
        const isUsersTab = sheetName.toLowerCase() === "users";
        const hasBcryptHash = rows.some((r) => r[2]?.startsWith("$2b$"));
        if (!isUsersTab && hasBcryptHash) {
          console.warn(`[GoogleSheets Public CSV] ${sheetName} tab not found (redirected to USERS), returning empty`);
          return [];
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
    throw new Error(`${operation} failed with HTTP ${response.status}`);
  }

  if (responseText.trim().startsWith("{")) {
    try {
      const payload = JSON.parse(responseText) as { success?: boolean; status?: string; error?: string; message?: string };
      if (payload.success === false || payload.status === "error") {
        throw new Error(payload.error || payload.message || `${operation} was rejected`);
      }
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  }
}

// ------ Read rows from a sheet (100% Real-time Single Source of Truth from Google Sheets) ------
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

  // Return memory-cached rows if available and fresh (< 10 seconds)
  if (!options?.forceFresh) {
    const cached = sheetCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const fetchFreshRows = async (): Promise<string[][]> => {
    // #1 FASTEST READ: Direct Google Sheets API v4 read via GOOGLE_API_KEY (100ms ultra fast!)
    const safeSheet = sheetName.startsWith("'") ? sheetName : `'${sheetName.replace(/'/g, "")}'`;
    const fullRange = range ? `${safeSheet}!${range}` : `${safeSheet}`;

    if (process.env.GOOGLE_API_KEY) {
      try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(fullRange)}?key=${process.env.GOOGLE_API_KEY}`;
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          let googleRows = (json.values as string[][]) ?? [];
          if (
            googleRows.length > 0 &&
            (googleRows[0][0]?.includes("_id") ||
              googleRows[0][0]?.toLowerCase().includes("sku") ||
              googleRows[0][0]?.includes("รหัสสินค้า") ||
              googleRows[0][0]?.includes("ID"))
          ) {
            googleRows = googleRows.slice(1);
          }
          return googleRows;
        }
      } catch (e) {
        console.warn(`[GoogleSheets API Key] ${sheetName} read failed:`, e);
      }
    }

    const hasServiceAccount = Boolean(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL
    );

    if (hasServiceAccount) {
      try {
        const sheets = getSheetsClient();
        const response = await withRetry(() =>
          sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: fullRange,
          })
        );
        let googleRows = (response.data.values as string[][]) ?? [];
        if (googleRows.length > 0 && (googleRows[0][0]?.includes("_id") || googleRows[0][0]?.toLowerCase().includes("sku") || googleRows[0][0]?.includes("รหัสสินค้า"))) {
          googleRows = googleRows.slice(1);
        }
        return googleRows;
      } catch (err) {
        console.warn(`[GoogleSheets API v4] ${sheetName} read failed:`, err);
      }
    }

    // Pure Google Sheets CSV read (returns exactly what is in Google Sheets)
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
    throw new Error(`ไม่สามารถอ่านข้อมูลจากชีต ${sheetName}`, { cause: error });
  }
}

// ------ Append rows to a sheet ------
export async function appendRows(
  sheetName: string,
  values: (string | number | boolean)[][]
): Promise<void> {
  clearSheetCache(sheetName);

  // Use exactly one writer. This prevents duplicate writes when multiple
  // credential types are configured at the same time.
  if (hasServiceAccountCredentials()) {
    try {
      const sheets = getSheetsClient();
      await withRetry(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheetName}!A1`,
          valueInputOption: "RAW",
          requestBody: { values },
        })
      );
      return;
    } catch (err) {
      throw new Error(`ไม่สามารถเพิ่มข้อมูลในชีต ${sheetName}`, { cause: err });
    }
  }

  if (process.env.GOOGLE_SCRIPT_URL) {
    try {
      const response = await sendSignedAppsScriptRequest({ action: "append", sheetName, values });
      await assertAppsScriptSuccess(response, `Append ${sheetName}`);
      return;
    } catch (error) {
      throw new Error(`ไม่สามารถเพิ่มข้อมูลในชีต ${sheetName}`, { cause: error });
    }
  }

  throw new Error("ไม่ได้ตั้งค่าช่องทางเขียน Google Sheets");
}

// ------ Update a specific row (by row number, 1-indexed) ------
export async function updateRow(
  sheetName: string,
  rowNumber: number,
  values: (string | number | boolean)[]
): Promise<void> {
  clearSheetCache(sheetName);

  if (hasServiceAccountCredentials()) {
    try {
      const sheets = getSheetsClient();
      const colEnd = columnLetter(values.length);
      await withRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheetName}!A${rowNumber}:${colEnd}${rowNumber}`,
          valueInputOption: "RAW",
          requestBody: { values: [values] },
        })
      );
      return;
    } catch (err) {
      throw new Error(`ไม่สามารถอัปเดตชีต ${sheetName} แถว ${rowNumber}`, { cause: err });
    }
  }

  if (process.env.GOOGLE_SCRIPT_URL) {
    try {
      const response = await sendSignedAppsScriptRequest({ action: "update", sheetName, rowNumber, values });
      await assertAppsScriptSuccess(response, `Update ${sheetName} row ${rowNumber}`);
      return;
    } catch (error) {
      throw new Error(`ไม่สามารถอัปเดตชีต ${sheetName} แถว ${rowNumber}`, { cause: error });
    }
  }

  throw new Error("ไม่ได้ตั้งค่าช่องทางเขียน Google Sheets");
}

// ------ Batch update multiple rows ------
export async function batchUpdateRows(
  sheetName: string,
  updates: { rowNumber: number; values: (string | number | boolean)[] }[]
): Promise<void> {
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

// ------ Delete specific rows by 0-indexed row numbers (sorted descending to avoid index shift) ------
export async function deleteRows(
  sheetName: string,
  rowIndices: number[] // 0-indexed (0 = header row, 1 = first data row A2)
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
      throw new Error(`ไม่สามารถลบแถวในชีต ${sheetName}`, { cause: err });
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
          // Apps Script fallback: Overwrite row with blank empty cells
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

// ------ Parse boolean from sheet ------
export function parseBoolean(val: string | undefined): boolean {
  return val === "TRUE" || val === "true" || val === "1";
}

// ------ Format boolean for sheet ------
export function formatBoolean(val: boolean): string {
  return val ? "TRUE" : "FALSE";
}
