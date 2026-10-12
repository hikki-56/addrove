import { formatHistoryDetail, historyActionLabel } from "@/features/production/lib/history";

const lines = (action: string, detail: unknown) =>
  formatHistoryDetail(action, typeof detail === "string" ? detail : JSON.stringify(detail));

describe("formatHistoryDetail", () => {
  it("returns nothing for empty detail", () => {
    expect(formatHistoryDetail("CANCEL", "{}")).toEqual({ lines: [], raw: null });
    expect(formatHistoryDetail("CANCEL", "")).toEqual({ lines: [], raw: null });
    expect(formatHistoryDetail("CANCEL", undefined)).toEqual({ lines: [], raw: null });
  });

  it("CREATE / SUBMIT", () => {
    expect(lines("CREATE", { target_qty: 1000, table_no: 2, sku: "SKU-1" })).toEqual({
      lines: [
        { label: "เป้าหมาย", value: "1,000" },
        { label: "โต๊ะ", value: "โต๊ะ 2" },
        { label: "รหัสสินค้า", value: "SKU-1" },
      ],
      raw: null,
    });
    expect(lines("SUBMIT", { table_no: 1, target_qty: 2.5 }).lines).toEqual([
      { label: "โต๊ะ", value: "โต๊ะ 1" },
      { label: "เป้าหมาย", value: "2.5" },
    ]);
  });

  it("EDIT shows before → after for changed fields only", () => {
    const res = lines("EDIT", {
      before: { product_id: "p1", target_qty: 100, table_no: 1, note: "", priority: "NORMAL", location: "", production_date: "2026-10-08" },
      after: { priority: "URGENT", target_qty: 120, note: "เร่ง" },
    });
    expect(res.raw).toBeNull();
    expect(res.lines).toEqual([
      { label: "เป้าหมาย", value: "100 → 120" },
      { label: "ความสำคัญ", value: "ปกติ → ด่วน" },
      { label: "หมายเหตุ", value: "(ว่าง) → เร่ง" },
    ]);
  });

  it("START / REOPEN / DELETE", () => {
    expect(lines("START", { started_by: "สมชาย" }).lines).toEqual([{ label: "ผู้เริ่มผลิต", value: "สมชาย" }]);
    expect(lines("REOPEN", { reopen_count: 2 }).lines).toEqual([{ label: "เปิดผลิตต่อครั้งที่", value: "2" }]);
    expect(lines("DELETE", { deleted_draft: "PRD-1" }).lines).toEqual([{ label: "ฉบับร่างที่ลบ", value: "PRD-1" }]);
  });

  it("REPORT_FINAL", () => {
    const res = lines("REPORT_FINAL", {
      report_no: 2,
      good_qty: 380,
      defect_qty: 10,
      cumulative_good: 980,
      cumulative_defect: 30,
      target: 1000,
    });
    expect(res.raw).toBeNull();
    expect(res.lines.map((l) => `${l.label}: ${l.value}`)).toEqual([
      "รอบที่: 2",
      "ผลิตดีรอบนี้: 380",
      "ของเสียรอบนี้: 10",
      "ดีสะสม: 980",
      "เสียสะสม: 30",
      "เป้าหมาย: 1,000",
    ]);
  });

  it("ADJUST", () => {
    const res = lines("ADJUST", {
      before: { good: 980, defect: 30 },
      after: { good: 975, defect: 35 },
      good_delta: -5,
      defect_delta: 5,
    });
    expect(res.raw).toBeNull();
    expect(res.lines.map((l) => `${l.label}: ${l.value}`)).toEqual([
      "ผลิตดีสะสม: 980 → 975",
      "ของเสียสะสม: 30 → 35",
      "ส่วนต่างผลิตดี: -5",
      "ส่วนต่างของเสีย: +5",
    ]);
  });

  it("falls back to JSON for unknown keys / shapes", () => {
    expect(lines("CREATE", { target_qty: 5, weird: { a: 1 } })).toEqual({
      lines: [{ label: "เป้าหมาย", value: "5" }],
      raw: JSON.stringify({ weird: { a: 1 } }),
    });
    expect(formatHistoryDetail("X", "not json")).toEqual({ lines: [], raw: "not json" });
    expect(formatHistoryDetail("X", "[1,2]")).toEqual({ lines: [], raw: "[1,2]" });
    expect(lines("CREATE", { target_qty: "abc" }).raw).toBe(JSON.stringify({ target_qty: "abc" }));
  });
});

describe("historyActionLabel", () => {
  it("maps known actions and passes through unknown ones", () => {
    expect(historyActionLabel("REPORT_FINAL")).toBe("รายงานและจบงาน");
    expect(historyActionLabel("SOMETHING")).toBe("SOMETHING");
  });
});

describe("historyActionLabel — recovery actions (api-contract)", () => {
  it("labels REPORT_RECOVERY / ADJUST_RECOVERY in Thai", () => {
    expect(historyActionLabel("REPORT_RECOVERY")).toBe("บันทึกต่อจากรายการค้าง (ระบบ)");
    expect(historyActionLabel("ADJUST_RECOVERY")).toBe("ปรับสต็อกต่อจากรายการค้าง (ระบบ)");
  });
});
