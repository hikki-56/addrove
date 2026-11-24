import type { CountReferenceRow } from "@/types/count-round";
import { readWarehouseStockReport } from "./warehouse-stock-report";

const HEADER_SCAN = 20;
const SKU_HEADERS = ["รหัสสินค้า", "รหัส", "sku", "item code", "itemcode", "product code", "productcode"];
const BARCODE_HEADERS = ["บาร์โค้ด", "เลขบาร์โค้ด", "รหัสบาร์โค้ด", "บาร์โค๊ด", "barcode", "bar code"];
const QTY_HEADERS = [
  "จำนวนตามไฟล์", "จำนวนคงเหลือ", "ยอดคงเหลือ", "จำนวนที่นับได้", "expected_qty", "expectedqty",
  "quantity", "qty", "จำนวน", "คงเหลือ", "สต็อก", "สต๊อก", "stock", "onhand", "on hand",
];
const PIECE_HEADERS = ["จำนวนชิ้น", "ชิ้น"];
const BOX_HEADERS = ["จำนวนกล่อง", "กล่อง"];
const SHELF_HEADERS = ["ชั้น", "ชั้นวาง", "รหัสชั้น", "ตำแหน่ง", "shelf", "shelf_code", "shelfcode"];
const WAREHOUSE_HEADERS = ["โกดัง", "คลังสินค้า", "warehouse", "warehouse_id", "warehouseid"];

function decodeCsv(bytes: ArrayBuffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-874").decode(bytes); }
}

function headerKey(value: string) {
  return value.replace(/^\uFEFF/, "").replace(/[\s()（）*：:_-]+/g, "").trim().toLowerCase();
}

function column(headers: string[], names: string[]) {
  const aliases = new Set(names.map(headerKey));
  return headers.findIndex(v => aliases.has(headerKey(v)));
}

function quantityColumn(headers: string[]) {
  for (const names of [QTY_HEADERS, PIECE_HEADERS, BOX_HEADERS]) {
    const index = column(headers, names);
    if (index >= 0) return index;
  }
  return -1;
}

function findHeaderRow(table: string[][]) {
  const limit = Math.min(HEADER_SCAN, table.length);
  for (let i = 0; i < limit; i++) {
    const headers = table[i] ?? [];
    if ((column(headers, SKU_HEADERS) >= 0 || column(headers, BARCODE_HEADERS) >= 0) && quantityColumn(headers) >= 0)
      return i;
  }
  return -1;
}

function previewHeaders(table: string[][]) {
  const rows = table.slice(0, HEADER_SCAN);
  const match = rows.find(r => column(r, SKU_HEADERS) >= 0 || column(r, BARCODE_HEADERS) >= 0)
    ?? rows.find(r => r.some(v => v.trim()));
  return (match ?? [])
    .map(v => v.replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function headerError(table: string[][], sheetName: string, manySheets: boolean) {
  const found = previewHeaders(table);
  const preview = found.length ? ` หัวที่พบ: ${found.slice(0, 8).join(", ")}` : "";
  const sheet = manySheets ? ` ของแผ่น “${sheetName}”` : "";
  return `กรุณาใส่หัวคอลัมน์ รหัสสินค้า (หรือบาร์โค้ด) และจำนวน ใน 20 แถวแรก${sheet}${preview}`;
}

function readGenericRows(
  table: string[][],
  sheet: import("xlsx").WorkSheet,
  header: number,
  XLSX: typeof import("xlsx"),
) {
  const headers = table[header] ?? [];
  const sku = column(headers, SKU_HEADERS);
  const barcode = column(headers, BARCODE_HEADERS);
  const shelf = column(headers, SHELF_HEADERS);
  const qty = quantityColumn(headers);
  const warehouse = column(headers, WAREHOUSE_HEADERS);
  const rows: CountReferenceRow[] = [];
  for (let i = header + 1; i < table.length; i++) {
    const values = table[i];
    if (!values.some(v => v.trim())) continue;
    const code = values[sku]?.trim() || values[barcode]?.trim();
    const place = values[shelf]?.trim() ?? "";
    const cell = sheet[XLSX.utils.encode_cell({ r: i, c: qty })];
    const value = String(cell?.v ?? "").trim();
    if (!code) throw new Error(`แถว ${i + 1} กรุณาระบุรหัสสินค้าหรือบาร์โค้ด`);
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,3})?$/.test(value) || Number(value.replaceAll(",", "")) > 99999999999.999)
      throw new Error(`แถว ${i + 1} จำนวนต้องเป็นเลขตั้งแต่ 0 ถึง 99,999,999,999.999 และมีทศนิยมไม่เกิน 3 ตำแหน่ง`);
    rows.push({ row: i + 1, code, shelf: place, quantity: Number(value.replaceAll(",", "")), warehouse: values[warehouse]?.trim() || undefined });
  }
  if (!rows.length) throw new Error("ไม่มีรายการสินค้าในไฟล์");
  return rows;
}

export async function readReferenceFile(file: File): Promise<CountReferenceRow[]> {
  if (!/\.(xlsx|csv)$/i.test(file.name)) throw new Error("เลือกไฟล์ Excel (.xlsx) หรือ CSV");
  if (file.size > 2 * 1024 * 1024) throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 2 MB");
  const XLSX = await import("xlsx");
  const bytes = await file.arrayBuffer();
  const book = /\.csv$/i.test(file.name)
    ? XLSX.read(decodeCsv(bytes), { type: "string", raw: true, sheetRows: 10002 })
    : XLSX.read(bytes, { type: "array", sheetRows: 10002 });
  const manySheets = book.SheetNames.length > 1;
  let lastError = "ไม่พบข้อมูลในแผ่นงานแรก";
  let sawPreview = false;
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
    if (range.e.r > 10000 || range.e.c > 255) throw new Error("รองรับไม่เกิน 10,000 แถวข้อมูลและ 256 คอลัมน์");
    const table = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0, raw: false, defval: "" });
    const report = readWarehouseStockReport(table);
    if (report) return report;
    const header = findHeaderRow(table);
    if (header < 0) {
      const message = headerError(table, name, manySheets);
      if (!sawPreview) {
        lastError = message;
        sawPreview = message.includes("หัวที่พบ");
      }
      continue;
    }
    return readGenericRows(table, sheet, header, XLSX);
  }
  throw new Error(lastError);
}
