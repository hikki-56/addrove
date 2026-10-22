import { buildProductionPrintJobs } from "@/features/production/lib/production-print";
import type { ProductionJob } from "@/types/production";
import type { ProductionMaterialPlan } from "@/types/production-bom";

function job(overrides: Partial<ProductionJob> = {}): ProductionJob {
  const plan: ProductionMaterialPlan = {
    snapshot: { bom_id: "BOM-FROZEN", product_id: "fg", sku: "FG", name: "สินค้าทดสอบ", label: "สูตรเดิม", unit: "ชุด", stock_unit: "ชุด", base_qty: 2, items: [
      { item_id: 1, product_id: "main", sku: "MAIN", name: "ตัวหลัก", barcode: "", qty: 4, unit: "ตัว", stock_unit: "ตัว", warehouse_id: "wh-02", is_primary: 1, waste_percentage: 0 },
      { item_id: 2, product_id: "shared", sku: "SHARED", name: "ตัวรอง", barcode: "", qty: 1.5, unit: "ใบ", stock_unit: "ชิ้น", warehouse_id: "wh-02", is_primary: 0, waste_percentage: 0 },
    ] }, selection: { bom_id: "BOM-FROZEN", material_factors: { "2": 2 } }, stock_locations: [
      { product_id: "main", location_id: "a", location_code: "A1", location_name: "", quantity: 10 },
      { product_id: "main", location_id: "b", location_code: "B2", location_name: "", quantity: 8 },
      { product_id: "shared", location_id: "c", location_code: "C1", location_name: "", quantity: 15 },
    ],
  };
  return { job_no: "PRD-TEST", production_date: "2026-10-21", table_no: 2, status: "IN_PROGRESS", target_qty: 10, produced_good: 4, remaining_qty: 6, unit: "ชุด", material_plan: plan, ...overrides } as ProductionJob;
}

test("partial jobs print only remaining output and convert both primary and secondary recipe quantities", () => {
  const original = job();
  const before = JSON.stringify(original);
  const [sheet] = buildProductionPrintJobs([original]);
  expect(sheet.quantity).toBe(6);
  expect(sheet.issues).toEqual([]);
  expect(sheet.materials.map(i => [i.sku, i.stock_qty, i.stock_unit])).toEqual([["MAIN", 12, "ตัว"], ["SHARED", 9, "ชิ้น"]]);
  expect(sheet.materials[0].locations.map(l => l.location_code)).toEqual(["A1", "B2"]);
  expect(sheet.materials[1].locations.map(l => l.location_code)).toEqual(["C1"]);
  expect(sheet.job.material_plan?.snapshot.bom_id).toBe("BOM-FROZEN");
  expect(JSON.stringify(original)).toBe(before);
});

test("batch prints exclude drafts, closed jobs and fully produced jobs, sorted by production date then table", () => {
  const jobs = [job({ job_no: "later", production_date: "2026-10-22", table_no: 1 }), job({ job_no: "table5", table_no: 5 }), job({ job_no: "table1", table_no: 1, status: "WAITING" }),
    job({ status: "DRAFT" }), job({ status: "COMPLETED" }), job({ status: "CANCELLED" }), job({ remaining_qty: 0 })];
  expect(buildProductionPrintJobs(jobs).map(s => s.job.job_no)).toEqual(["table1", "table5", "later"]);
  expect(jobs[0].job_no).toBe("later");
});

test("missing recipes or unconfirmed conversions return issues rather than a misleading picking quantity", () => {
  expect(buildProductionPrintJobs([job({ material_plan: undefined })])[0].issues).toContain("ยังไม่ได้ผูกสูตรวัตถุดิบ");
  const unconfirmed = job();
  unconfirmed.material_plan!.selection.material_factors = {};
  const [sheet] = buildProductionPrintJobs([unconfirmed]);
  expect(sheet.issues.join(" ")).toContain("ระบุอัตราแปลง");
  expect(sheet.materials[1].stock_qty).toBeNull();
});

test("keeps ten products on the same table as separate work orders with their own quantities", () => {
  const jobs = Array.from({ length: 10 }, (_, i) => job({ job_no: `table4-${i}`, table_no: 4, remaining_qty: i + 1 }));
  jobs.push(job({ job_no: "table5", table_no: 5 }), job({ job_no: "tomorrow", table_no: 4, production_date: "2026-10-22" }));
  const entries = buildProductionPrintJobs(jobs);
  expect(entries).toHaveLength(12);
  expect(new Set(entries.map(e => e.job.job_no)).size).toBe(12);
  expect(entries.slice(0, 10).map(e => e.quantity)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(entries.slice(0, 10).map(e => e.materials[0].stock_qty)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
});
