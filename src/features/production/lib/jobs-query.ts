// query string ของ GET /api/production/jobs — เซิร์ฟเวอร์รองรับ date_from, date_to, table_no, status, q
// (q ยังกรองฝั่ง client เพื่อไม่ยิง API ทุกครั้งที่พิมพ์)

export interface ProductionJobsQuery {
  /** YYYY-MM-DD (รวมวันนั้น) */
  date_from?: string;
  /** YYYY-MM-DD (รวมวันนั้น) */
  date_to?: string;
  table_no?: number | "ALL";
  status?: string;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** คืน "" เมื่อไม่มีตัวกรอง หรือ "?a=b&..." · ข้ามค่าว่าง/"ALL"/รูปแบบไม่ถูกต้อง */
export function buildJobsQueryString(query: ProductionJobsQuery): string {
  const params = new URLSearchParams();
  if (query.date_from && YMD_RE.test(query.date_from)) params.set("date_from", query.date_from);
  if (query.date_to && YMD_RE.test(query.date_to)) params.set("date_to", query.date_to);
  if (typeof query.table_no === "number" && Number.isInteger(query.table_no) && query.table_no > 0) {
    params.set("table_no", String(query.table_no));
  }
  if (query.status && query.status !== "ALL") params.set("status", query.status);
  const s = params.toString();
  return s ? `?${s}` : "";
}
