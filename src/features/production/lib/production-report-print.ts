import type { ProductionJob, ProductionReport } from "@/types/production";

export interface ProductionReportSlipMaterial {
  sku: string; name: string; used_qty: number; scrap_qty: number; total_qty: number; unit: string; cause: string;
}
export interface ProductionReportSlip {
  job_no: string; round_label: string; reported_at: string; product_name: string; sku: string; barcode: string;
  table_no: number | string; target_qty: number; unit: string; reported_by_name: string;
  good_qty: number; defect_qty: number; cumulative_good: number; cumulative_defect: number;
  kind_label: string; reasons: Array<{ label: string; value: string }>; receipt_location_code: string;
  materials: ProductionReportSlipMaterial[];
}

export function reportKindLabel(report: Pick<ProductionReport, "kind" | "report_kind">): string {
  if (report.kind === "ADJUSTMENT") return "ปรับปรุงยอด";
  if (report.report_kind === "FINAL") return "จบงาน";
  if (report.report_kind === "PARTIAL") return "ยังทำต่อ";
  return "-";
}

/** สรุปข้อมูลใบรายงานผลผลิตของรายงาน 1 รอบ (ใช้ข้อมูลที่หน้า detail โหลดอยู่แล้ว · ไม่แก้ input) */
export function buildProductionReportSlip(job: ProductionJob, report: ProductionReport): ProductionReportSlip {
  const names = new Map((job.material_plan?.snapshot.items ?? []).map(i => [i.sku, i.name]));
  const reasons = ([
    ["สาเหตุของเสีย", report.defect_cause],
    [report.kind === "ADJUSTMENT" ? "เหตุผลปรับปรุง" : "เหตุผล", report.reason],
    ["หมายเหตุ", report.note],
    ["เหตุผลยอดใช้จริง", report.material_reason],
  ] as const).flatMap(([label, value]) => value?.trim() ? [{ label, value: value.trim() }] : []);
  return {
    job_no: job.job_no,
    round_label: report.kind === "ADJUSTMENT" ? "ปรับปรุงยอด" : String(report.report_no),
    reported_at: report.reported_at,
    product_name: job.product_name, sku: job.sku, barcode: job.barcode || "",
    table_no: job.table_no, target_qty: job.target_qty, unit: job.unit,
    reported_by_name: report.reported_by_name || "-",
    good_qty: report.good_qty, defect_qty: report.defect_qty,
    cumulative_good: report.cumulative_good, cumulative_defect: report.cumulative_defect,
    kind_label: reportKindLabel(report), reasons,
    receipt_location_code: report.receipt_location_code || "",
    materials: (report.material_details ?? []).map(m => ({
      sku: m.sku, name: names.get(m.sku) || "", used_qty: m.used_qty, scrap_qty: m.scrap_qty,
      total_qty: m.total_qty, unit: m.stock_unit, cause: m.scrap_cause || "",
    })),
  };
}
