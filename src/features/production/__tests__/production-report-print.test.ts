import { buildProductionReportSlip, reportKindLabel } from "@/features/production/lib/production-report-print";
import type { ProductionJob, ProductionReport } from "@/types/production";

const job = { job_no: "PRD-1", product_name: "สินค้า", sku: "FG", barcode: "885", table_no: 3, target_qty: 100, unit: "ชิ้น",
  material_plan: { snapshot: { items: [{ sku: "RM1", name: "ผ้า" }] } } } as unknown as ProductionJob;
const report = { report_id: "r1", report_no: 2, kind: "REPORT", report_kind: "FINAL", good_qty: 40, defect_qty: 2, cumulative_good: 90,
  cumulative_defect: 5, defect_cause: "ตัดเบี้ยว", reason: "", note: " ", reported_by_name: "สมชาย", reported_at: "2026-10-22T08:00:00Z",
  material_reason: "เปลี่ยนม้วน", material_details: [{ sku: "RM1", stock_unit: "ม.", used_qty: 10, scrap_qty: 1, scrap_cause: "ขาด", total_qty: 11 }, { sku: "RM9", stock_unit: "ชิ้น", used_qty: 1, scrap_qty: 0, scrap_cause: "", total_qty: 1 }],
} as unknown as ProductionReport;

test("builds a slip for one report with material names, kind and non-empty reasons", () => {
  const before = JSON.stringify(report);
  const slip = buildProductionReportSlip(job, report);
  expect(slip.round_label).toBe("2");
  expect(slip.kind_label).toBe("จบงาน");
  expect(slip.reasons).toEqual([{ label: "สาเหตุของเสีย", value: "ตัดเบี้ยว" }, { label: "เหตุผลยอดใช้จริง", value: "เปลี่ยนม้วน" }]);
  expect(slip.materials.map(m => [m.sku, m.name, m.total_qty, m.unit, m.cause])).toEqual([["RM1", "ผ้า", 11, "ม.", "ขาด"], ["RM9", "", 1, "ชิ้น", ""]]);
  expect(JSON.stringify(report)).toBe(before);
});

test("kind labels", () => {
  expect(reportKindLabel({ kind: "REPORT", report_kind: "PARTIAL" } as ProductionReport)).toBe("ยังทำต่อ");
  expect(reportKindLabel({ kind: "ADJUSTMENT", report_kind: "" } as ProductionReport)).toBe("ปรับปรุงยอด");
  const adj = buildProductionReportSlip({ ...job, material_plan: undefined }, { ...report, kind: "ADJUSTMENT", material_details: undefined } as ProductionReport);
  expect(adj.round_label).toBe("ปรับปรุงยอด");
  expect(adj.materials).toEqual([]);
});
