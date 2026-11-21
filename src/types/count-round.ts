export interface CountProduct {
  product_id: string;
  sku: string;
  product_name: string;
  base_unit: string;
}

export interface ScannedCountProduct extends CountProduct {
  barcode: string;
}

export interface CountEntry extends CountProduct {
  request_id: string;
  shelf_code: string;
  quantity: number;
  counter_name: string;
  counted_at: string;
}

export interface CountReportEntry extends CountEntry {
  barcode: string | null;
}
