export interface EnrichedBomItem {
  rm_sku: string;
  rm_barcode: string;
  rm_name: string;
  rm_wh: string;
  is_primary?: number; // 1 = ตัวหลัก, 0 = ตัวรอง
  rm_qty_required: number;
  rm_unit: string;
  waste_percentage: number;
  note: string;
  available_wh2_qty?: number;
  possible_units?: number;
}

export interface EnrichedBomFormula {
  bom_id: string;
  fg_sku: string;
  fg_barcode: string;
  fg_name: string;
  fg_unit: string;
  base_qty: number;
  active: boolean;
  image: string;
  maxProducible: number;
  has_primary_designated?: boolean;
  primary_items?: Array<{ rm_sku: string; rm_name: string }>;
  fg_wh2_stock?: number;
  // หน้า list ได้แค่หัวสูตร + จำนวนสรุป — items จะดึงภายหลังผ่าน ?sku= (lazy)
  items?: EnrichedBomItem[];
  item_count?: number;
  primary_count?: number;
}

export interface CartItem {
  bom: EnrichedBomFormula;
  quantity: number;
  /** โต๊ะผลิตที่รายการนี้ถูกจัดให้ (1–5) */
  table_no: number;
}

export interface ConsumedMaterial {
  rm_sku: string;
  rm_name: string;
  rm_unit: string;
  total_required: number;
  available_qty?: number;
  is_primary?: number;
}
