export function normalizeWhId(v: string): string {
  return (v || "").trim().toLowerCase().replace(/^wh-0*(\d+)$/, "wh-$1");
}

/** Keep the full catalogue code when a scanner formats an internal label as GS1. */
export function normalizeReceiveScanCode(value: string): string {
  // AIM identifiers describe the barcode format and are not part of its payload.
  const code = value.trim().replace(/^\]C[01]/, "").trim();

  // Existing eight-digit internal labels contain FNC1 + 90xxxxxx. Readers may
  // display AI 90 as (90); retain both 90 and every zero in the catalogue code.
  const internalCode = code.match(/^\(90\)(\d{6})$/);
  return internalCode ? `90${internalCode[1]}` : code;
}
