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

const globalForSheetCache = globalThis as unknown as {
  sheetCache?: Map<string, SheetMemoryCache>;
  persistentSheetData?: Map<string, string[][]>;
};

if (!globalForSheetCache.sheetCache) {
  globalForSheetCache.sheetCache = new Map<string, SheetMemoryCache>();
}
if (!globalForSheetCache.persistentSheetData) {
  globalForSheetCache.persistentSheetData = new Map<string, string[][]>();
}

const sheetCache = globalForSheetCache.sheetCache;
const persistentSheetData = globalForSheetCache.persistentSheetData;
const CACHE_TTL_MS = 30 * 1000; // 30s memory cache TTL to prevent Google 429 quota exhaustion

// ข้อมูล master (สินค้า/โกดัง/ตำแหน่ง/ชั้น) แทบไม่เปลี่ยนระหว่างกะ — cache นานขึ้น
// ลดการยิง Google API ในชีวิตประจำวันได้มาก โดยทุก write path ยังเคลียร์ cache
// ของชีตที่ตัวเองเขียนเหมือนเดิม (เห็นข้อมูลตัวเองทันทีเสมอ)
// Users/BOM/ธุรกรรมต่าง ๆ คง TTL 30 วินาที เพราะความสดมีผลต่อความถูกต้อง
const REFERENCE_SHEETS = new Set(["products", "warehouses", "locations", "shelves"]);
const REFERENCE_TTL_MS = 5 * 60 * 1000;

function getCacheTtlMs(sheetName: string): number {
  const key = sheetName.replace(/^'|'$/g, "").trim().toLowerCase();
  return REFERENCE_SHEETS.has(key) ? REFERENCE_TTL_MS : CACHE_TTL_MS;
}

export function clearSheetCache(sheetName?: string) {
  if (sheetName) {
    const clean = sheetName.replace(/^'|'$/g, "").trim().toLowerCase();
    for (const key of sheetCache.keys()) {
      const keyLower = key.toLowerCase();
      if (keyLower.startsWith(`${clean}:`) || keyLower === clean) {
        sheetCache.delete(key);
      }
    }
  } else {
    sheetCache.clear();
  }
}

const globalForSheetFetch = globalThis as unknown as {
  inFlightSheetReads?: Map<string, Promise<string[][]>>;
  resolvedSheetNames?: Map<string, string>;
  sheetReadErrors?: Map<string, { message: string; at: number }>;
};
if (!globalForSheetFetch.inFlightSheetReads) {
  globalForSheetFetch.inFlightSheetReads = new Map<string, Promise<string[][]>>();
}
if (!globalForSheetFetch.resolvedSheetNames) {
  globalForSheetFetch.resolvedSheetNames = new Map<string, string>();
}
if (!globalForSheetFetch.sheetReadErrors) {
  globalForSheetFetch.sheetReadErrors = new Map<string, { message: string; at: number }>();
}
const inFlightSheetReads = globalForSheetFetch.inFlightSheetReads;
const resolvedSheetNames = globalForSheetFetch.resolvedSheetNames;
const sheetReadErrors = globalForSheetFetch.sheetReadErrors;

// readSheet กลบ error เป็น [] เพื่อ resilience — map นี้เก็บ error ล่าสุดไว้ให้ caller
// แยกแยะ "ชีตว่างจริง" ออกจาก "อ่านชีตไม่สำเร็จ" (เช่น Dashboard ต้องตอบ error ไม่ใช่ 0)
export function getSheetReadError(sheetName: string): string | null {
  return sheetReadErrors.get(sheetNameKey(sheetName))?.message ?? null;
}

function recordSheetReadError(sheetName: string, error: unknown): void {
  sheetReadErrors.set(sheetNameKey(sheetName), {
    message: error instanceof Error ? error.message : String(error),
    at: Date.now(),
  });
}

function clearSheetReadError(sheetName: string): void {
  sheetReadErrors.delete(sheetNameKey(sheetName));
}

// Once a candidate tab name succeeds, remember it so later reads/writes skip
// the sequential name probing — every probed miss is a billable Sheets API call.
function sheetNameKey(input: string): string {
  return input.replace(/^'|'$/g, "").trim().toLowerCase();
}

