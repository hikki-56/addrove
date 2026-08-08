/**
 * In-memory document status override store.
 * Provides instant 0ms consistency across API calls even if Google Sheets Edge API has CDN propagation delay.
 */

const globalForStatus = globalThis as unknown as {
  documentStatusStore?: Map<string, string>;
};

export const documentStatusStore =
  globalForStatus.documentStatusStore || new Map<string, string>();

if (process.env.NODE_ENV !== "production") {
  globalForStatus.documentStatusStore = documentStatusStore;
}

export function setDocumentStatus(docIdOrNo: string, status: string) {
  if (!docIdOrNo) return;
  documentStatusStore.set(docIdOrNo.trim().toUpperCase(), status.toUpperCase());
}

export function getDocumentStatus(docIdOrNo: string): string | undefined {
  if (!docIdOrNo) return undefined;
  return documentStatusStore.get(docIdOrNo.trim().toUpperCase());
}
