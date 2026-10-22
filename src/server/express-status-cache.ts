import type { ExpressSyncStatusValue } from "@/lib/express-status-utils";

export interface ExpressStatusEntry {
  status: ExpressSyncStatusValue;
  type: string;
  updated_at: string;
  document_no: string;
  sku?: string;
}

const cache = globalThis as unknown as { expressStatusMap?: Map<string, ExpressStatusEntry> };
export const expressStatusMap = cache.expressStatusMap || (cache.expressStatusMap = new Map<string, ExpressStatusEntry>());
