import {
  to8DigitBarcode,
  encodeCode128Modules,
  CODE128_PATTERNS,
  normalizeBarcode,
  areBarcodesMatching,
  generateCode128PngDataUrl,
} from "../src/lib/barcode-utils";

describe("barcode-utils", () => {
  describe("to8DigitBarcode", () => {
    it("should return clean barcode value", () => {
      expect(to8DigitBarcode("1K14-1A")).toBe("1K14-1A");
      expect(to8DigitBarcode("8851234567890")).toBe("8851234567890");
      expect(to8DigitBarcode("  LOC-A01  ")).toBe("LOC-A01");
    });

    it("should ignore TRF prefix and return SKU if available", () => {
      expect(to8DigitBarcode("TRF-12345", "SKU-999")).toBe("SKU-999");
      expect(to8DigitBarcode("TRF", "SKU-888")).toBe("SKU-888");
    });

    it("should preserve 13-digit barcode from product name and not truncate to 8 digits", () => {
      expect(to8DigitBarcode("", "", "8851234567890 สินค้าตัวอย่าง")).toBe("8851234567890");
      expect(to8DigitBarcode("-", "-", "8859999888877")).toBe("8859999888877");
    });
  });

  describe("encodeCode128Modules", () => {
    it("should encode shelf location strings into valid Code 128 bar/space modules", () => {
      const modules = encodeCode128Modules("1K14-1A");
      expect(modules.length).toBeGreaterThan(0);
      expect(modules[0].isBar).toBe(true);
      // Total width must be positive integer
      const totalWidth = modules.reduce((sum, m) => sum + m.width, 0);
      expect(totalWidth).toBeGreaterThan(50);
    });

    it("should handle start and stop patterns", () => {
      expect(CODE128_PATTERNS[104]).toBe("211214"); // Start B
      expect(CODE128_PATTERNS[106]).toBe("2331112"); // Stop
    });
  });

  describe("normalizeBarcode & areBarcodesMatching", () => {
    it("should normalize barcodes and match correctly", () => {
      expect(normalizeBarcode(" 1K14-1A ")).toBe("1k141a");
      expect(areBarcodesMatching("1K14-1A", ["1k14-1a"])).toBe(true);
      expect(areBarcodesMatching("8851234567890", ["8851234567890"])).toBe(true);
    });
  });

  describe("generateCode128PngDataUrl", () => {
    it("should safely return empty string in non-DOM environment without crashing", () => {
      // In NodeJS/Jest environment without mocked canvas
      const res = generateCode128PngDataUrl("1K14-1A");
      expect(typeof res).toBe("string");
    });
  });
});