function getResolvedSheetName(input: string): string | undefined {
  return resolvedSheetNames.get(sheetNameKey(input));
}

function rememberResolvedSheetName(input: string, winner: string): void {
  resolvedSheetNames.set(sheetNameKey(input), winner);
}

function forgetResolvedSheetName(input: string): void {
  resolvedSheetNames.delete(sheetNameKey(input));
}

function hasServiceAccountCredentials(): boolean {
  return Boolean(
    (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL) &&
    process.env.GOOGLE_PRIVATE_KEY
  );
}

// ============================================================
// Tab-title metadata cache
// ดึงรายชื่อแท็บจริงทั้งหมดครั้งเดียว (spreadsheets.get) แล้วจับคู่ชื่อ logical
// กับชื่อแท็บจริง — ตัดการ "ลองชื่อ candidates ทีละอัน" ที่แต่ละ miss
// คือ Google API call 1 ครั้งเปล่า ๆ โดยเฉพาะตอน cold start
// ============================================================
interface SpreadsheetTabsCache {
  byNormTitle: Map<string, string>;
  byTitle: Map<string, { title: string; sheetId: number | null }>;
  at: number;
}

const TABS_CACHE_TTL_MS = 10 * 60 * 1000;
const globalForTabs = globalThis as unknown as {
  spreadsheetTabs?: SpreadsheetTabsCache;
  spreadsheetTabsInFlight?: Promise<SpreadsheetTabsCache | null> | undefined;
};

function normalizeTabTitle(title: string): string {
  return title.replace(/\s+/g, "").toLowerCase();
}

async function fetchSpreadsheetTabs(): Promise<SpreadsheetTabsCache | null> {
  if (!SPREADSHEET_ID) return null;
  try {
    let sheetsMeta: { title?: string | null; sheetId?: number | null }[] = [];
    if (hasServiceAccountCredentials()) {
      const meta = await withRetry(() =>
        getSheetsClient().spreadsheets.get({
          spreadsheetId: SPREADSHEET_ID,
          fields: "sheets.properties(title,sheetId)",
        })
      );
      sheetsMeta = (meta.data.sheets ?? []).map((s) => ({
        title: s.properties?.title,
        sheetId: s.properties?.sheetId ?? null,
      }));
    } else if (process.env.GOOGLE_API_KEY) {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties(title,sheetId)&key=${process.env.GOOGLE_API_KEY}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      sheetsMeta = (json.sheets ?? []).map(
        (s: { properties?: { title?: string; sheetId?: number } }) => ({
          title: s.properties?.title,
          sheetId: s.properties?.sheetId ?? null,
        })
      );
    } else {
      return null;
    }

    const byNormTitle = new Map<string, string>();
    const byTitle = new Map<string, { title: string; sheetId: number | null }>();
    for (const m of sheetsMeta) {
      if (!m.title) continue;
      byNormTitle.set(normalizeTabTitle(m.title), m.title);
      byTitle.set(m.title, { title: m.title, sheetId: m.sheetId ?? null });
    }
    if (byTitle.size === 0) return globalForTabs.spreadsheetTabs ?? null;
    const cache: SpreadsheetTabsCache = { byNormTitle, byTitle, at: Date.now() };
    globalForTabs.spreadsheetTabs = cache;
    return cache;
  } catch (e) {
    console.warn("[GoogleSheets] fetchSpreadsheetTabs failed:", e);
    return globalForTabs.spreadsheetTabs ?? null;
  }
}

async function getSpreadsheetTabs(): Promise<SpreadsheetTabsCache | null> {
  const cached = globalForTabs.spreadsheetTabs;
  if (cached && Date.now() - cached.at < TABS_CACHE_TTL_MS) return cached;
  if (globalForTabs.spreadsheetTabsInFlight) return globalForTabs.spreadsheetTabsInFlight;
  const inFlight = fetchSpreadsheetTabs().finally(() => {
    globalForTabs.spreadsheetTabsInFlight = undefined;
  });
  globalForTabs.spreadsheetTabsInFlight = inFlight;
  return inFlight;
}

