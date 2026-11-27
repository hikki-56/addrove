import { reportProductionSchema } from "@/server/production/production-schemas";

const base = {
  good_qty: 10,
  defect_qty: 0,
  report_kind: "FINAL" as const,
  idempotency_key: "carton-variance-key",
};

describe("reportProductionSchema carton variance", () => {
  it("accepts reports without carton fields", () => {
    expect(reportProductionSchema.parse(base).carton_over_qty).toBeUndefined();
  });

  it("requires the over item and leftover location when เกินจากลัง > 0", () => {
    const result = reportProductionSchema.safeParse({ ...base, carton_over_qty: 2 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(issue => issue.message);
      expect(messages).toContain("กรุณาเลือกตัวไหนเกินจากลัง");
      expect(messages).toContain("กรุณาเลือกที่เก็บของเกินในโกดัง 2");
    }
  });

  it("accepts a complete over-carton report", () => {
    const parsed = reportProductionSchema.parse({
      ...base,
      carton_over_qty: 2,
      carton_short_qty: 1,
      carton_over_item_id: "fg",
      leftover_location_id: "loc-2k51",
    });
    expect(parsed.carton_over_qty).toBe(2);
    expect(parsed.leftover_location_id).toBe("loc-2k51");
  });
});