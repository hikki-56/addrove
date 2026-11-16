import { normalizeReceiveScanCode } from "@/features/receive/utils";

describe("normalizeReceiveScanCode", () => {
  it.each([
    "90003073", "]C190003073", "]C090003073", "(90)003073", "  ]C1(90)003073\r\n",
  ])("returns the full numeric catalogue code from %s", (code) => {
    expect(normalizeReceiveScanCode(code)).toBe("90003073");
  });

  it.each([
    "CI90003073", "C190003073", "SKU-90003073", "00003073",
    "(01)08851234567890(17)261116", "(90)003073(10)LOT1", "(90)00307",
  ])("preserves other codes instead of guessing their product number: %s", (code) => {
    expect(normalizeReceiveScanCode(code)).toBe(code);
  });
});
