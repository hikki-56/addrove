export function normalizeWhId(v: string): string {
  return (v || "").trim().toLowerCase().replace(/^wh-0*(\d+)$/, "wh-$1");
}
