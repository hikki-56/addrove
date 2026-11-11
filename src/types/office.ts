import type { Location, Warehouse } from "@/types/models";

export interface OfficeProduct {
  product_id: string;
  sku: string;
  barcode: string;
  product_name: string;
  base_unit: string;
  quantity: number;
  location_id: string;
  location_code: string;
}

export interface OfficeSetup {
  warehouses: Warehouse[];
  office: Warehouse | null;
  locations: Location[];
}

export interface OfficeTransferLine {
  product_id: string;
  quantity: number;
  location_code: string;
}

export interface OfficeHistoryRow extends OfficeProduct {
  document_id: string;
  document_no: string;
  created_at: string;
  created_by_name: string;
  from_warehouse_id: string;
  from_warehouse_name: string;
}
