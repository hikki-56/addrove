import * as XLSX from "xlsx";
import type { Product } from "@/types/models";
import type { OutboundColumnMapping } from "./outbound-schemas";

/**
 * นำเข้าบิลจากไฟล์ที่ export จากโปรแกรม Express (.xlsx / .csv)
 * ออกแบบ stateless: ทุกขั้น (analyze → preview → commit) ส่งไฟล์มาใหม่
 * แล้ว parse ใหม่ทุกครั้ง — ไม่เก็บ state บนเซิร์ฟเวอร์ (Vercel serverless)
 */

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_ROWS = 5000;

export interface SheetAnalysis {
  name: string;
  totalRows: number;
  suggestedHeaderRow: number;
  headers: string[];
  sampleRows: string[][];
}

export interface AnalyzeResult {
  fileName: string;
  sheets: SheetAnalysis[];
  suggestedMapping: OutboundColumnMapping | null;
  suggestedSheet: string | null;
}

export interface ParsedBillItem {
  sku: string;
  qty: number;
  product_name?: string;
  location?: string;
}

export interface ParsedBill {
  express_bill_no: string;
  customer?: string;
  date?: string;
  items: ParsedBillItem[];
}

export interface MatchedBillItem extends ParsedBillItem {
  product?: Product;
  matched: boolean;
}

export interface PreviewBill {
  express_bill_no: string;
  customer?: string;
  date?: string;
  items: MatchedBillItem[];
  total_qty: number;
  unmatched_count: number;
  duplicate_of?: string; // document_no ของบิลเดิมในระบบ (นำเข้าซ้ำ)
  /** แบ่งกล่อง Q ล่วงหน้า (จัดให้อัตโนมัติตอน preview/commit — รายการบิลเดียวกันอยู่ด้วยกัน) */
  q_assignments?: Array<{ q_code: string; items: Array<{ sku: string; qty: number }> }>;
}

// ---------- helpers ----------

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** แปลงจำนวนจากไฟล์ ("1,500.00", "1 500", "12") → จำนวนเต็มบวก */
export function parseQty(v: unknown): number {
  const raw = cellToString(v).replace(/[,\s]/g, "");
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function normalizeHeader(v: unknown): string {
  return cellToString(v).replace(/\s+/g, " ").toLowerCase();
}

// ---------- analyze ----------

const HEADER_KEYWORDS: Record<keyof OutboundColumnMapping, string[]> = {
  bill_no: ["เลขที่เอกสาร", "เลขที่บิล", "เลขที่ใบสั่ง", "เลขที่", "เอกสาร", "bill", "docno", "doc no", "doc no.", "invoice", "reference"],
  sku: ["รหัสสินค้า", "รหัส", "sku", "code", "item code", "part"],
  qty: ["จำนวน", "qty", "quantity", "จำนวนสั่ง", "จำนวนที่สั่ง", "quantity ordered"],
  product_name: ["ชื่อสินค้า", "รายการ", "ชื่อ", "description", "name", "product"],
  location: ["ตำแหน่ง", "location", "ชั้นวาง", "โกดัง"],
  customer: ["ลูกค้า", "customer", "ผู้รับ", "ร้าน", "ชื่อลูกค้า"],
  date: ["วันที่", "date", "วันที่เอกสาร", "วันที่บิล"],
};

export function suggestMapping(headers: string[]): OutboundColumnMapping | null {
  const normalized = headers.map(normalizeHeader);
  const find = (keys: string[]): string | undefined => {
    // หา exact ก่อน แล้วค่อยหา contains (สั้นสุด match ชนะกว่ายาว)
    for (const key of keys) {
      const idx = normalized.findIndex((h) => h === key);
      if (idx !== -1) return headers[idx];
    }
    for (const key of keys) {
      const idx = normalized.findIndex((h) => h && h.includes(key));
      if (idx !== -1) return headers[idx];
    }
    return undefined;
  };

  const bill_no = find(HEADER_KEYWORDS.bill_no);
  const sku = find(HEADER_KEYWORDS.sku);
  const qty = find(HEADER_KEYWORDS.qty);
  if (!bill_no || !sku || !qty) return null;
  return {
    bill_no,
    sku,
    qty,
    product_name: find(HEADER_KEYWORDS.product_name) ?? "",
    location: find(HEADER_KEYWORDS.location) ?? "",
    customer: find(HEADER_KEYWORDS.customer) ?? "",
    date: find(HEADER_KEYWORDS.date) ?? "",
  };
}

/** หาแถวหัวตา: แถวแรก (ภายใน 15 แถวแรก) ที่หา bill/sku/qty ได้ครบ */
function detectHeaderRow(rows: string[][]): number {
  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const headers = rows[r].map(cellToString);
    if (suggestMapping(headers)) return r + 1; // 1-based
  }
  // fallback: แถวแรกที่มี ≥ 3 ช่องไม่ว่าง
  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const filled = rows[r].filter((c) => cellToString(c) !== "").length;
    if (filled >= 3) return r + 1;
  }
  return 1;
}

