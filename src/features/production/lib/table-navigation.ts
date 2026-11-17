import type { ProductionJob } from "@/types/production";

type TableJob = Pick<ProductionJob, "job_no" | "production_date" | "status">;

export function preferredTableJob<T extends TableJob>(jobs: readonly T[]): T | undefined {
  const ordered = [...jobs].sort((a, b) => b.production_date.localeCompare(a.production_date));
  return ordered.find(j => j.status === "IN_PROGRESS") ?? ordered.find(j => j.status === "WAITING")
    ?? ordered.find(j => j.status === "DRAFT") ?? ordered.find(j => j.status !== "CANCELLED");
}

export function validTableDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

export function productionTableHref(tableNo: number, jobs: readonly TableJob[], date?: string): string {
  const selectedDate = validTableDate(date ?? null);
  const job = preferredTableJob(selectedDate ? jobs.filter(j => j.production_date === selectedDate) : jobs);
  const params = new URLSearchParams();
  if (selectedDate || job) params.set("date", selectedDate || job!.production_date);
  if (job) params.set("job_no", job.job_no);
  return `/production/tables/${tableNo}${params.size ? `?${params}` : ""}`;
}
