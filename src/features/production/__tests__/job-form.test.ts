import { buildCreateJobInput, buildJobPatch, qtyOrUndefined, canEditField, type JobFormInput } from "@/features/production/lib/job-form";
import type { ProductionJob } from "@/types/production";

const job = (over: Partial<ProductionJob> = {}): ProductionJob =>
  ({
    job_no: "PRD-1",
    status: "DRAFT",
    production_date: "2026-10-09",
    product_id: "prod-A",
    table_no: 1,
    target_qty: 100,
    priority: "NORMAL",
    note: "",
    location: "",
    updated_at: "2026-10-08T01:00:00.000Z",
    ...over,
  }) as ProductionJob;

const form = (j: ProductionJob, over: Partial<JobFormInput> = {}): JobFormInput => ({
  production_date: j.production_date,
  product_id: j.product_id,
  table_no: j.table_no,
  target_qty: String(j.target_qty),
  priority: j.priority,
  note: j.note,
  location: j.location,
  reason: "",
  ...over,
});

describe("qtyOrUndefined", () => {
  it("never returns an empty string", () => {
    expect(qtyOrUndefined("")).toBeUndefined();
    expect(qtyOrUndefined("  ")).toBeUndefined();
    expect(qtyOrUndefined("abc")).toBeUndefined();
    expect(qtyOrUndefined("2.3")).toBe(2.3);
    expect(qtyOrUndefined(5)).toBe(5);
    expect(qtyOrUndefined(Number.NaN)).toBeUndefined();
  });
});

describe("buildCreateJobInput", () => {
  it("sends target_qty as a number", () => {
    const body = buildCreateJobInput(form(job(), { target_qty: "1.15", note: " x " }));
    expect(body.target_qty).toBe(1.15);
    expect(body.note).toBe("x");
  });
  it("omits target_qty when empty", () => {
    expect("target_qty" in buildCreateJobInput(form(job(), { target_qty: "" }))).toBe(false);
  });
});

describe("buildJobPatch", () => {
  it("sends only changed fields plus updated_at", () => {
    const j = job();
    expect(buildJobPatch(j, form(j, { target_qty: "120" }))).toEqual({ updated_at: j.updated_at, target_qty: 120 });
  });

  it("IN_PROGRESS: only target/note and the reason, even if other fields differ", () => {
    const j = job({ status: "IN_PROGRESS" });
    const patch = buildJobPatch(j, form(j, { target_qty: "150", priority: "URGENT", table_no: 3, location: "2A", reason: " เพิ่มยอด " }));
    expect(patch).toEqual({ updated_at: j.updated_at, target_qty: 150, reason: "เพิ่มยอด" });
  });

  it("WAITING: does not send location or production_date", () => {
    const j = job({ status: "WAITING" });
    const patch = buildJobPatch(j, form(j, { location: "2A", production_date: "2026-10-10", table_no: 2, reason: "ย้ายโต๊ะ" }));
    expect(patch).toEqual({ updated_at: j.updated_at, table_no: 2, reason: "ย้ายโต๊ะ" });
  });

  it("DRAFT: no reason is sent", () => {
    const j = job();
    expect(buildJobPatch(j, form(j, { note: "a", reason: "x" }))).toEqual({ updated_at: j.updated_at, note: "a" });
  });

  it("never sends an empty target_qty", () => {
    const j = job();
    expect("target_qty" in buildJobPatch(j, form(j, { target_qty: "" }))).toBe(false);
  });
});

describe("canEditField", () => {
  it("follows the status matrix", () => {
    expect(canEditField(undefined, "location")).toBe(true);
    expect(canEditField("DRAFT", "location")).toBe(true);
    expect(canEditField("WAITING", "location")).toBe(false);
    expect(canEditField("WAITING", "priority")).toBe(true);
    expect(canEditField("IN_PROGRESS", "priority")).toBe(false);
    expect(canEditField("IN_PROGRESS", "note")).toBe(true);
    expect(canEditField("COMPLETED", "note")).toBe(false);
  });
});