export function analyzeWorkbook(buffer: Buffer, fileName: string): AnalyzeResult {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheets: SheetAnalysis[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    }) as unknown[][];
    const strRows = rows.slice(0, 60).map((r) => (Array.isArray(r) ? r.map(cellToString) : []));
    const headerRow = detectHeaderRow(strRows);
    const headers = strRows[headerRow - 1] ?? [];
    return {
      name,
      totalRows: Math.max(0, rows.length - headerRow),
      suggestedHeaderRow: headerRow,
      headers,
      sampleRows: strRows.slice(headerRow, headerRow + 8),
    };
  });

  // เลือก sheet แรกที่ suggest คอลัมน์ได้ (skip sheet สรุป/ว่าง)
  let suggestedSheet: string | null = null;
  let suggestedMapping: OutboundColumnMapping | null = null;
  for (const s of sheets) {
    if (s.totalRows === 0) continue;
    const m = suggestMapping(s.headers);
    if (m) {
      suggestedSheet = s.name;
      suggestedMapping = m;
      break;
    }
  }
  if (!suggestedSheet && sheets.length > 0) {
    suggestedSheet = sheets[0].name;
  }

  return { fileName, sheets, suggestedSheet, suggestedMapping };
}

// ---------- parse rows → bills ----------

export function parseBills(
  buffer: Buffer,
  sheetName: string,
  headerRow: number,
  mapping: OutboundColumnMapping
): ParsedBill[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`ไม่พบชีต "${sheetName}" ในไฟล์`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  }) as unknown[][];
  if (rows.length < headerRow) throw new Error(`แถวหัวตาที่ ${headerRow} เกินจำนวนแถวในไฟล์`);

  const headers = (rows[headerRow - 1] ?? []).map(cellToString);
  const colIndex = (header: string): number => headers.findIndex((h) => h === header);

  const required: Array<[keyof OutboundColumnMapping, string]> = [
    ["bill_no", "เลขที่บิล"],
    ["sku", "รหัสสินค้า"],
    ["qty", "จำนวน"],
  ];
  for (const [field, label] of required) {
    const header = mapping[field];
    if (!header || colIndex(header) === -1) {
      throw new Error(`ไม่พบคอลัมน์${label} ("${header || "-"}") ในแถวหัวตา — ตรวจสอบการจับคู่คอลัมน์`);
    }
  }

  const iBill = colIndex(mapping.bill_no);
  const iSku = colIndex(mapping.sku);
  const iQty = colIndex(mapping.qty);
  const iName = mapping.product_name ? colIndex(mapping.product_name) : -1;
  const iLoc = mapping.location ? colIndex(mapping.location) : -1;
  const iCust = mapping.customer ? colIndex(mapping.customer) : -1;
  const iDate = mapping.date ? colIndex(mapping.date) : -1;

  const billMap = new Map<string, ParsedBill>();
  let rowCount = 0;

  for (let r = headerRow; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const billNo = cellToString(row[iBill]);
    const sku = cellToString(row[iSku]);
    const qty = parseQty(row[iQty]);
    if (!billNo && !sku) continue; // แถวว่าง
    rowCount++;
    if (rowCount > MAX_ROWS) throw new Error(`ไฟล์มีมากกว่า ${MAX_ROWS} แถว — แบ่งไฟล์ก่อนนำเข้า`);
    if (!billNo) throw new Error(`แถวที่ ${r + 1}: ไม่มีเลขที่บิล`);
    if (!sku) throw new Error(`แถวที่ ${r + 1} (บิล ${billNo}): ไม่มีรหัสสินค้า`);
    if (qty <= 0) throw new Error(`แถวที่ ${r + 1} (บิล ${billNo}, ${sku}): จำนวนไม่ถูกต้อง (ได้ ${qty})`);

    let bill = billMap.get(billNo);
    if (!bill) {
      bill = {
        express_bill_no: billNo,
        customer: iCust >= 0 ? cellToString(row[iCust]) || undefined : undefined,
        date: iDate >= 0 ? cellToString(row[iDate]) || undefined : undefined,
        items: [],
      };
      billMap.set(billNo, bill);
    }
    bill.items.push({
      sku,
      qty,
      product_name: iName >= 0 ? cellToString(row[iName]) || undefined : undefined,
      location: iLoc >= 0 ? cellToString(row[iLoc]) || undefined : undefined,
    });
  }

  if (billMap.size === 0) throw new Error("ไม่พบรายการบิลในไฟล์ (หลังแถวหัวตา)");
  return Array.from(billMap.values());
}

