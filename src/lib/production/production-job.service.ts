// Service หลักระบบสั่งผลิตและรายงานผลผลิต (v2)
// หนึ่งงาน = หนึ่งใบสั่งผลิต (สินค้า 1 ชนิด × โต๊ะ 1–5) เลขใบ PRD-YYYYMMDD-NNNNNN
//
// หลักความถูกต้อง:
// - ยอดสะสมคำนวณจากแท็บรายงานทุกครั้ง (append-only) — ไม่ denormalize ลงแถวงาน
// - ทุก mutation ครอบ withKeyedLock ต่องาน + เขียนประวัติทุกครั้ง
// - รายงานผลกันกดยืนยันซ้ำด้วย idempotency_key (ทั้งในแถวรายงานและ movement สต็อก)
// - state machine บังคับฝั่งเซิร์ฟเวอร์ล้วน:
//   DRAFT→WAITING→IN_PROGRESS→COMPLETED · →CANCELLED (ก่อนจบ) · COMPLETED→IN_PROGRESS (เปิดใหม่)

import {
  readSheet,
  appendRows,
  updateRow,
  batchUpdateRows,
  deleteRows,
  clearSheetCache,
  ensureSheetTabExists,
  SHEETS,
} from "@/lib/google-sheets/client";
import { withKeyedLock } from "@/lib/keyed-lock";
import { withStockLocks, formatStockLockKey } from "@/lib/locking";
import { executeAtomicOperation } from "@/lib/services/stock/atomic-stock-executor";
import { getRepository } from "@/lib/repositories";
import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Document } from "@/types/models";
import type {
  ProductionJob,
  ProductionJobStatus,
  ProductionPriority,
  ProductionReport,
  ProductionHistoryEntry,
  ProductionNotification,
} from "@/types/production";
import {
  PRODUCTION_JOBS_SHEET_HEADERS,
  PRODUCTION_REPORTS_SHEET_HEADERS,
  PRODUCTION_HISTORY_SHEET_HEADERS,
  PRODUCTION_NOTIFS_SHEET_HEADERS,
  PRODUCTION_JOB_STATUS_LABELS,
  PRODUCTION_PRIORITY_LABELS,
} from "@/types/production";
import type {
  CreateProductionJobInput,
  UpdateProductionJobInput,
  ReportProductionInput,
  AdjustProductionInput,
} from "@/lib/production/production-schemas";
import {
  postReportStockToWh2,
  postAdjustStockToWh2,
  PRODUCTION_RECEIVE_WAREHOUSE,
} from "@/lib/production/production-stock.service";

// ---- Error ประจำโมดูล ----

export class ProductionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409 = 400
  ) {
    super(message);
    this.name = "ProductionError";
  }
}

// ---- helpers ----

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: string | number | undefined): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function str(v: string | number | undefined): string {
  return v === undefined || v === null ? "" : String(v);
}

/** วันที่ปัจจุบัน (YYYY-MM-DD) ตามเวลาไทย — ใช้กับเลขใบสั่งผลิต */
export function bangkokToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const PRIORITY_WEIGHT: Record<ProductionPriority, number> = { CRITICAL: 3, URGENT: 2, NORMAL: 1 };

export async function ensureProductionSheets(): Promise<void> {
  await ensureSheetTabExists(SHEETS.PRODUCTION_JOBS, [...PRODUCTION_JOBS_SHEET_HEADERS]);
  await ensureSheetTabExists(SHEETS.PRODUCTION_REPORTS, [...PRODUCTION_REPORTS_SHEET_HEADERS]);
  await ensureSheetTabExists(SHEETS.PRODUCTION_HISTORY, [...PRODUCTION_HISTORY_SHEET_HEADERS]);
  await ensureSheetTabExists(SHEETS.PRODUCTION_NOTIFS, [...PRODUCTION_NOTIFS_SHEET_HEADERS]);
}

// ---- row mapping (index = ตำแหน่งคอลัมน์ตาม header ห้ามสลับ) ----

function jobRowToPartial(row: string[]): Omit<ProductionJob, "produced_good" | "defect_total" | "remaining_qty" | "over_qty" | "report_count"> {
  return {
    job_id: str(row[0]),
    job_no: str(row[1]),
    production_date: str(row[2]).slice(0, 10),
    status: (str(row[3]).trim().toUpperCase() || "DRAFT") as ProductionJobStatus,
    table_no: Math.round(num(row[4])) || 1,
    priority: (str(row[5]).trim().toUpperCase() || "NORMAL") as ProductionPriority,
    product_id: str(row[6]),
    sku: str(row[7]),
    product_name: str(row[8]),
    unit: str(row[9]) || "ชิ้น",
    target_qty: round2(num(row[10])),
    note: str(row[11]),
    location: str(row[12]),
    created_by: str(row[13]),
    created_by_name: str(row[14]),
    created_at: str(row[15]),
    submitted_at: str(row[16]),
    started_by_name: str(row[17]),
    started_at: str(row[18]),
    completed_at: str(row[19]),
    cancelled_at: str(row[20]),
    cancelled_by_name: str(row[21]),
    cancel_reason: str(row[22]),
    close_reason: str(row[23]),
    reopen_reason: str(row[24]),
    reopen_count: Math.round(num(row[25])),
    updated_at: str(row[26]),
  };
}

function jobToRow(job: ProductionJob | (Omit<ProductionJob, "produced_good" | "defect_total" | "remaining_qty" | "over_qty" | "report_count"> & Partial<ProductionJob>)): (string | number)[] {
  return [
    job.job_id,
    job.job_no,
    job.production_date,
    job.status,
    job.table_no,
    job.priority,
    job.product_id,
    job.sku,
    job.product_name,
    job.unit,
    job.target_qty,
    job.note,
    job.location,
    job.created_by,
    job.created_by_name,
    job.created_at,
    job.submitted_at,
    job.started_by_name,
    job.started_at,
    job.completed_at,
    job.cancelled_at,
    job.cancelled_by_name,
    job.cancel_reason,
    job.close_reason,
    job.reopen_reason,
    job.reopen_count,
    job.updated_at,
  ];
}

