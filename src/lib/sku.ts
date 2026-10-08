// Shared SKU / location-code normalizers (deduped verbatim from services/stock/shared.ts and the
// private copies in repositories/sheets/{stock-movement,warehouse-sync}.repository.ts).
// NOTE: the comment on matchSku below says "exact SKU match, e.g. AD01 !== AD-01", but the code strips
// whitespace, "-" and "_" (so AD01 === AD-01). Behavior intentionally kept as-is; comment left verbatim.

// Helper: Normalize and compare SKUs (exact SKU match, e.g. AD01 !== AD-01)
export function matchSku(sku1?: string, sku2?: string): boolean {
  if (!sku1 || !sku2) return false;
  const s1 = sku1.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_]/g, "");
  const s2 = sku2.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_]/g, "");
  return s1 === s2;
}

export function cleanLocCode(loc?: string): string {
  if (!loc) return "";
  return loc
    .trim()
    .toLowerCase()
    .replace(/^loc-/, "")
    .replace(/^wh-0?[0-9]-?/, "")
    .replace(/^sh-/, "")
    .replace(/^slf-/, "")
    .replace(/[\s\-_]/g, "");
}

export function cleanSkuCode(sku?: string): string {
  if (!sku) return "";
  return sku
    .trim()
    .toLowerCase()
    .replace(/^prod-/, "")
    .replace(/[\s\-_]/g, "");
}

// Outbound SKU normalizer (deduped verbatim from services/outbound/{bill-import,work-order,packing,picking}.service.ts).
// NOT the same as cleanSkuCode: this one also strips "#" and does not accept undefined.
export function cleanSkuStripHash(v: string): string {
  return v.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_#]/g, "");
}