/**
 * Resolve logical sheet name → ชื่อแท็บจริงจาก metadata ที่ cache ไว้
 * (คืน null เมื่อหาไม่ได้/ดึง metadata ไม่ได้ — caller ไปต่อด้วยวิธีเดิม)
 */
async function resolveSheetTitle(sheetName: string): Promise<string | null> {
  const memo = getResolvedSheetName(sheetName);
  if (memo) return memo;
  const tabs = await getSpreadsheetTabs();
  if (!tabs) return null;
  const clean = sheetName.replace(/^'|'$/g, "").trim();
  const direct = tabs.byNormTitle.get(normalizeTabTitle(clean));
  if (direct) {
    rememberResolvedSheetName(sheetName, direct);
    return direct;
  }
  for (const cand of getPossibleSheetNames(clean)) {
    const hit = tabs.byNormTitle.get(normalizeTabTitle(cand));
    if (hit) {
      rememberResolvedSheetName(sheetName, hit);
      return hit;
    }
  }
  return null;
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
function sheetReadCacheKey(
  sheetName: string,
  range?: string,
  keepHeader?: boolean
): string {
  // keepHeader=true ต้องแยก cache เพราะข้อมูลที่ได้ (มีหัวตาราง) ต่างจากปกติ
  return keepHeader
    ? `${sheetName}:${range || "ALL"}:raw`
    : `${sheetName}:${range || "ALL"}`;
}

// ตัดแถวหัวตารางออกตาม heuristic เดียวกับเส้นทาง service account
function stripHeaderRowIfPresent(rows: string[][], keepHeader?: boolean): string[][] {
  if (rows.length === 0 || keepHeader) return rows;
  const first = rows[0][0] ?? "";
  if (
    first.includes("_id") ||
    first.toLowerCase().includes("sku") ||
    first.includes("รหัสสินค้า")
  ) {
    return rows.slice(1);
  }
  return rows;
}

async function fetchFreshRowsUncached(
  sheetName: string,
  range?: string,
  options?: { forceFresh?: boolean; maxAgeMs?: number; keepHeader?: boolean }
): Promise<string[][]> {
  const cleanSheet = sheetName.replace(/^'|'$/g, "").trim();
  const safeSheet = cleanSheet.includes(" ") || cleanSheet.includes("-") ? `'${cleanSheet}'` : cleanSheet;
  const fullRange = range ? `${safeSheet}!${range}` : `${safeSheet}!A1:Z5000`;

  if (process.env.GOOGLE_API_KEY) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(fullRange)}?key=${process.env.GOOGLE_API_KEY}`;
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          let googleRows = (json.values as string[][]) ?? [];
          if (googleRows.length > 0 && !options?.keepHeader) {
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
        } else if (res.status === 429 || res.status === 503) {
          // Rate limited by Google Sheets - back off and retry
          const backoff = 500 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        } else {
          console.warn(`[GoogleSheets API Key] HTTP ${res.status} for ${url}:`, await res.text());
          break;
        }
      } catch (e) {
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        console.warn(`[GoogleSheets API Key] ${sheetName} read failed:`, e);
      }
    }
  }

  if (hasServiceAccountCredentials()) {
    const readViaServiceAccount = async (cand: string): Promise<string[][]> => {
      const sheets = getSheetsClient();
      const safeCand = cand.startsWith("'") ? cand : `'${cand.replace(/'/g, "")}'`;
      const candRange = range ? `${safeCand}!${range}` : `${safeCand}`;
      const response = await withRetry(() =>
        sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: candRange,
        })
      );
      return stripHeaderRowIfPresent(
        (response.data.values as string[][]) ?? [],
        options?.keepHeader
      );
    };

    // metadata cache บอกชื่อแท็บจริงได้ภายใน call เดียว — ไม่ต้องลอง candidates
    const resolved = await resolveSheetTitle(sheetName);
    if (resolved) {
      try {
        const rows = await readViaServiceAccount(resolved);
        if (rows.length > 0) return rows;
        // Resolved tab exists but is empty — re-probe in case the tab moved.
        forgetResolvedSheetName(sheetName);
      } catch {
        forgetResolvedSheetName(sheetName);
      }
    }

    const candidates = getPossibleSheetNames(sheetName);
    for (const cand of candidates) {
      try {
        const googleRows = await readViaServiceAccount(cand);
        if (googleRows.length > 0) rememberResolvedSheetName(sheetName, cand);
        return googleRows;
      } catch (err) {
        // Try next candidate
      }
    }
  }

  return readPublicSheetCsv(sheetName);
}