function reportRowToReport(row: string[]): ProductionReport {
  return {
    report_id: str(row[0]),
    job_no: str(row[1]),
    report_no: Math.round(num(row[2])) || 0,
    kind: (str(row[3]).trim().toUpperCase() || "REPORT") as ProductionReport["kind"],
    report_kind: str(row[4]).trim().toUpperCase() as ProductionReport["report_kind"],
    good_qty: round2(num(row[5])),
    defect_qty: round2(num(row[6])),
    defect_cause: str(row[7]),
    reason: str(row[8]),
    note: str(row[9]),
    photo_url: str(row[10]),
    reported_by: str(row[11]),
    reported_by_name: str(row[12]),
    reported_at: str(row[13]),
    cumulative_good: round2(num(row[14])),
    cumulative_defect: round2(num(row[15])),
    idempotency_key: str(row[16]),
  };
}

function reportToRow(r: ProductionReport): (string | number)[] {
  return [
    r.report_id,
    r.job_no,
    r.report_no,
    r.kind,
    r.report_kind,
    r.good_qty,
    r.defect_qty,
    r.defect_cause,
    r.reason,
    r.note,
    r.photo_url,
    r.reported_by,
    r.reported_by_name,
    r.reported_at,
    r.cumulative_good,
    r.cumulative_defect,
    r.idempotency_key,
  ];
}

// ---- อ่านข้อมูล ----

async function readJobRows(forceFresh = false): Promise<string[][]> {
  return readSheet(SHEETS.PRODUCTION_JOBS, "A2:AA", forceFresh ? { forceFresh: true } : undefined).catch(() => []);
}

async function readReportRows(forceFresh = false): Promise<string[][]> {
  return readSheet(SHEETS.PRODUCTION_REPORTS, "A2:Q", forceFresh ? { forceFresh: true } : undefined).catch(() => []);
}

export interface JobProgress {
  produced_good: number;
  defect_total: number;
  remaining_qty: number;
  over_qty: number;
  report_count: number;
}

export function computeProgress(target: number, reports: Pick<ProductionReport, "kind" | "good_qty" | "defect_qty">[]): JobProgress {
  let good = 0;
  let defect = 0;
  for (const r of reports) {
    good += r.good_qty;
    defect += r.defect_qty;
  }
  good = round2(good);
  defect = round2(defect);
  return {
    produced_good: good,
    defect_total: defect,
    remaining_qty: round2(Math.max(0, target - good)),
    over_qty: round2(Math.max(0, good - target)),
    report_count: reports.length,
  };
}

export interface ListJobsFilters {
  date_from?: string;
  date_to?: string;
  table_no?: number;
  status?: string;
  q?: string;
}

/** เติมบาร์โค้ดจากทะเบียนสินค้าหลักให้งานที่อ่านขึ้นมา (ไม่เก็บในแท็บงานผลิต — แถวเก่าก็ได้บาร์โค้ด) */
async function attachBarcodes(jobs: ProductionJob[]): Promise<void> {
  if (jobs.length === 0) return;
  try {
    const repo = getRepository();
    const products = await repo.products.findAll({ activeOnly: false });
    const barcodeBySku = new Map<string, string>();
    for (const p of products) {
      const key = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
      const barcode = (p.barcode || "").trim();
      if (key && barcode && barcode !== "-" && !barcodeBySku.has(key)) {
        barcodeBySku.set(key, barcode);
      }
    }
    for (const j of jobs) {
      if (!j.barcode) {
        j.barcode = barcodeBySku.get(j.sku.trim().toLowerCase().replace(/^prod-/, "")) || "";
      }
    }
  } catch (err) {
    console.warn("[Production] attachBarcodes warning:", err);
  }
}

