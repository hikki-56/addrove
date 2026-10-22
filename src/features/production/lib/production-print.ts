import { previewProductionBom } from "@/lib/production-bom";
import type { ProductionJob } from "@/types/production";
import type { ProductionMaterialRequirement, ProductionMaterialStockLocation } from "@/types/production-bom";

export interface ProductionPrintMaterial extends ProductionMaterialRequirement {
  locations: ProductionMaterialStockLocation[];
}

export interface ProductionPrintJob {
  job: ProductionJob;
  quantity: number;
  materials: ProductionPrintMaterial[];
  issues: string[];
}

export function isPrintableProductionJob(job: ProductionJob): boolean {
  return (job.status === "WAITING" || job.status === "IN_PROGRESS") && job.remaining_qty > 0;
}

/** Use the remaining good-output target and the job's frozen BOM, never the current master recipe. */
export function buildProductionPrintJobs(jobs: ProductionJob[]): ProductionPrintJob[] {
  return jobs.filter(isPrintableProductionJob).sort((a, b) =>
    a.production_date.localeCompare(b.production_date) || a.table_no - b.table_no || a.job_no.localeCompare(b.job_no)
  ).map(job => {
    const plan = job.material_plan;
    if (!plan) return { job, quantity: job.remaining_qty, materials: [], issues: ["ยังไม่ได้ผูกสูตรวัตถุดิบ"] };
    const preview = previewProductionBom(plan.snapshot, job.remaining_qty, plan.selection);
    return { job, quantity: job.remaining_qty, issues: preview.issues,
      materials: preview.materials.map(item => ({ ...item, locations: plan.stock_locations?.filter(l => l.product_id === item.product_id) || [] })) };
  });
}