// เอาผลที่อ่านได้ (ไม่ว่าจะจาก batchGet หรืออ่านเดี่ยว) เก็บลง cache และคืนค่า
// พร้อมกลไก preserve-last-good เดิม: อ่านได้ 0 แถว/อ่านพลาด → ใช้ข้อมูลเดิม
async function settleFetchedRows(
  sheetName: string,
  range: string | undefined,
  options: { keepHeader?: boolean } | undefined,
  freshRows: string[][]
): Promise<string[][]> {
  const cacheKey = sheetReadCacheKey(sheetName, range, options?.keepHeader);
  if (freshRows && freshRows.length > 0) {
    clearSheetReadError(sheetName);
    sheetCache.set(cacheKey, { data: freshRows, timestamp: Date.now() });
    persistentSheetData.set(cacheKey, freshRows);
    persistentSheetData.set(sheetName, freshRows);
    return freshRows;
  }

  // If freshRows returned empty but we previously had good data, preserve the good data
  const lastGood = persistentSheetData.get(cacheKey) || persistentSheetData.get(sheetName);
  if (lastGood && lastGood.length > 0) {
    console.warn(`[GoogleSheets readSheet] Fresh fetch returned 0 rows for ${sheetName}, preserving ${lastGood.length} existing rows`);
    sheetCache.set(cacheKey, { data: lastGood, timestamp: Date.now() });
    return lastGood;
  }

  sheetCache.set(cacheKey, { data: [], timestamp: Date.now() });
  return [];
}

async function fetchAndCacheRead(
  sheetName: string,
  range?: string,
  options?: { forceFresh?: boolean; maxAgeMs?: number; keepHeader?: boolean }
): Promise<string[][]> {
  const cacheKey = sheetReadCacheKey(sheetName, range, options?.keepHeader);
  try {
    const freshRows = await fetchFreshRowsUncached(sheetName, range, options);
    return await settleFetchedRows(sheetName, range, options, freshRows);
  } catch (error) {
    recordSheetReadError(sheetName, error);
    const cached = sheetCache.get(cacheKey);
    if (cached && cached.data.length > 0) {
      console.warn(`[GoogleSheets readSheet] Using memory cached rows for ${sheetName} (${cached.data.length} rows)`);
      return cached.data;
    }
    const lastGood = persistentSheetData.get(cacheKey) || persistentSheetData.get(sheetName);
    if (lastGood && lastGood.length > 0) {
      console.warn(`[GoogleSheets readSheet] Using persistent fallback rows for ${sheetName} (${lastGood.length} rows)`);
      return lastGood;
    }
    console.warn(`[GoogleSheets readSheet] Could not fetch ${sheetName}, returning empty fallback:`, error);
    return [];
  }
}

// ============================================================
// Micro-batching ของ read ที่มาพร้อมกัน
// readSheet หลายตัวที่ถูกเรียกใน tick เดียวกัน (Promise.all ใน repository)
// จะถูกรวมเป็น spreadsheets.values.batchGet ครั้งเดียว — N read = 1 quota
// unit + 1 round trip แทนที่จะเป็น N และไม่ต้องแก้ caller ทั้งหมด
// ============================================================
interface QueuedSheetRead {
  sheetName: string;
  range?: string;
  options?: { forceFresh?: boolean; maxAgeMs?: number; keepHeader?: boolean };
  resolve: (rows: string[][]) => void;
}

