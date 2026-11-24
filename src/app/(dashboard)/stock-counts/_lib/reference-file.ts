import type { CountReferenceRow } from "@/types/count-round";
import { readWarehouseStockReport } from "./warehouse-stock-report";

function decodeCsv(bytes: ArrayBuffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-874").decode(bytes); }
}

export async function readReferenceFile(file: File): Promise<CountReferenceRow[]> {
  if (!/\.(xlsx|csv)$/i.test(file.name)) throw new Error("เลือกไฟล์ Excel (.xlsx) หรือ CSV");
  if (file.size > 2 * 1024 * 1024) throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 2 MB");
  const XLSX = await import("xlsx");
  const bytes = await file.arrayBuffer();
  const book = /\.csv$/i.test(file.name)
    ? XLSX.read(decodeCsv(bytes), { type: "string", raw: true, sheetRows: 10002 })
    : XLSX.read(bytes, { type: "array", sheetRows: 10002 });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet?.["!ref"]) throw new Error("ไม่พบข้อมูลในแผ่นงานแรก");
  const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
  if (range.e.r > 10000 || range.e.c > 255) throw new Error("รองรับไม่เกิน 10,000 แถวข้อมูลและ 256 คอลัมน์");
  const table = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0, raw: false, defval: "" });
  const report = readWarehouseStockReport(table);
  if (report) return report;
  const headers = (table[0] ?? []).map(v => v.trim().toLowerCase());
  const column = (...names: string[]) => headers.findIndex(v => names.includes(v));
  const sku = column("รหัสสินค้า", "sku");
  const barcode = column("บาร์โค้ด", "เลขบาร์โค้ด", "barcode");
  const shelf = column("ชั้น", "ชั้นวาง", "รหัสชั้น", "ตำแหน่ง", "shelf", "shelf_code");
  const qty = column("จำนวน", "จำนวนตามไฟล์", "จำนวนคงเหลือ", "ยอดคงเหลือ", "จำนวนที่นับได้", "qty", "quantity", "expected_qty");
  const warehouse = column("โกดัง", "คลังสินค้า", "warehouse", "warehouse_id");
  if ((sku < 0 && barcode < 0) || qty < 0) throw new Error("กรุณาใส่หัวคอลัมน์ รหัสสินค้า (หรือบาร์โค้ด) และจำนวน ในแถวแรก");
  const rows: CountReferenceRow[] = [];
  for (let i = 1; i < table.length; i++) {
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
