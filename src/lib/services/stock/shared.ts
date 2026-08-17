import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Location, Warehouse, StockSummary } from "@/types/models";

export interface StockUseCaseDeps {
  repo: IStockRepository;
}

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

export async function findWarehouse(repo: IStockRepository, warehouseId: string) {
  let warehouse = await repo.warehouses.findById(warehouseId);
  if (!warehouse) {
    warehouse = await repo.warehouses.findByCode(warehouseId);
  }
  if (!warehouse) {
    const all = await repo.warehouses.findAll();
    warehouse =
      all.find(
        (w: Warehouse) =>
          w.warehouse_id.toLowerCase() === warehouseId.toLowerCase() ||
          w.warehouse_code?.toLowerCase() === warehouseId.toLowerCase() ||
          w.warehouse_name.toLowerCase() === warehouseId.toLowerCase()
      ) || null;
  }
  return warehouse;
}

export interface StockBalanceEntry {
  warehouse_id: string;
  warehouse_name: string;
  location_id: string;
  location_name: string;
  quantity: number;
}

export interface ProductStockBalance {
  product_id: string;
  sku: string;
  barcode: string;
  product_name: string;
  category: string;
  base_unit: string;
  minimum_stock: number;
  total_quantity: number;
  status: "NORMAL" | "LOW" | "OUT" | "NEGATIVE";
  by_warehouse: StockBalanceEntry[];
}

export async function getStockBalances(
  deps: StockUseCaseDeps,
  warehouseId?: string
): Promise<ProductStockBalance[]> {
  const [rawProducts, rawSummaries, rawWarehouses, rawLocations] = await Promise.all([
    deps.repo.products.findAll().catch(() => []),
    deps.repo.stockSummary.findAll(warehouseId).catch(() => []),
    deps.repo.warehouses.findAll().catch(() => []),
    deps.repo.locations.findAll(warehouseId).catch(() => []),
  ]);

  const products = Array.isArray(rawProducts) ? rawProducts : [];
  const summaries = Array.isArray(rawSummaries) ? rawSummaries : [];
  const warehouses = Array.isArray(rawWarehouses) ? rawWarehouses : [];
  const locations = Array.isArray(rawLocations) ? rawLocations : [];

  const whMap = new Map<string, string>();
  for (const w of warehouses) {
    if (w && w.warehouse_id) whMap.set(w.warehouse_id, w.warehouse_name || w.warehouse_id);
  }

  const locMap = new Map<string, string>();
  for (const l of locations) {
    if (l && l.location_id) locMap.set(l.location_id, l.location_name || l.location_code || l.location_id);
  }

  const balances: ProductStockBalance[] = [];

  for (const product of products) {
    if (!product || !product.product_id) continue;
    const productSummaries = summaries.filter((s: StockSummary) => s && s.product_id === product.product_id);

    const by_warehouse: StockBalanceEntry[] = productSummaries.map((s: StockSummary) => ({
      warehouse_id: s.warehouse_id || "",
      warehouse_name: whMap.get(s.warehouse_id) || s.warehouse_id || "",
      location_id: s.location_id || "",
      location_name: locMap.get(s.location_id) || s.location_id || "",
      quantity: Number(s.quantity) || 0,
    }));

    const total_quantity = by_warehouse.reduce((sum: number, entry: StockBalanceEntry) => sum + (Number(entry.quantity) || 0), 0);
    const minStock = Number(product.minimum_stock) || 0;

    let status: "NORMAL" | "LOW" | "OUT" | "NEGATIVE" = "NORMAL";
    if (total_quantity < 0) {
      status = "NEGATIVE";
    } else if (total_quantity === 0) {
      status = "OUT";
    } else if (total_quantity <= minStock) {
      status = "LOW";
    }

    balances.push({
      product_id: product.product_id,
      sku: product.sku || "",
      barcode: product.barcode || product.sku || "",
      product_name: product.product_name || product.sku || "",
      category: product.category || "ทั่วไป",
      base_unit: product.base_unit || "ชิ้น",
      minimum_stock: minStock,
      total_quantity,
      status,
      by_warehouse,
    });
  }

  return balances;
}