export async function listJobs(filters: ListJobsFilters = {}): Promise<ProductionJob[]> {
  const [jobRows, reportRows] = await Promise.all([readJobRows(true), readReportRows(true)]);
  const reportsByJob = new Map<string, ProductionReport[]>();
  for (const row of reportRows) {
    if (!row || !row[1]) continue;
    const key = str(row[1]).trim().toLowerCase();
    const list = reportsByJob.get(key) || [];
    list.push(reportRowToReport(row));
    reportsByJob.set(key, list);
  }

  const jobs: ProductionJob[] = [];
  for (const row of jobRows) {
    if (!row || !row[1]) continue;
    const base = jobRowToPartial(row);
    const reports = reportsByJob.get(base.job_no.toLowerCase()) || [];
    jobs.push({ ...base, barcode: "", ...computeProgress(base.target_qty, reports) });
  }

  // เติมบาร์โค้ดก่อนกรอง — ให้ค้นหาด้วยบาร์โค้ด/4 ตัวท้ายทำงานได้ด้วย
  await attachBarcodes(jobs);

  const q = (filters.q || "").trim().toLowerCase();
  const filtered = jobs.filter((j) => {
    if (filters.date_from && j.production_date < filters.date_from) return false;
    if (filters.date_to && j.production_date > filters.date_to) return false;
    if (filters.table_no && j.table_no !== filters.table_no) return false;
    if (filters.status && filters.status !== "ALL" && j.status !== filters.status) return false;
    if (q) {
      const hay = `${j.job_no} ${j.sku} ${j.product_name} ${j.barcode}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (a.production_date !== b.production_date) return a.production_date < b.production_date ? 1 : -1;
    if (a.table_no !== b.table_no) return a.table_no - b.table_no;
    const pw = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (pw !== 0) return pw;
    return a.job_no < b.job_no ? -1 : 1;
  });

  return filtered;
}

export async function getJobDetail(
  jobNo: string
): Promise<{ job: ProductionJob; reports: ProductionReport[]; history: ProductionHistoryEntry[] } | null> {
  const key = jobNo.trim().toLowerCase();
  const [jobRows, reportRows, historyRows] = await Promise.all([
    readJobRows(true),
    readReportRows(true),
    readSheet(SHEETS.PRODUCTION_HISTORY, "A2:H", { forceFresh: true }).catch(() => []),
  ]);

  const jobRow = jobRows.find((r) => r && str(r[1]).trim().toLowerCase() === key);
  if (!jobRow) return null;
  const base = jobRowToPartial(jobRow);

  const reports = reportRows
    .filter((r) => r && str(r[1]).trim().toLowerCase() === key)
    .map(reportRowToReport)
    .sort((a, b) => a.report_no - b.report_no);

  const history: ProductionHistoryEntry[] = historyRows
    .filter((r) => r && str(r[1]).trim().toLowerCase() === key)
    .map((r) => ({
      history_id: str(r[0]),
      job_no: str(r[1]),
      action: str(r[2]),
      actor_id: str(r[3]),
      actor_name: str(r[4]),
      at: str(r[5]),
      reason: str(r[6]),
      detail: str(r[7]),
    }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const detail: { job: ProductionJob; reports: ProductionReport[]; history: ProductionHistoryEntry[] } = {
    job: { ...base, barcode: "", ...computeProgress(base.target_qty, reports) },
    reports,
    history,
  };
  await attachBarcodes([detail.job]);
  return detail;
}

// ---- เขียนประวัติ + แจ้งเตือน ----

async function appendHistory(
  jobNo: string,
  action: string,
  actor: ProductionActor,
  reason: string,
  detail: Record<string, unknown>
): Promise<void> {
  await appendRows(SHEETS.PRODUCTION_HISTORY, [
    [`prh-${crypto.randomUUID()}`, jobNo, action, actor.id, actor.name, new Date().toISOString(), reason, JSON.stringify(detail)],
  ]).catch((err) => console.warn("[Production] history append warning:", err));
}

async function notify(
  targetRole: "ADMIN" | "APPROVER",
  job: Pick<ProductionJob, "job_no">,
  message: string,
  byName: string
): Promise<void> {
  await appendRows(SHEETS.PRODUCTION_NOTIFS, [
    [`prn-${crypto.randomUUID()}`, targetRole, job.job_no, message, new Date().toISOString(), byName, "[]"],
  ]).catch((err) => console.warn("[Production] notification append warning:", err));
}

export interface ProductionActor {
  id: string;
  name: string;
  role: string;
}

function jobLine(j: Pick<ProductionJob, "job_no" | "table_no" | "product_name" | "sku">): string {
  return `${j.job_no} · โต๊ะ ${j.table_no} · ${j.product_name} (${j.sku})`;
}

// ---- state machine ----

const JOB_TRANSITIONS: Record<ProductionJobStatus, ProductionJobStatus[]> = {
  DRAFT: ["WAITING", "CANCELLED"],
  WAITING: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: ["IN_PROGRESS"], // เปิดกลับมาผลิตต่อ
  CANCELLED: [],
};

function assertTransition(from: ProductionJobStatus, to: ProductionJobStatus): void {
  if (!JOB_TRANSITIONS[from]?.includes(to)) {
    throw new ProductionError(
      `เปลี่ยนสถานะงานจาก ${PRODUCTION_JOB_STATUS_LABELS[from]} เป็น ${PRODUCTION_JOB_STATUS_LABELS[to]} ไม่ได้`,
      409
    );
  }
}

// ---- สร้าง / แก้ไข / ลบ (ฉบับร่าง) ----

async function resolveProductInfo(repo: IStockRepository, productId: string) {
  const clean = productId.replace(/^prod-/, "").trim();
  const product =
    (await repo.products.findById(productId).catch(() => null)) ||
    (await repo.products.findBySku(clean).catch(() => null)) ||
    (await repo.products.findById(`prod-${clean}`).catch(() => null));
  if (!product) {
    throw new ProductionError(`ไม่พบสินค้ารหัส ${clean} ในระบบ — เลือกจากรายการสินค้าที่มีอยู่จริงเท่านั้น`, 400);
  }
  return {
    product_id: product.product_id,
    sku: product.sku || clean,
    barcode: product.barcode && product.barcode !== "-" ? product.barcode : "",
    product_name: product.product_name || clean,
    unit: product.base_unit || "ชิ้น",
  };
}

async function generateJobNo(repo: IStockRepository, productionDate: string): Promise<string> {
  return withKeyedLock(`prd-jobno:${productionDate}`, async () => {
    await ensureProductionSheets();
    const rows = await readJobRows(true);
    const prefix = `PRD-${productionDate.replace(/-/g, "")}-`;
    let max = 0;
    for (const r of rows) {
      const no = str(r && r[1]);
      if (no.startsWith(prefix)) {
        const seq = parseInt(no.slice(prefix.length), 10);
        if (Number.isFinite(seq) && seq > max) max = seq;
      }
    }
    return `${prefix}${String(max + 1).padStart(6, "0")}`;
  });
}

export async function createJobs(
  actor: ProductionActor,
  inputs: CreateProductionJobInput[]
): Promise<ProductionJob[]> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new ProductionError("กรุณาระบุรายการงานอย่างน้อย 1 งาน");
  }
  const repo = getRepository();
  await ensureProductionSheets();
  const nowIso = new Date().toISOString();

  const created: ProductionJob[] = [];
  for (const input of inputs) {
    const info = await resolveProductInfo(repo, input.product_id);
    const jobNo = await generateJobNo(repo, input.production_date);
    const job: ProductionJob = {
      job_id: `prj-${crypto.randomUUID()}`,
      job_no: jobNo,
      production_date: input.production_date,
      status: "DRAFT",
      table_no: input.table_no,
      priority: input.priority,
      product_id: info.product_id,
      sku: info.sku,
      barcode: info.barcode,
      product_name: info.product_name,
      unit: info.unit,
      target_qty: round2(input.target_qty),
      note: input.note || "",
      location: input.location || "",
      created_by: actor.id,
      created_by_name: actor.name,
      created_at: nowIso,
      submitted_at: "",
      started_by_name: "",
      started_at: "",
      completed_at: "",
      cancelled_at: "",
      cancelled_by_name: "",
      cancel_reason: "",
      close_reason: "",
      reopen_reason: "",
      reopen_count: 0,
      updated_at: nowIso,
      produced_good: 0,
      defect_total: 0,
      remaining_qty: round2(input.target_qty),
      over_qty: 0,
      report_count: 0,
    };
    await appendRows(SHEETS.PRODUCTION_JOBS, [jobToRow(job)]);
    await appendHistory(jobNo, "CREATE", actor, "", { target_qty: job.target_qty, table_no: job.table_no, sku: job.sku });
    created.push(job);
  }
  clearSheetCache(SHEETS.PRODUCTION_JOBS);
  return created;
}

/** หาแถวงาน (index ใน A2:AA) พร้อมข้อมูล — ทุก mutation ต้องเรียกภายใต้ล็อกของงานนั้น */
async function loadJobRow(jobNo: string): Promise<{ index: number; base: ReturnType<typeof jobRowToPartial> }> {
  const rows = await readJobRows(true);
  const idx = rows.findIndex((r) => r && str(r[1]).trim().toLowerCase() === jobNo.trim().toLowerCase());
  if (idx === -1) throw new ProductionError(`ไม่พบใบสั่งผลิต ${jobNo}`, 404);
  return { index: idx, base: jobRowToPartial(rows[idx]) };
}

async function writeJobRow(index: number, base: ReturnType<typeof jobRowToPartial>): Promise<void> {
  await updateRow(SHEETS.PRODUCTION_JOBS, index + 2, jobToRow(base));
  clearSheetCache(SHEETS.PRODUCTION_JOBS);
}

export async function updateJob(
  actor: ProductionActor,
  jobNo: string,
  patch: UpdateProductionJobInput
): Promise<ProductionJob> {
  return withKeyedLock(`prd-job:${jobNo.trim().toLowerCase()}`, async () => {
    const { index, base } = await loadJobRow(jobNo);

    // optimistic concurrency — กันข้อมูลใหม่ถูกข้อมูลเก่าเขียนทับ
    if (!patch.updated_at || patch.updated_at !== base.updated_at) {
      throw new ProductionError("ข้อมูลงานถูกแก้ไขโดยผู้อื่นไปก่อนแล้ว กรุณารีเฟรชแล้วลองใหม่", 409);
    }

    const before = { product_id: base.product_id, target_qty: base.target_qty, table_no: base.table_no, note: base.note, priority: base.priority, location: base.location, production_date: base.production_date };
    const repo = getRepository();
    const nowIso = new Date().toISOString();
    const changes: Record<string, unknown> = {};
    const notifyApprover = base.status === "WAITING" || base.status === "IN_PROGRESS";

    if (base.status === "DRAFT") {
      // ฉบับร่าง: แก้ได้ทุกอย่าง ไม่ต้องมีเหตุผล
      if (patch.production_date && patch.production_date !== base.production_date) {
        base.production_date = patch.production_date;
        changes.production_date = patch.production_date;
      }
      if (patch.product_id && patch.product_id !== base.product_id) {
        const info = await resolveProductInfo(repo, patch.product_id);
        Object.assign(base, info);
        changes.product = info;
      }
      if (patch.target_qty !== undefined && round2(patch.target_qty) !== base.target_qty) {
        base.target_qty = round2(patch.target_qty);
        changes.target_qty = base.target_qty;
      }
      if (patch.table_no !== undefined && patch.table_no !== base.table_no) {
        base.table_no = patch.table_no;
        changes.table_no = base.table_no;
      }
      if (patch.priority && patch.priority !== base.priority) {
        base.priority = patch.priority;
        changes.priority = base.priority;
      }
      if (patch.note !== undefined && patch.note !== base.note) {
        base.note = patch.note;
        changes.note = base.note;
      }
      if (patch.location !== undefined && patch.location !== base.location) {
        base.location = patch.location;
        changes.location = base.location;
      }
    } else if (base.status === "WAITING") {
      // ส่งงานแล้วแต่ยังไม่เริ่ม: แก้สินค้า จำนวน โต๊ะ (และข้อมูลแผน) ได้ + แจ้ง APPROVER + ต้องมีเหตุผล
      if (!patch.reason || !patch.reason.trim()) {
        throw new ProductionError("การแก้ไขงานที่ส่งแล้วต้องระบุเหตุผล", 400);
      }
      if (patch.production_date) {
        throw new ProductionError("งานที่ส่งแล้วไม่สามารถเปลี่ยนวันที่ผลิตได้ — ยกเลิกแล้วสร้างงานใหม่แทน", 400);
      }
      if (patch.product_id && patch.product_id !== base.product_id) {
        const info = await resolveProductInfo(repo, patch.product_id);
        Object.assign(base, info);
        changes.product = info;
      }
      if (patch.target_qty !== undefined && round2(patch.target_qty) !== base.target_qty) {
        base.target_qty = round2(patch.target_qty);
        changes.target_qty = base.target_qty;
      }
      if (patch.table_no !== undefined && patch.table_no !== base.table_no) {
        base.table_no = patch.table_no;
        changes.table_no = base.table_no;
      }
      if (patch.priority && patch.priority !== base.priority) {
        base.priority = patch.priority;
        changes.priority = base.priority;
      }
      if (patch.note !== undefined && patch.note !== base.note) {
        base.note = patch.note;
        changes.note = base.note;
      }
    } else if (base.status === "IN_PROGRESS") {
      // เริ่มผลิตแล้ว: แก้ได้เฉพาะเป้าหมายและหมายเหตุ + เหตุผล + แจ้ง APPROVER
      if (!patch.reason || !patch.reason.trim()) {
        throw new ProductionError("การแก้ไขงานที่กำลังผลิตต้องระบุเหตุผล", 400);
      }
      const allowed = ["updated_at", "reason", "target_qty", "note"] as const;
      for (const k of Object.keys(patch) as (keyof UpdateProductionJobInput)[]) {
        if (!allowed.includes(k as (typeof allowed)[number]) && patch[k] !== undefined && k !== "updated_at" && k !== "reason") {
          throw new ProductionError(
            `งานที่กำลังผลิตแก้ได้เฉพาะเป้าหมายและหมายเหตุเท่านั้น (ไม่สามารถแก้ ${String(k)}) — หากต้องการเปลี่ยนสินค้าหรือย้ายโต๊ะ ให้ยกเลิกส่วนที่เหลือแล้วสร้างงานใหม่`,
            400
          );
        }
      }
      if (patch.target_qty !== undefined && round2(patch.target_qty) !== base.target_qty) {
        base.target_qty = round2(patch.target_qty);
        changes.target_qty = base.target_qty;
      }
      if (patch.note !== undefined && patch.note !== base.note) {
        base.note = patch.note;
        changes.note = base.note;
      }
    } else {
      throw new ProductionError(
        `งานสถานะ ${PRODUCTION_JOB_STATUS_LABELS[base.status]} แก้ไขไม่ได้ — ใช้การเปิดงานผลิตต่อ (ถ้าจบแล้ว) หรือสร้างงานใหม่`,
        409
      );
    }

    if (Object.keys(changes).length === 0) {
      throw new ProductionError("ไม่มีข้อมูลที่ต้องแก้ไข", 400);
    }

    base.updated_at = nowIso;
    await writeJobRow(index, base);
    await appendHistory(base.job_no, "EDIT", actor, patch.reason || "", { before, after: changes });

    if (notifyApprover) {
      await notify("APPROVER", base, `✏️ แก้ไขงาน ${jobLine(base)} — ${patch.reason}`, actor.name);
    }

    const detail = await getJobDetail(base.job_no);
    return detail!.job;
  });
}

export async function deleteDraft(actor: ProductionActor, jobNo: string): Promise<void> {
  await withKeyedLock(`prd-job:${jobNo.trim().toLowerCase()}`, async () => {
    const rows = await readJobRows(true);
    const idx = rows.findIndex((r) => r && str(r[1]).trim().toLowerCase() === jobNo.trim().toLowerCase());
    if (idx === -1) throw new ProductionError(`ไม่พบใบสั่งผลิต ${jobNo}`, 404);
    const base = jobRowToPartial(rows[idx]);
    if (base.status !== "DRAFT") {
      throw new ProductionError("ลบได้เฉพาะงานฉบับร่างเท่านั้น — งานที่ส่งแล้วให้ใช้การยกเลิก", 409);
    }
    await deleteRows(SHEETS.PRODUCTION_JOBS, [idx]);
    clearSheetCache(SHEETS.PRODUCTION_JOBS);
    await appendHistory(base.job_no, "DELETE", actor, "", { deleted_draft: base.job_no });
  });
}

// ---- ส่งงาน / เริ่มผลิต ----

export async function submitJobs(
  actor: ProductionActor,
  jobNos: string[]
): Promise<{ submitted: ProductionJob[]; skipped: { job_no: string; reason: string }[] }> {
  await ensureProductionSheets();
  const submitted: ProductionJob[] = [];
  const skipped: { job_no: string; reason: string }[] = [];
  const nowIso = new Date().toISOString();

  for (const jobNo of jobNos) {
    const job = await withKeyedLock(`prd-job:${jobNo.trim().toLowerCase()}`, async () => {
      const { index, base } = await loadJobRow(jobNo);
      if (base.status !== "DRAFT") {
        skipped.push({ job_no: base.job_no, reason: `สถานะเป็น ${PRODUCTION_JOB_STATUS_LABELS[base.status]} อยู่แล้ว` });
        return null;
      }
      assertTransition(base.status, "WAITING");
      base.status = "WAITING";
      base.submitted_at = nowIso;
      base.updated_at = nowIso;
      await writeJobRow(index, base);
      await appendHistory(base.job_no, "SUBMIT", actor, "", { table_no: base.table_no, target_qty: base.target_qty });
      await notify("APPROVER", base, `📤 ส่งงานผลิตใหม่ ${jobLine(base)} — เป้าหมาย ${base.target_qty} ${base.unit}`, actor.name);
      return base;
    });
    if (job) submitted.push(job as ProductionJob);
  }

  return { submitted, skipped };
}

export async function startJob(actor: ProductionActor, jobNo: string): Promise<ProductionJob> {
  return withKeyedLock(`prd-job:${jobNo.trim().toLowerCase()}`, async () => {
    const { index, base } = await loadJobRow(jobNo);
    if (base.status === "IN_PROGRESS") {
      throw new ProductionError("งานนี้เริ่มผลิตแล้ว", 409);
    }
    assertTransition(base.status, "IN_PROGRESS");
    const nowIso = new Date().toISOString();
    base.status = "IN_PROGRESS";
    base.started_by_name = actor.name;
    base.started_at = base.started_at || nowIso;
    base.updated_at = nowIso;
    await writeJobRow(index, base);
    await appendHistory(base.job_no, "START", actor, "", { started_by: actor.name });
    await notify("ADMIN", base, `▶️ เริ่มผลิต ${jobLine(base)} — เป้าหมาย ${base.target_qty} ${base.unit}`, actor.name);
    const detail = await getJobDetail(base.job_no);
    return detail!.job;
  });
}

// ---- รายงานผล (หัวใจของระบบ) ----

export interface ReportResult {
  report: ProductionReport;
  job: ProductionJob;
  replayed: boolean;
}

export async function reportProduction(
  actor: ProductionActor,
  jobNo: string,
  input: ReportProductionInput
): Promise<ReportResult> {
  const key = `prd-job:${jobNo.trim().toLowerCase()}`;
  return withKeyedLock(key, async () => {
    const { index, base } = await loadJobRow(jobNo);

    if (base.status !== "IN_PROGRESS") {
      throw new ProductionError(
        `งานสถานะ ${PRODUCTION_JOB_STATUS_LABELS[base.status]} ไม่สามารถรายงานผลได้ — ต้องเริ่มผลิตก่อน และหลังจบ/ยกเลิกต้องรอ ADMIN เปิดงานใหม่`,
        409
      );
    }

    const good = round2(input.good_qty);
    const defect = round2(input.defect_qty);
    if (good + defect <= 0) {
      throw new ProductionError("กรุณากรอกจำนวนผลิตดีหรือของเสียอย่างน้อย 1 รายการ");
    }
    if (defect > 0 && !input.defect_cause?.trim()) {
      throw new ProductionError("มีของเสียต้องระบุสาเหตุของเสียทุกครั้ง", 400);
    }

    // กันกดยืนยันซ้ำ: เคยมีรายงาน idempotency_key นี้แล้ว → คืนผลเดิม
    const existingRows = await readReportRows(true);
    const existingIdx = existingRows.findIndex(
      (r) => r && str(r[16]).trim() === input.idempotency_key
    );
    if (existingIdx !== -1) {
      const existing = reportRowToReport(existingRows[existingIdx]);
      const detail = await getJobDetail(base.job_no);
      return { report: existing, job: detail!.job, replayed: true };
    }

    // ยอดสะสมปัจจุบัน
    const jobReports = existingRows
      .filter((r) => r && str(r[1]).trim().toLowerCase() === base.job_no.toLowerCase())
      .map(reportRowToReport);
    const progress = computeProgress(base.target_qty, jobReports);
    const newGood = round2(progress.produced_good + good);
    const newDefect = round2(progress.defect_total + defect);
    const remainingAfter = round2(Math.max(0, base.target_qty - newGood));
    const overAfter = round2(Math.max(0, newGood - base.target_qty));

    const isFinal = input.report_kind === "FINAL";
    let closeReason = input.close_reason || "";
    if (isFinal && (remainingAfter > 0 || overAfter > 0) && !closeReason.trim()) {
      throw new ProductionError(
        remainingAfter > 0
          ? `จบงานโดยผลิตได้ ${newGood} ${base.unit} ยังขาดจากเป้าหมายอีก ${remainingAfter} ${base.unit} — ต้องระบุเหตุผล`
          : `ผลิตดีสะสม ${newGood} ${base.unit} เกินเป้าหมาย ${overAfter} ${base.unit} — ต้องระบุเหตุผล`,
        400
      );
    }

    const reportNo = jobReports.length + 1;
    const nowIso = new Date().toISOString();
    const report: ProductionReport = {
      report_id: `prr-${crypto.randomUUID()}`,
      job_no: base.job_no,
      report_no: reportNo,
      kind: "REPORT",
      report_kind: input.report_kind,
      good_qty: good,
      defect_qty: defect,
      defect_cause: input.defect_cause || "",
      reason: closeReason,
      note: input.note || "",
      photo_url: input.photo_url || "",
      reported_by: actor.id,
      reported_by_name: actor.name,
      reported_at: nowIso,
      cumulative_good: newGood,
      cumulative_defect: newDefect,
      idempotency_key: input.idempotency_key,
    };

    const newStatus: ProductionJobStatus = isFinal ? "COMPLETED" : "IN_PROGRESS";
    assertTransition(base.status, newStatus);

    // ---- เขียนทั้งหมดภายใต้ idempotency + journal + ล็อกสต็อกโกดัง 2 ----
    const jobForStock: ProductionJob = { ...base, produced_good: newGood, defect_total: newDefect, remaining_qty: remainingAfter, over_qty: overAfter, report_count: reportNo } as ProductionJob;

    const executeAll = async ({ repo }: { repo: IStockRepository }): Promise<Document> => {
      // 1) บันทึกรายงาน (append-only)
      await appendRows(SHEETS.PRODUCTION_REPORTS, [reportToRow(report)]);
      clearSheetCache(SHEETS.PRODUCTION_REPORTS);

      // 2) เพิ่มสต็อกสินค้าดีรายงานนี้เข้าโกดัง 2 (ครั้งเดียว — กันซ้ำภายใน)
      let stockDoc: Document | null = null;
      if (good > 0) {
        stockDoc = await postReportStockToWh2({ repo }, { job: jobForStock, report, actorId: actor.id });
      }

      // 3) อัปเดตสถานะงาน
      base.status = newStatus;
      base.updated_at = nowIso;
      if (isFinal) {
        base.completed_at = nowIso;
        base.close_reason = closeReason;
      }
      await writeJobRow(index, base);

      // 4) ประวัติ + แจ้ง ADMIN
      await appendHistory(
        base.job_no,
        isFinal ? "REPORT_FINAL" : "REPORT_PARTIAL",
        actor,
        closeReason,
        { report_no: reportNo, good_qty: good, defect_qty: defect, cumulative_good: newGood, cumulative_defect: newDefect, target: base.target_qty }
      );
      const statusLabel = PRODUCTION_JOB_STATUS_LABELS[newStatus];
      await notify(
        "ADMIN",
        base,
        `📊 รายงานผล ${jobLine(base)} — ดีรอบนี้ +${good} ${base.unit} · เสียรอบนี้ +${defect} ${base.unit} · สะสม ${newGood}/${base.target_qty} ${base.unit} · สถานะ: ${statusLabel}`,
        actor.name
      );

      // Document ผลลัพธ์ (เก็บใน idempotency cache เพื่อ replay) — note เก็บผลรายงานกลับไปด้วย
      const resultDoc: Document =
        stockDoc || {
          document_id: report.report_id,
          document_no: `${base.job_no}-R${reportNo}`,
          document_type: "RECEIVE",
          reference_no: base.job_no,
          document_date: nowIso.slice(0, 10),
          status: "POSTED",
          note: JSON.stringify({ kind: "PRODUCTION_REPORT_RESULT", report, job_status: newStatus }),
          created_by: actor.id,
          created_at: nowIso,
        };
      if (stockDoc) {
        // ใส่ผลรายงานลง note ของเอกสารที่เก็บใน idempotency cache ด้วย (ตัวจริงในชีตเก็บข้อมูลสต็อก)
        return { ...stockDoc, note: JSON.stringify({ kind: "PRODUCTION_REPORT_RESULT", report, job_status: newStatus }) };
      }
      return resultDoc;
    };

    const repo = getRepository();
    await executeAtomicOperation({
      repo,
      operationType: "PRODUCTION_REPORT",
      idempotencyKey: `mfg-report-${input.idempotency_key}`,
      actorId: actor.id,
      actorRole: actor.role,
      lockKeys: [formatStockLockKey(PRODUCTION_RECEIVE_WAREHOUSE, base.location || "any", base.product_id)],
      auditAction: "PRODUCTION_REPORT",
      warehouseId: PRODUCTION_RECEIVE_WAREHOUSE,
      payload: { job_no: base.job_no, ...input },
      execute: executeAll,
    });

    const detail = await getJobDetail(base.job_no);
    return { report, job: detail!.job, replayed: false };
  });
}

// ---- ยกเลิก / เปิดใหม่ ----

export async function cancelJob(actor: ProductionActor, jobNo: string, reason: string): Promise<ProductionJob> {
  return withKeyedLock(`prd-job:${jobNo.trim().toLowerCase()}`, async () => {
    const { index, base } = await loadJobRow(jobNo);
    if (base.status === "CANCELLED") {
      throw new ProductionError("งานนี้ยกเลิกไปแล้ว", 409);
    }
    assertTransition(base.status, "CANCELLED");
    const nowIso = new Date().toISOString();
    base.status = "CANCELLED";
    base.cancelled_at = nowIso;
    base.cancelled_by_name = actor.name;
    base.cancel_reason = reason;
    base.updated_at = nowIso;
    await writeJobRow(index, base);

    // ผลผลิตที่ยืนยันแล้วถูกเก็บไว้ในแท็บรายงานตามเดิม — ไม่ลบ
    await appendHistory(base.job_no, "CANCEL", actor, reason, {});
    await notify("APPROVER", base, `🚫 ยกเลิกงาน ${jobLine(base)} — เหตุผล: ${reason}`, actor.name);

    const detail = await getJobDetail(base.job_no);
    return detail!.job;
  });
}

export async function reopenJob(actor: ProductionActor, jobNo: string, reason: string): Promise<ProductionJob> {
  return withKeyedLock(`prd-job:${jobNo.trim().toLowerCase()}`, async () => {
    const { index, base } = await loadJobRow(jobNo);
    if (base.status !== "COMPLETED") {
      throw new ProductionError("เปิดงานผลิตต่อได้เฉพาะงานที่จบแล้วเท่านั้น", 409);
    }
    assertTransition(base.status, "IN_PROGRESS");
    const nowIso = new Date().toISOString();
    base.status = "IN_PROGRESS";
    base.reopen_reason = reason;
    base.reopen_count += 1;
    base.completed_at = "";
    base.updated_at = nowIso;
    await writeJobRow(index, base);
    await appendHistory(base.job_no, "REOPEN", actor, reason, { reopen_count: base.reopen_count });
    await notify("APPROVER", base, `🔁 เปิดงานผลิตต่อ ${jobLine(base)} — เหตุผล: ${reason}`, actor.name);
    const detail = await getJobDetail(base.job_no);
    return detail!.job;
  });
}

// ---- ปรับปรุงยอดผลผลิต (ADMIN) ----

export async function adjustProduction(
  actor: ProductionActor,
  jobNo: string,
  input: AdjustProductionInput
): Promise<ReportResult> {
  return withKeyedLock(`prd-job:${jobNo.trim().toLowerCase()}`, async () => {
    const { base } = await loadJobRow(jobNo);
    if (base.status === "DRAFT" || base.status === "WAITING") {
      throw new ProductionError("งานที่ยังไม่เริ่มผลิตไม่มียอดผลผลิตให้ปรับปรุง", 409);
    }

    const existingRows = await readReportRows(true);
    const existingIdx = existingRows.findIndex((r) => r && str(r[16]).trim() === input.idempotency_key);
    if (existingIdx !== -1) {
      const existing = reportRowToReport(existingRows[existingIdx]);
      const detail = await getJobDetail(base.job_no);
      return { report: existing, job: detail!.job, replayed: true };
    }

    const jobReports = existingRows
      .filter((r) => r && str(r[1]).trim().toLowerCase() === base.job_no.toLowerCase())
      .map(reportRowToReport);
    const progress = computeProgress(base.target_qty, jobReports);
    const goodDelta = round2(input.new_good_qty - progress.produced_good);
    const defectDelta = round2(input.new_defect_qty - progress.defect_total);
    if (goodDelta === 0 && defectDelta === 0) {
      throw new ProductionError("ยอดใหม่เท่ากับยอดปัจจุบัน — ไม่มีการเปลี่ยนแปลง", 400);
    }
    if (input.new_good_qty < 0 || input.new_defect_qty < 0) {
      throw new ProductionError("ยอดสะสมใหม่ห้ามติดลบ", 400);
    }

    const reportNo = jobReports.length + 1;
    const nowIso = new Date().toISOString();
    const report: ProductionReport = {
      report_id: `prr-${crypto.randomUUID()}`,
      job_no: base.job_no,
      report_no: reportNo,
      kind: "ADJUSTMENT",
      report_kind: "",
      good_qty: goodDelta,
      defect_qty: defectDelta,
      defect_cause: "",
      reason: input.reason,
      note: "",
      photo_url: "",
      reported_by: actor.id,
      reported_by_name: actor.name,
      reported_at: nowIso,
      cumulative_good: round2(input.new_good_qty),
      cumulative_defect: round2(input.new_defect_qty),
      idempotency_key: input.idempotency_key,
    };

    const jobForStock = { ...base, produced_good: input.new_good_qty, defect_total: input.new_defect_qty } as ProductionJob;

    const executeAll = async ({ repo }: { repo: IStockRepository }): Promise<Document> => {
      await appendRows(SHEETS.PRODUCTION_REPORTS, [reportToRow(report)]);
      clearSheetCache(SHEETS.PRODUCTION_REPORTS);

      // ปรับสต็อกตามส่วนต่างของ "ผลิตดี" (ตรวจสอบย้อนหลังได้ผ่าน movement ADJUST)
      let stockDoc: Document | null = null;
      if (goodDelta !== 0) {
        stockDoc = await postAdjustStockToWh2(
          { repo },
          { job: jobForStock, report, goodDelta, actorId: actor.id }
        );
      }

      await appendHistory(
        base.job_no,
        "ADJUST",
        actor,
        input.reason,
        {
          before: { good: progress.produced_good, defect: progress.defect_total },
          after: { good: input.new_good_qty, defect: input.new_defect_qty },
          good_delta: goodDelta,
          defect_delta: defectDelta,
        }
      );
      await notify(
        "ADMIN",
        base,
        `⚖️ ปรับปรุงยอดผลผลิต ${jobLine(base)} — ดี ${progress.produced_good} → ${input.new_good_qty} · เสีย ${progress.defect_total} → ${input.new_defect_qty} · เหตุผล: ${input.reason}`,
        actor.name
      );

      const resultDoc: Document =
        stockDoc || {
          document_id: report.report_id,
          document_no: `${base.job_no}-A${reportNo}`,
          document_type: "ADJUST",
          reference_no: base.job_no,
          document_date: nowIso.slice(0, 10),
          status: "POSTED",
          note: JSON.stringify({ kind: "PRODUCTION_ADJUST_RESULT", report }),
          created_by: actor.id,
          created_at: nowIso,
        };
      return stockDoc
        ? { ...stockDoc, note: JSON.stringify({ kind: "PRODUCTION_ADJUST_RESULT", report }) }
        : resultDoc;
    };

    const repo = getRepository();
    await executeAtomicOperation({
      repo,
      operationType: "PRODUCTION_ADJUST",
      idempotencyKey: `mfg-adjust-${input.idempotency_key}`,
      actorId: actor.id,
      actorRole: actor.role,
      lockKeys: [formatStockLockKey(PRODUCTION_RECEIVE_WAREHOUSE, base.location || "any", base.product_id)],
      auditAction: "PRODUCTION_ADJUST",
      warehouseId: PRODUCTION_RECEIVE_WAREHOUSE,
      payload: { job_no: base.job_no, ...input },
      execute: executeAll,
    });

    const detail = await getJobDetail(base.job_no);
    return { report, job: detail!.job, replayed: false };
  });
}

// ---- การแจ้งเตือน ----

export async function listNotifications(
  role: "ADMIN" | "APPROVER",
  userId: string,
  options: { limit?: number } = {}
): Promise<{ items: (ProductionNotification & { is_read: boolean })[]; unread_count: number }> {
  const rows = await readSheet(SHEETS.PRODUCTION_NOTIFS, "A2:G", { forceFresh: true }).catch(() => []);
  const items: (ProductionNotification & { is_read: boolean })[] = [];
  for (const r of rows) {
    if (!r || !r[0]) continue;
    if (str(r[1]).trim().toUpperCase() !== role) continue;
    let readBy: string[] = [];
    try {
      const parsed = JSON.parse(str(r[6]) || "[]");
      if (Array.isArray(parsed)) readBy = parsed.map(String);
    } catch {}
    items.push({
      notif_id: str(r[0]),
      target_role: role,
      job_no: str(r[2]),
      message: str(r[3]),
      created_at: str(r[4]),
      created_by_name: str(r[5]),
      read_by: readBy,
      is_read: readBy.includes(userId),
    });
  }
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const limit = options.limit ?? 100;
  const top = items.slice(0, limit);
  return { items: top, unread_count: items.filter((i) => !i.is_read).length };
}

export async function markNotificationsRead(
  role: "ADMIN" | "APPROVER",
  userId: string,
  ids: string[] | "all"
): Promise<void> {
  await withKeyedLock("prd-notif-read", async () => {
    const rows = await readSheet(SHEETS.PRODUCTION_NOTIFS, "A2:G", { forceFresh: true }).catch(() => []);
    const updates: { rowNumber: number; values: (string | number | boolean)[] }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[0]) continue;
      if (str(r[1]).trim().toUpperCase() !== role) continue;
      const isTarget = ids === "all" || ids.includes(str(r[0]));
      if (!isTarget) continue;
      let readBy: string[] = [];
      try {
        const parsed = JSON.parse(str(r[6]) || "[]");
        if (Array.isArray(parsed)) readBy = parsed.map(String);
      } catch {}
      if (!readBy.includes(userId)) {
        readBy.push(userId);
        const rowValues = [...r];
        while (rowValues.length < 7) rowValues.push("");
        rowValues[6] = JSON.stringify(readBy);
        updates.push({ rowNumber: i + 2, values: rowValues });
      }
    }
    if (updates.length > 0) {
      await batchUpdateRows(SHEETS.PRODUCTION_NOTIFS, updates);
      clearSheetCache(SHEETS.PRODUCTION_NOTIFS);
    }
  });
}
