import { google, sheets_v4 } from "googleapis";
import fs from "fs";
import path from "path";

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

export const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1tsndbJWnXPvY3_LQhtzVNPRMJxqjan3ScQXSvIUKPg4";

// Sheet tab names
export const SHEETS = {
  WAREHOUSES: "Warehouses",
  LOCATIONS: "Locations",
  PRODUCTS: "Products",
  DOCUMENTS: "Documents",
  STOCK_MOVEMENTS: "StockMovements",
  STOCK_SUMMARY: "StockSummary",
  STOCK_COUNTS: "StockCounts",
  USERS: "Users",
} as const;

// Known GIDs for fallback read
const SHEET_GID_MAP: Record<string, string> = {
  Products: "1895414134",
  PRODUCTS: "1895414134",
  "สินค้า": "1895414134",
  "โกดัง1": "1114507677",
  "โกดัง2": "549341078",
  "โกดัง3": "1516974305",
  "โกดัง4": "406847030",
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
  if (!SPREADSHEET_ID) return [];

  const urls: string[] = [];
  const knownGid = SHEET_GID_MAP[sheetName];
  if (knownGid) {
    urls.push(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${knownGid}`);
  }
  urls.push(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`);
  urls.push(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`);

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.trim().length <= 10) continue;

      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length <= 1) continue;

      const rows = lines.slice(1).map((line) =>
        line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map((cell) => cell.replace(/^\"|\"$/g, "").trim())
      );
      if (rows.length > 0) return rows;
    } catch (e) {
      console.warn(`[GoogleSheets Public CSV] Failed fetch via ${url}:`, e);
    }
  }

  return [];
}

// ------ Read rows from a sheet (100% Real-time Single Source of Truth from Google Sheets) ------
export async function readSheet(
  sheetName: string,
  range?: string
): Promise<string[][]> {
  if (!SPREADSHEET_ID) return [];

  const hasServiceAccount = Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL
  );

  if (hasServiceAccount) {
    try {
      const sheets = getSheetsClient();
      const fullRange = range ? `${sheetName}!${range}` : `${sheetName}`;
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
}

// ------ Append rows to a sheet ------
export async function appendRows(
  sheetName: string,
  values: (string | number | boolean)[][]
): Promise<void> {
  if (process.env.GOOGLE_SCRIPT_URL) {
    try {
      const body = JSON.stringify({ action: "append", sheetName, values });
      const res = await fetch(process.env.GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
        redirect: "follow",
        cache: "no-store",
      });
      const text = await res.text();
      console.log(`[GoogleScript Webhook] Append to ${sheetName} status:`, res.status, text.slice(0, 100));
    } catch (e) {
      console.warn(`[GoogleScript Webhook] append failed:`, e);
    }
  }

  if (SPREADSHEET_ID && (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL)) {
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
    } catch (err) {
      console.warn(`[GoogleSheets API v4] Sheet ${sheetName} append failed:`, err);
    }
  }
}

// ------ Update a specific row (by row number, 1-indexed) ------
export async function updateRow(
  sheetName: string,
  rowNumber: number,
  values: (string | number | boolean)[]
): Promise<void> {
  if (process.env.GOOGLE_SCRIPT_URL) {
    try {
      const body = JSON.stringify({ action: "update", sheetName, rowNumber, values });
      const res = await fetch(process.env.GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
        redirect: "follow",
        cache: "no-store",
      });
      const text = await res.text();
      console.log(`[GoogleScript Webhook] Update ${sheetName} status:`, res.status, text.slice(0, 100));
    } catch (e) {
      console.warn(`[GoogleScript Webhook] update failed:`, e);
    }
  }

  if (SPREADSHEET_ID && (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL)) {
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
    } catch (err) {
      console.warn(`[GoogleSheets API v4] Sheet ${sheetName} update row ${rowNumber} failed:`, err);
    }
  }
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
