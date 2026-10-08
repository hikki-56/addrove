// Shared id helper (deduped verbatim from 8 copies in src/server/repositories/sheets/*.repository.ts).
// Keeps its own fallback when crypto.randomUUID is unavailable.
export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