const MICRO_BATCH_WINDOW_MS = Math.max(
  0,
  Number(process.env.SHEETS_MICRO_BATCH_MS ?? 10)
);
const globalForBatch = globalThis as unknown as {
  sheetReadQueue?: QueuedSheetRead[];
  sheetReadFlushTimer?: ReturnType<typeof setTimeout> | null;
};
if (!globalForBatch.sheetReadQueue) globalForBatch.sheetReadQueue = [];
const sheetReadQueue = globalForBatch.sheetReadQueue;

function batchReadsSupported(): boolean {
  return (
    MICRO_BATCH_WINDOW_MS > 0 &&
    (hasServiceAccountCredentials() || Boolean(process.env.GOOGLE_API_KEY))
  );
}

function enqueueSheetRead(item: QueuedSheetRead): void {
  sheetReadQueue.push(item);
  if (!globalForBatch.sheetReadFlushTimer) {
    globalForBatch.sheetReadFlushTimer = setTimeout(() => {
      globalForBatch.sheetReadFlushTimer = null;
      void flushSheetReadQueue();
    }, MICRO_BATCH_WINDOW_MS);
  }
}

function quotedA1(title: string, range?: string): string {
  const safe = `'${title.replace(/'/g, "''")}'`;
  return range ? `${safe}!${range}` : safe;
}

async function flushSheetReadQueue(): Promise<void> {
  const batch = sheetReadQueue.splice(0, sheetReadQueue.length);
  if (batch.length === 0) return;

  const resolutions = await Promise.all(
    batch.map((item) => resolveSheetTitle(item.sheetName).catch(() => null))
  );

  const fetchKey = (title: string, range?: string) => `${title}\u0000${range ?? ""}`;
  const targets = new Map<string, { title: string; range?: string }>();
  const paired: { item: QueuedSheetRead; title: string }[] = [];
  const runIndividually: QueuedSheetRead[] = [];

  // ชีตที่ resolve ชื่อไม่ได้ (metadata ไม่พร้อม) ให้อ่านเดี่ยวตามวิธีเดิม
  // เพื่อไม่ให้ range ที่พังลามไป kill ทั้ง batch
  batch.forEach((item, i) => {
    const title = resolutions[i];
    if (title) {
      paired.push({ item, title });
      const key = fetchKey(title, item.range);
      if (!targets.has(key)) targets.set(key, { title, range: item.range });
    } else {
      runIndividually.push(item);
    }
  });

  const results = new Map<string, string[][]>();
  if (targets.size > 0) {
    try {
      const targetList = [...targets.values()];
      const ranges = targetList.map((t) => quotedA1(t.title, t.range));
      let valueRanges: { values?: string[][] }[] = [];
      if (hasServiceAccountCredentials()) {
        const response = await withRetry(() =>
          getSheetsClient().spreadsheets.values.batchGet({
            spreadsheetId: SPREADSHEET_ID,
            ranges,
          })
        );
        valueRanges = (response.data.valueRanges ?? []) as { values?: string[][] }[];
      } else {
        const params = new URLSearchParams();
        for (const r of ranges) params.append("ranges", r);
        params.set("key", process.env.GOOGLE_API_KEY ?? "");
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${params.toString()}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`batchGet HTTP ${res.status}`);
        const json = await res.json();
        valueRanges = (json.valueRanges ?? []) as { values?: string[][] }[];
      }
      targetList.forEach((t, i) => {
        results.set(fetchKey(t.title, t.range), (valueRanges[i]?.values as string[][]) ?? []);
      });
    } catch (err) {
      console.warn("[GoogleSheets] batchGet failed, falling back to individual reads:", err);
      results.clear();
    }
  }

  await Promise.all(
    paired.map(async ({ item, title }) => {
      const key = fetchKey(title, item.range);
      const rows = results.get(key);
      if (rows) {
        item.resolve(
          await settleFetchedRows(
            item.sheetName,
            item.range,
            item.options,
            stripHeaderRowIfPresent(rows, item.options?.keepHeader)
          )
        );
      } else {
        item.resolve(await fetchAndCacheRead(item.sheetName, item.range, item.options));
      }
    })
  );

  await Promise.all(
    runIndividually.map(async (item) => {
      item.resolve(await fetchAndCacheRead(item.sheetName, item.range, item.options));
    })
  );
}

