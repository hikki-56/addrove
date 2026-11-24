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

export interface CountReferenceFile { id: number; file_name: string; row_count: number; unmatched_count?: number }
export interface CountReferenceRow { row: number; code: string; shelf: string; quantity: number; warehouse?: string; barcode?: string }
export interface ProductComparison {
  hasReference: boolean;
  shelves: { shelf_code: string; expected_qty: number | null; counted_qty: number | null }[];
}
export interface DailyCountReport {
  entries: CountReportEntry[];
  reference: CountReferenceFile | null;
  totals: (CountProduct & { expected: number | null; counted: number | null })[];
}
