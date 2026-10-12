import {
  countDecimals,
  hasAtMostDecimals,
  parseQtyInput,
  roundQty,
  QTY_MESSAGES,
} from "@/features/production/lib/quantity";

describe("hasAtMostDecimals", () => {
  it.each([2.3, 1.15, 0.29, 4.35, 0.07, 10.1, 33.33, 123456.78, 0, 5, 1e21])("accepts %p (≤ 2 decimals)", (v) => {
    expect(hasAtMostDecimals(v)).toBe(true);
  });

  it("documents why the old check was wrong", () => {
    // สูตรเดิมปฏิเสธค่าที่ถูกต้องเหล่านี้
    for (const v of [2.3, 1.15, 0.29, 4.35]) expect(Math.round(v * 100) === v * 100).toBe(false);
  });

  it.each([1.005, 0.001, 2.345, 1e-7, 1.5e-5])("rejects %p (> 2 decimals)", (v) => {
    expect(hasAtMostDecimals(v)).toBe(false);
  });

  it("works on strings and trailing zeros", () => {
    expect(hasAtMostDecimals("2.30")).toBe(true);
    expect(hasAtMostDecimals("2.300")).toBe(true);
    expect(hasAtMostDecimals("2.301")).toBe(false);
    expect(hasAtMostDecimals("abc")).toBe(false);
    expect(hasAtMostDecimals(Number.NaN)).toBe(false);
    expect(hasAtMostDecimals(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("supports other precisions", () => {
    expect(hasAtMostDecimals(5, 0)).toBe(true);
    expect(hasAtMostDecimals(5.5, 0)).toBe(false);
    expect(countDecimals("1.250")).toBe(2);
    expect(countDecimals(1e-7)).toBe(7);
  });
});

describe("parseQtyInput", () => {
  it("parses valid inputs without rounding", () => {
    expect(parseQtyInput("2.3")).toEqual({ ok: true, value: 2.3, empty: false });
    expect(parseQtyInput(" 1.15 ")).toEqual({ ok: true, value: 1.15, empty: false });
    expect(parseQtyInput(".5")).toEqual({ ok: true, value: 0.5, empty: false });
    expect(parseQtyInput("12.")).toEqual({ ok: true, value: 12, empty: false });
  });

  it("treats empty as 0 by default and as required when asked", () => {
    expect(parseQtyInput("")).toEqual({ ok: true, value: 0, empty: true });
    expect(parseQtyInput("  ", { allowEmpty: false })).toEqual({ ok: false, error: QTY_MESSAGES.required, empty: true });
  });

  it("rejects instead of silently rounding", () => {
    expect(parseQtyInput("1.005")).toMatchObject({ ok: false, error: QTY_MESSAGES.tooManyDecimals });
    expect(parseQtyInput("2.345")).toMatchObject({ ok: false, error: QTY_MESSAGES.tooManyDecimals });
  });

  it("rejects non-numeric, negative, exponent and comma input", () => {
    for (const t of ["abc", "-1", "1e3", "1,000", "1 000", "1.2.3", "."]) {
      expect(parseQtyInput(t)).toMatchObject({ ok: false, error: QTY_MESSAGES.notNumber });
    }
  });

  it("enforces > 0 when allowZero is false", () => {
    expect(parseQtyInput("0", { allowZero: false })).toMatchObject({ ok: false, error: QTY_MESSAGES.mustBePositive });
    expect(parseQtyInput("0.01", { allowZero: false })).toEqual({ ok: true, value: 0.01, empty: false });
  });
});

describe("roundQty", () => {
  it("removes floating point noise", () => {
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
    expect(roundQty(1.15 + 2.3)).toBe(3.45);
    expect(roundQty(980 - 1000)).toBe(-20);
  });
});