export async function readSheet(
  sheetName: string,
  range?: string,
  options?: { forceFresh?: boolean; maxAgeMs?: number; keepHeader?: boolean }
): Promise<string[][]> {
  if (!SPREADSHEET_ID) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("GOOGLE_SHEET_ID is required");
    }
    return [];
  }

  const cacheKey = sheetReadCacheKey(sheetName, range, options?.keepHeader);
  const maxAgeMs = options?.forceFresh ? 0 : options?.maxAgeMs ?? getCacheTtlMs(sheetName);

  const cached = sheetCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < maxAgeMs) {
    return cached.data;
  }

  // Coalesce concurrent reads for the same sheet so a burst of polls (or a
  // cold-cache stampede) triggers a single Google Sheets fetch.
  const inFlight = inFlightSheetReads.get(cacheKey);
  if (inFlight) return inFlight;

  const fetchPromise = batchReadsSupported()
    ? new Promise<string[][]>((resolve) => {
        enqueueSheetRead({ sheetName, range, options, resolve });
      })
    : fetchAndCacheRead(sheetName, range, options);

  inFlightSheetReads.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    if (inFlightSheetReads.get(cacheKey) === fetchPromise) {
      inFlightSheetReads.delete(cacheKey);
    }
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

    const appendToCandidate = (nameCandidate: string) => {
      const safeName = nameCandidate.startsWith("'") ? nameCandidate : `'${nameCandidate.replace(/'/g, "")}'`;
      return withRetry(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${safeName}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values },
        })
      );
    };

    let lastAppendErr: unknown = null;
    const resolved = await resolveSheetTitle(sheetName);
    if (resolved) {
      try {
        await appendToCandidate(resolved);
        return;
      } catch (candidateErr) {
        forgetResolvedSheetName(sheetName);
        lastAppendErr = candidateErr;
      }
    }
    for (const nameCandidate of possibleSheetNames) {
      try {
        await appendToCandidate(nameCandidate);
        rememberResolvedSheetName(sheetName, nameCandidate);
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

    const updateCandidate = (nameCandidate: string) => {
      const safeName = nameCandidate.startsWith("'") ? nameCandidate : `'${nameCandidate.replace(/'/g, "")}'`;
      return withRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${safeName}!A${rowNumber}:${colEnd}${rowNumber}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [values] },
        })
      );
    };

    let lastUpdateErr: unknown = null;
    const resolved = await resolveSheetTitle(sheetName);
    if (resolved) {
      try {
        await updateCandidate(resolved);
        return;
      } catch (candidateErr) {
        forgetResolvedSheetName(sheetName);
        lastUpdateErr = candidateErr;
      }
    }
    for (const nameCandidate of possibleSheetNames) {
      try {
        await updateCandidate(nameCandidate);
        rememberResolvedSheetName(sheetName, nameCandidate);
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

    const batchUpdateCandidate = (nameCandidate: string) => {
      const safeName = nameCandidate.startsWith("'") ? nameCandidate : `'${nameCandidate.replace(/'/g, "")}'`;
      const data = updates.map(({ rowNumber, values }) => ({
        range: `${safeName}!A${rowNumber}:${columnLetter(values.length)}${rowNumber}`,
        values: [values],
      }));
      return withRetry(() =>
        sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data,
          },
        })
      );
    };

    let lastBatchErr: unknown = null;
    const resolved = await resolveSheetTitle(sheetName);
    if (resolved) {
      try {
        await batchUpdateCandidate(resolved);
        return;
      } catch (candidateErr) {
        forgetResolvedSheetName(sheetName);
        lastBatchErr = candidateErr;
      }
    }
    for (const nameCandidate of possibleSheetNames) {
      try {
        await batchUpdateCandidate(nameCandidate);
        rememberResolvedSheetName(sheetName, nameCandidate);
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
    // metadata cache มี sheetId ครบ — ไม่ต้องยิง spreadsheets.get ทุกครั้ง
    const tabs = await getSpreadsheetTabs();
    if (tabs) {
      const title = (await resolveSheetTitle(sheetName)) ?? null;
      if (title) return tabs.byTitle.get(title)?.sheetId ?? null;
    }
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
