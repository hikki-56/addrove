import type { RoundReport } from "@/types/count-round";

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

export function dateLabel(date: string) {
  return new Date(date).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "medium" });
}

export async function downloadRound(report: RoundReport, warehouseName: string) {
  const XLSX = await import("xlsx");
  const data = [["โกดัง", "ชั้น", "รหัสสินค้า", "ชื่อสินค้า", "จำนวนที่นับได้", "หน่วย", "ผู้ตรวจนับ", "เวลาบันทึก (ไทย)", "เลขบาร์โค้ด"],
    ...report.entries.map(row => [warehouseName, row.shelf_code, row.sku, row.product_name, row.quantity, row.base_unit, row.counter_name, dateLabel(row.counted_at), row.barcode])];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [22,18,20,45,18,12,24,28,24].map(wch => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "ผลตรวจนับ");
  XLSX.writeFile(workbook, `ตรวจนับ-${warehouseName}-${report.round.round_id}.xlsx`);
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "ติดต่อระบบตรวจนับไม่สำเร็จ กรุณาลองอีกครั้ง";
}
