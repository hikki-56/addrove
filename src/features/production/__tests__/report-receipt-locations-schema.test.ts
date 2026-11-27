import { reportProductionSchema } from "@/server/production/production-schemas";

const base = {
  good_qty: 10,
  defect_qty: 0,
  report_kind: "FINAL" as const,
  idempotency_key: "receipt-locations-key",
};

describe("reportProductionSchema receipt locations", () => {
  it("still accepts a single receipt_location_id", () => {
    expect(reportProductionSchema.parse({ ...base, receipt_location_id: "2K51-1A" }).receipt_location_id).toBe("2K51-1A");
  });

  it("accepts multiple locations whose qty sums to ผลิตดี", () => {
    const parsed = reportProductionSchema.parse({
      ...base,
      receipt_locations: [
        { location_id: "2K51-1A", qty: 7 },
        { location_id: "office-A1", qty: 3 },
      ],
    });
    expect(parsed.receipt_locations).toEqual([
      { location_id: "2K51-1A", qty: 7 },
      { location_id: "office-A1", qty: 3 },
    ]);
  });

  it("rejects a split that does not sum to ผลิตดี", () => {
    const result = reportProductionSchema.safeParse({
      ...base,
      receipt_locations: [
        { location_id: "2K51-1A", qty: 7 },
        { location_id: "office-A1", qty: 2 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(issue => issue.message)).toContain("รวมจำนวนที่เก็บต้องเท่ากับยอดผลิตดี");
  });

  it("rejects duplicate locations", () => {
    const result = reportProductionSchema.safeParse({
      ...base,
      receipt_locations: [
        { location_id: "2K51-1A", qty: 5 },
        { location_id: "2K51-1A", qty: 5 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(issue => issue.message)).toContain("เลือกที่เก็บไม่ให้ซ้ำ");
  });
});
