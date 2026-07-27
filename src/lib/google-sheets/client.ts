import { google, sheets_v4 } from "googleapis";

// ============================================================
// Google Sheets Client — Singleton with exponential backoff
// ============================================================

let sheetsInstance: sheets_v4.Sheets | null = null;

export function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsInstance) return sheetsInstance;

  const credentials = {
    client_email: process.env.GOOGLE_CLIENT_EMAIL!,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? "",
  };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsInstance = google.sheets({ version: "v4", auth });
  return sheetsInstance;
}

export const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;

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

// ------ Retry with exponential backoff for 429 ------
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 5,
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

// ------ Read rows from a sheet ------
export async function readSheet(
  sheetName: string,
  range?: string
): Promise<string[][]> {
  const sheets = getSheetsClient();
  const fullRange = range ? `${sheetName}!${range}` : `${sheetName}`;
  const response = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: fullRange,
    })
  );
  return (response.data.values as string[][]) ?? [];
}

// ------ Append rows to a sheet ------
export async function appendRows(
  sheetName: string,
  values: (string | number | boolean)[][]
): Promise<void> {
  const sheets = getSheetsClient();
  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values },
    })
  );
}

// ------ Update a specific row (by row number, 1-indexed) ------
export async function updateRow(
  sheetName: string,
  rowNumber: number,
  values: (string | number | boolean)[]
): Promise<void> {
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
}

// ------ Batch update multiple rows ------
export async function batchUpdateRows(
  sheetName: string,
  updates: { rowNumber: number; values: (string | number | boolean)[] }[]
): Promise<void> {
  const sheets = getSheetsClient();
  const data = updates.map(({ rowNumber, values }) => ({
    range: `${sheetName}!A${rowNumber}:${columnLetter(values.length)}${rowNumber}`,
    values: [values],
  }));
  await withRetry(() =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data },
    })
  );
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
