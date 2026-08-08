/**
 * Returns clean exact barcode string or SKU without modifying digits
 */
export function to8DigitBarcode(rawBarcode?: string, sku?: string): string {
  const code = (rawBarcode || "").trim();
  if (code && code !== "TRF" && !code.startsWith("TRF-")) {
    return code;
  }
  const s = (sku || "").trim();
  if (s && s !== "TRF" && !s.startsWith("TRF-")) {
    return s;
  }
  return "";
}

/**
 * Normalizes barcode string by trimming, converting to lowercase and removing spaces/special separators (#, -, _)
 */
export function normalizeBarcode(code?: string): string {
  if (!code) return "";
  return code.trim().toLowerCase().replace(/[\s\-_#]/g, "");
}

/**
 * Strict exact barcode matcher supporting full 13-digit EAN, 8-digit, SKU and Product IDs.
 */
export function areBarcodesMatching(
  scannedInput?: string,
  targetList?: Array<string | undefined>
): boolean {
  if (!scannedInput || !targetList || targetList.length === 0) return false;

  const scannedClean = normalizeBarcode(scannedInput);
  if (!scannedClean) return false;

  for (const rawTarget of targetList) {
    if (!rawTarget) continue;
    const targetClean = normalizeBarcode(rawTarget);
    if (!targetClean || targetClean === "trf" || targetClean.startsWith("trf")) continue;

    // 1. Direct exact clean match
    if (scannedClean === targetClean) return true;

    // 2. Direct SKU / Product ID match without 'prod' prefix
    if (scannedClean === targetClean.replace(/^prod/, "") || targetClean === scannedClean.replace(/^prod/, "")) return true;
  }

  return false;
}
