import type { Warehouse } from "@/types/models";

export function hasOfficeBarcode(barcode: string): boolean {
  return /^\d{13}$/.test(barcode.trim());
}

// The existing headquarters (K6) is the office warehouse. Planned locations
// remain separate; this feature only uses active locations in the master.
export function isOfficeWarehouse(warehouse: Warehouse): boolean {
  return /^wh-0?6$/i.test(warehouse.warehouse_id) || /^wh-?0?6$/i.test(warehouse.warehouse_code);
}

export function matchesOfficeSearch(item: { sku: string; barcode: string; product_name: string; location_code?: string }, search: string): boolean {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return true;
  const barcodeMatch = /^\d{4}$/.test(term) ? item.barcode.trim().endsWith(term) : item.barcode.includes(term);
  return barcodeMatch || [item.sku, item.product_name, item.location_code || ""]
    .some((value) => value.toLocaleLowerCase().includes(term));
}
