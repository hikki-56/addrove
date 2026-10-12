import type { Product } from "@/types/models";

/** A short-lived snapshot per hook instance; never used to authorize stock movement. */
export function createTransferStockSnapshot(ttlMs = 10_000) {
  const entries = new Map<string, { expiresAt: number; promise: Promise<Product[]> }>();
  return {
    clear() { entries.clear(); },
    get(warehouseId: string): Promise<Product[]> {
      const cached = entries.get(warehouseId);
      if (cached && Date.now() < cached.expiresAt) return cached.promise;
      const entry = { expiresAt: Infinity, promise: Promise.resolve([] as Product[]) };
      entry.promise = (async () => {
        const response = await fetch(`/api/products?warehouse_id=${encodeURIComponent(warehouseId)}`);
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error("โหลดสต็อกต้นทางไม่สำเร็จ กรุณาลองสแกนอีกครั้ง");
        const items = Array.isArray(json.data) ? json.data : json.data?.items;
        if (!Array.isArray(items)) throw new Error("ข้อมูลสต็อกต้นทางไม่ถูกต้อง กรุณาลองอีกครั้ง");
        entry.expiresAt = Date.now() + ttlMs;
        return items as Product[];
      })().catch((error) => {
        if (entries.get(warehouseId) === entry) entries.delete(warehouseId);
        throw error;
      });
      entries.set(warehouseId, entry);
      return entry.promise;
    },
  };
}
