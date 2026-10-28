// ชนิดข้อมูล + ตัวช่วยร่วมของหน้า "ระบุตำแหน่งสินค้า" และ "คำขอระบุตำแหน่ง" (เฉพาะฝั่งแสดงผล)
export type ReqStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export type AssignReq = {
  request_id: string;
  batch_id: string;
  warehouse_id: string;
  warehouse_name?: string;
  product_id: string;
  sku?: string;
  barcode?: string;
  product_name?: string;
  location_id?: string;
  location_code: string;
  target_qty: number;
  qty_at_request: number;
  current_qty?: number;
  status: ReqStatus;
  note: string;
  requested_by: string;
  requested_by_name?: string;
  requested_at: string;
  decided_by_name?: string | null;
  decided_at: string | null;
  decision_note?: string;
  qty_at_decision: number | null;
  edit_count?: number;
};

export type AssignEdit = {
  edit_id: string;
  request_id: string;
  edited_by_name?: string;
  edited_at: string;
  old_target_qty: number;
  new_target_qty: number;
  old_note: string;
  new_note: string;
  old_location_code: string;
  new_location_code: string;
};

/** 1 กลุ่ม = 1 การย้าย (batch + โกดัง + สินค้า) */
export type ReqGroup = {
  key: string;
  batch_id: string;
  lines: AssignReq[];
  head: AssignReq;
  status: ReqStatus | "MIXED";
  edited: boolean;
};

export const STATUS_LABEL: Record<ReqStatus | "MIXED", string> = {
  PENDING: "รออนุมัติ",
  APPROVED: "อนุมัติแล้ว",
  REJECTED: "ปฏิเสธ",
  CANCELLED: "ยกเลิก",
  MIXED: "อนุมัติบางส่วน",
};

export const STATUS_TONE: Record<ReqStatus | "MIXED", string> = {
  PENDING: "m3-label-warning",
  APPROVED: "m3-label-success",
  REJECTED: "m3-label-error",
  CANCELLED: "m3-label-default",
  MIXED: "m3-label-info",
};

export const fmt = (n?: number | null) => (n == null ? "-" : Number(n).toLocaleString());
export const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(Math.abs(n))}` : "0");
export const locLabel = (code?: string | null) => (code && code.trim() ? code : "ไม่ระบุ");

export const when = (s?: string | null) =>
  s
    ? new Date(s).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }) + " น."
    : "-";

/** ยอดก่อน: รออนุมัติ = ยอดปัจจุบัน (สด), ปิดแล้ว = ยอด ณ ตอนตัดสิน */
export const beforeQty = (r: AssignReq) =>
  r.status === "PENDING" ? r.current_qty ?? r.qty_at_request : r.qty_at_decision ?? r.qty_at_request;
export const lineDelta = (r: AssignReq) => r.target_qty - (beforeQty(r) ?? 0);
/** ยอด ณ ตอนขอเปลี่ยนไปแล้ว (มีการเคลื่อนไหวระหว่างรออนุมัติ) */
export const driftedSinceRequest = (r: AssignReq) => r.status === "PENDING" && (r.current_qty ?? r.qty_at_request) !== r.qty_at_request;

export function groupRequests(rows: AssignReq[]): ReqGroup[] {
  const m = new Map<string, AssignReq[]>();
  for (const r of rows) {
    const k = `${r.batch_id}|${r.warehouse_id}|${r.product_id}`;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return [...m.entries()].map(([key, lines]) => {
    const st = new Set(lines.map((l) => l.status));
    // แถวลด (ต้นทาง) ก่อน แล้วแถวเพิ่ม (ปลายทาง)
    const sorted = [...lines].sort((a, b) => lineDelta(a) - lineDelta(b) || a.location_code.localeCompare(b.location_code));
    return {
      key,
      batch_id: lines[0].batch_id,
      lines: sorted,
      head: lines[0],
      status: st.size === 1 ? lines[0].status : "MIXED",
      edited: lines.some((l) => (l.edit_count ?? 0) > 0),
    };
  });
}

/** จำนวนที่ย้าย = ผลรวมส่วนที่เพิ่ม (ฝั่งปลายทาง) */
export const movedQty = (g: ReqGroup) => g.lines.reduce((a, l) => a + Math.max(lineDelta(l), 0), 0);

export const REQUESTS_API = "/api/movements/assign-location/requests";
export const batchApi = (batch: string, action = "") =>
  `${REQUESTS_API}/batch/${encodeURIComponent(batch)}${action ? `/${action}` : ""}`;
