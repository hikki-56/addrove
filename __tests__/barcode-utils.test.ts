import {
  to8DigitBarcode,
  encodeCode128Modules,
  CODE128_PATTERNS,
  normalizeBarcode,
  areBarcodesMatching,
  generateCode128PngDataUrl,
  getShelfArrowDirection,
  matchesBarcodeLast4,
} from "../src/lib/barcode-utils";

describe("barcode-utils", () => {
  describe("getShelfArrowDirection", () => {
    it("should return down for codes ending in A or containing sub-shelf A", () => {
      expect(getShelfArrowDirection("1K14-1A")).toBe("down");
      expect(getShelfArrowDirection("1A")).toBe("down");
      expect(getShelfArrowDirection("LOC-A")).toBe("down");
      expect(getShelfArrowDirection("WH1-01A")).toBe("down");
    });

    it("should return up for codes ending in B or containing sub-shelf B", () => {
      expect(getShelfArrowDirection("1K14-1B")).toBe("up");
      expect(getShelfArrowDirection("1B")).toBe("up");
      expect(getShelfArrowDirection("LOC-B")).toBe("up");
      expect(getShelfArrowDirection("WH1-01B")).toBe("up");
    });

    it("should return null for codes that do not have A/B direction indicators", () => {
      expect(getShelfArrowDirection("WH-01")).toBeNull();
      expect(getShelfArrowDirection("1K14")).toBeNull();
      expect(getShelfArrowDirection("")).toBeNull();
    });
  });
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

  describe("matchesBarcodeLast4", () => {
    it("should return true when query matches last 4 digits of barcode", () => {
      expect(matchesBarcodeLast4("1234", "8850001234")).toBe(true);
      expect(matchesBarcodeLast4("5678", "885012345678")).toBe(true);
      expect(matchesBarcodeLast4("1234", "1234")).toBe(true);
      expect(matchesBarcodeLast4("0001", "885000000001")).toBe(true);
      expect(matchesBarcodeLast4("1234", "885-00-1234")).toBe(true);
    });

    it("should return false when 4-digit query is in the middle or beginning of barcode, not the end", () => {
      expect(matchesBarcodeLast4("1234", "885012349999")).toBe(false);
      expect(matchesBarcodeLast4("8850", "885012345678")).toBe(false);
      expect(matchesBarcodeLast4("1234", "12345678")).toBe(false);
    });

    it("should return false when query is not exactly 4 digits", () => {
      expect(matchesBarcodeLast4("123", "885000123")).toBe(false);
      expect(matchesBarcodeLast4("12345", "88500012345")).toBe(false);
      expect(matchesBarcodeLast4("เป๊ปซี่", "8850001234")).toBe(false);
      expect(matchesBarcodeLast4("ABCD", "885000ABCD")).toBe(false);
      expect(matchesBarcodeLast4("", "8850001234")).toBe(false);
    });

    it("should fallback to SKU if barcode is not set or empty", () => {
      expect(matchesBarcodeLast4("1234", "", "PROD-1234")).toBe(true);
      expect(matchesBarcodeLast4("1234", "-", "SKU-90001234")).toBe(true);
      expect(matchesBarcodeLast4("1234", "null", "PROD-1234")).toBe(true);
      expect(matchesBarcodeLast4("1234", "", "PROD-1234-X")).toBe(false);
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