// ---------- product matching ----------

function cleanSku(v: string): string {
  return v.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_#]/g, "");
}

export function matchProducts(bills: ParsedBill[], products: Product[]): PreviewBill[] {
  const bySku = new Map<string, Product>();
  const byBarcode = new Map<string, Product>();
  for (const p of products) {
    if (p.sku) bySku.set(cleanSku(p.sku), p);
    if (p.barcode) byBarcode.set(cleanSku(p.barcode), p);
  }

  // จับคู่แบบ "ต้นรายละเอียดตรงกัน" — สำหรับ PDF ของ Express ที่รหัสบรรทัด
  // (เช่น "1203 #B-04", "0350#KJ35MM S") คือต้นข้อความของคอลัมน์รายละเอียดใน PRODUCTS
  // (SKU จริงคือ B04/KJ35M) — เทียบแบบ lowercase + ยุบช่องว่าง
  const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const descPrefixMatch = (key: string): Product | undefined => {
    if (key.length < 4) return undefined;
    return products.find((p) => {
      const pn = normName(p.product_name || "");
      if (!pn) return false;
      return pn === key || pn.startsWith(key) || key.startsWith(pn);
    });
  };

  const findProduct = (rawSku: string, rawName?: string): Product | undefined => {
    const key = cleanSku(rawSku);
    const byExact = bySku.get(key) ?? byBarcode.get(key);
    if (byExact) return byExact;
    if (rawName) {
      const nameKey = cleanSku(rawName);
      const byNameExact = bySku.get(nameKey) ?? byBarcode.get(nameKey);
      if (byNameExact) return byNameExact;
    }
    return (
      descPrefixMatch(normName(rawSku)) ??
      (rawName ? descPrefixMatch(normName(rawName)) : undefined)
    );
  };

  return bills.map((b) => {
    const items: MatchedBillItem[] = b.items.map((it) => {
      const product = findProduct(it.sku, it.product_name);
      return { ...it, product, matched: Boolean(product) };
    });
    // รวมรายการ SKU ซ้ำในบิลเดียวกัน (บางไฟล์แยกบรรทัดต่อโปรโมชั่น)
    const merged = new Map<string, MatchedBillItem>();
    for (const it of items) {
      const key = cleanSku(it.sku);
      const existing = merged.get(key);
      if (existing) {
        existing.qty += it.qty;
      } else {
        merged.set(key, { ...it });
      }
    }
    const mergedItems = Array.from(merged.values());
    return {
      express_bill_no: b.express_bill_no,
      customer: b.customer,
      date: b.date,
      items: mergedItems,
      total_qty: mergedItems.reduce((s, it) => s + it.qty, 0),
      unmatched_count: mergedItems.filter((it) => !it.matched).length,
    };
  });
}
