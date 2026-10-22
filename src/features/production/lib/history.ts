// แปลงประวัติการดำเนินการ (ProductionHistory.detail = JSON string) เป็นบรรทัด "หัวข้อ: ค่า" ภาษาไทย
// รูปแบบ detail ตามที่ production-job.service บันทึก:
//   CREATE {target_qty, table_no, sku} · EDIT {before, after} · DELETE {deleted_draft} ·
//   SUBMIT {table_no, target_qty} · START {started_by} · CANCEL {} · REOPEN {reopen_count} ·
//   REPORT_PARTIAL/REPORT_FINAL {report_no, good_qty, defect_qty, cumulative_good, cumulative_defect, target} ·
//   ADJUST {before:{good,defect}, after:{good,defect}, good_delta, defect_delta}
// key ที่ไม่รู้จัก/รูปแบบอื่น → แสดง JSON (raw) แทน ไม่ทิ้งข้อมูล
import { PRODUCTION_PRIORITY_LABELS, type ProductionPriority } from "@/types/production";

export const HISTORY_ACTION_LABELS: Record<string, string> = {
  CREATE: "สร้างงาน",
  BACKORDER: "สร้างงานค้างจากการผลิต",
  EDIT: "แก้ไขงาน",
  DELETE: "ลบฉบับร่าง",
  SUBMIT: "ส่งงานผลิต",
  START: "เริ่มผลิต",
  REPORT_PARTIAL: "รายงานบางส่วน",
  REPORT_FINAL: "รายงานและจบงาน",
  CANCEL: "ยกเลิกงาน",
  REOPEN: "เปิดงานผลิตต่อ",
  ADJUST: "ปรับปรุงยอดผลผลิต",
  // api-contract.md (NEW) — ระบบบันทึกต่อจากรายการที่ค้างหลังเซิร์ฟเวอร์ล้มกลางทาง
  REPORT_RECOVERY: "บันทึกต่อจากรายการค้าง (ระบบ)",
  ADJUST_RECOVERY: "ปรับสต็อกต่อจากรายการค้าง (ระบบ)",
};

export function historyActionLabel(action: string): string {
  return HISTORY_ACTION_LABELS[action] || action;
}

type FieldKind = "qty" | "delta" | "text" | "table" | "priority" | "count";

const FIELDS: Record<string, { label: string; kind: FieldKind }> = {
  target_qty: { label: "เป้าหมาย", kind: "qty" },
  target: { label: "เป้าหมาย", kind: "qty" },
  table_no: { label: "โต๊ะ", kind: "table" },
  sku: { label: "รหัสสินค้า", kind: "text" },
  product_id: { label: "สินค้า (รหัสภายใน)", kind: "text" },
  note: { label: "หมายเหตุ", kind: "text" },
  priority: { label: "ความสำคัญ", kind: "priority" },
  location: { label: "ตำแหน่งรับเข้า", kind: "text" },
  production_date: { label: "วันที่ผลิต", kind: "text" },
  started_by: { label: "ผู้เริ่มผลิต", kind: "text" },
  reopen_count: { label: "เปิดผลิตต่อครั้งที่", kind: "count" },
  report_no: { label: "รอบที่", kind: "count" },
  good_qty: { label: "ผลิตดีรอบนี้", kind: "qty" },
  defect_qty: { label: "ของเสียรอบนี้", kind: "qty" },
  cumulative_good: { label: "ดีสะสม", kind: "qty" },
  cumulative_defect: { label: "เสียสะสม", kind: "qty" },
  good_delta: { label: "ส่วนต่างผลิตดี", kind: "delta" },
  defect_delta: { label: "ส่วนต่างของเสีย", kind: "delta" },
  deleted_draft: { label: "ฉบับร่างที่ลบ", kind: "text" },
};

/** ลำดับแสดงผลของ key แก้ไขงาน */
const EDIT_ORDER = ["production_date", "product_id", "target_qty", "table_no", "priority", "note", "location"];

export interface HistoryDetailLine {
  label: string;
  value: string;
}

export interface FormattedHistoryDetail {
  lines: HistoryDetailLine[];
  /** JSON ของส่วนที่แปลงไม่ได้ (null = แปลงได้ครบ) */
  raw: string | null;
}

function fmtNumber(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function fmtValue(kind: FieldKind, v: unknown): string | null {
  if (v === null || v === undefined) return "-";
  switch (kind) {
    case "qty":
    case "count":
      return typeof v === "number" && Number.isFinite(v) ? fmtNumber(v) : null;
    case "delta":
      return typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${fmtNumber(v)}` : null;
    case "table":
      return typeof v === "number" || typeof v === "string" ? `โต๊ะ ${v}` : null;
    case "priority":
      return typeof v === "string" ? PRODUCTION_PRIORITY_LABELS[v as ProductionPriority] || v : null;
    case "text":
      if (typeof v === "string") return v.trim() === "" ? "(ว่าง)" : v;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function stringifySafe(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** แปลง detail เป็นบรรทัดอ่านง่าย — แปลงไม่ได้ทั้งหมด/บางส่วนจะคืน raw JSON ของส่วนนั้น */
export function formatHistoryDetail(action: string, detail: string | null | undefined): FormattedHistoryDetail {
  const text = (detail ?? "").trim();
  if (!text || text === "{}") return { lines: [], raw: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { lines: [], raw: text };
  }
  if (!isPlainObject(parsed)) return { lines: [], raw: text };

  const lines: HistoryDetailLine[] = [];
  const unknown: Record<string, unknown> = {};
  const rest: Record<string, unknown> = { ...parsed };

  // EDIT: { before: {...ทั้งหมด}, after: {...เฉพาะที่เปลี่ยน} } → "หัวข้อ: เดิม → ใหม่"
  if (action === "EDIT" && isPlainObject(rest.after)) {
    const before = isPlainObject(rest.before) ? rest.before : {};
    const after = rest.after;
    const keys = Object.keys(after).sort((a, b) => {
      const ia = EDIT_ORDER.indexOf(a);
      const ib = EDIT_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    for (const k of keys) {
      const f = FIELDS[k];
      const to = f ? fmtValue(f.kind, after[k]) : null;
      const from = f && k in before ? fmtValue(f.kind, before[k]) : null;
      if (!f || to === null) {
        unknown[`after.${k}`] = after[k];
        continue;
      }
      lines.push({ label: f.label, value: from !== null ? `${from} → ${to}` : to });
    }
    delete rest.before;
    delete rest.after;
  }

  // ADJUST: { before:{good,defect}, after:{good,defect}, ... } → "ผลิตดีสะสม: 980 → 975"
  if (action === "ADJUST" && isPlainObject(rest.before) && isPlainObject(rest.after)) {
    const b = rest.before;
    const a = rest.after;
    const pairs: [string, string][] = [
      ["good", "ผลิตดีสะสม"],
      ["defect", "ของเสียสะสม"],
    ];
    for (const [k, label] of pairs) {
      const from = fmtValue("qty", b[k]);
      const to = fmtValue("qty", a[k]);
      if (from !== null && to !== null && k in b && k in a) lines.push({ label, value: `${from} → ${to}` });
      else unknown[k] = { before: b[k], after: a[k] };
    }
    delete rest.before;
    delete rest.after;
  }

  for (const [k, v] of Object.entries(rest)) {
    const f = FIELDS[k];
    const value = f ? fmtValue(f.kind, v) : null;
    if (!f || value === null) {
      unknown[k] = v;
      continue;
    }
    lines.push({ label: f.label, value });
  }

  const raw = Object.keys(unknown).length > 0 ? stringifySafe(unknown) : null;
  return { lines, raw };
}
