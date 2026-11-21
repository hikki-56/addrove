import type { CountReportEntry } from "@/types/count-round";

const endpoint = "/api/stock-counts/rounds";

async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.message || "ติดต่อระบบตรวจนับไม่สำเร็จ");
  return body.data;
}

export async function getCount<T>(params: Record<string, string> = {}, signal?: AbortSignal) {
  return read<T>(await fetch(endpoint + "?" + new URLSearchParams(params), { cache: "no-store", signal }));
}

export async function sendCount<T>(body: Record<string, unknown>) {
  return read<T>(await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

function dateLabel(date: string) {
  return new Date(date).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "medium" });
}

export const countReportColumns: {
  label: string;
  width: number;
  value: (row: CountReportEntry, warehouseName: string) => string | number;
}[] = [
  { label: "โกดัง", width: 22, value: (_, warehouseName) => warehouseName },
  { label: "รหัสสินค้า", width: 20, value: row => row.sku },
  { label: "เลขบาร์โค้ด", width: 24, value: row => row.barcode ?? "" },
  { label: "ชื่อสินค้า", width: 45, value: row => row.product_name },
  { label: "จำนวนที่นับได้", width: 18, value: row => row.quantity },
  { label: "หน่วย", width: 12, value: row => row.base_unit },
  { label: "ผู้ตรวจนับ", width: 24, value: row => row.counter_name },
  { label: "เวลาบันทึก (ไทย)", width: 28, value: row => dateLabel(row.counted_at) },
];

export async function downloadCounts(entries: CountReportEntry[], warehouseName: string, date: string) {
  const XLSX = await import("xlsx");
  const data = [countReportColumns.map(column => column.label),
    ...entries.map(row => countReportColumns.map(column => column.value(row, warehouseName)))];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = countReportColumns.map(column => ({ wch: column.width }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "ผลตรวจนับ");
  XLSX.writeFile(workbook, `ตรวจนับ-${warehouseName}-${date}.xlsx`);
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "ติดต่อระบบตรวจนับไม่สำเร็จ กรุณาลองอีกครั้ง";
}
