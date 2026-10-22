export interface ProductionBomMaterial {
  item_id: number;
  product_id: string;
  sku: string;
  name: string;
  barcode: string;
  qty: number;
  unit: string;
  stock_unit: string;
  warehouse_id: string;
  is_primary: number;
  role_confirmed?: boolean;
  waste_percentage: number;
}

export interface ProductionBomFormula {
  bom_id: string;
  product_id: string;
  sku: string;
  name: string;
  label: string;
  unit: string;
  stock_unit: string;
  base_qty: number;
  items: ProductionBomMaterial[];
  revision?: string;
}

/** Each factor means stock units per one recipe unit, explicitly supplied for mismatches. */
export interface ProductionBomSelection {
  bom_id: string;
  fg_factor?: number;
  material_factors?: Record<string, number>;
  material_roles?: Record<string, 0 | 1>;
  revision?: string;
  all_materials_confirmed?: boolean;
}

export interface ProductionCapacity {
  product_id: string;
  bom_id: string;
  quantity: number | null;
  unit: string;
}

export interface ProductionMaterialRequirement extends ProductionBomMaterial {
  recipe_qty: number;
  stock_qty: number | null;
  factor: number | null;
  on_hand?: number;
  reserved?: number;
  available?: number;
  shortage?: number;
}

export interface ProductionBomPreview {
  formula: ProductionBomFormula;
  target_qty: number;
  fg_factor: number | null;
  finished_stock_qty: number | null;
  materials: ProductionMaterialRequirement[];
  issues: string[];
  main_capacity?: number | null;
}

export interface ProductionMaterialStockLocation {
  product_id: string;
  location_id: string;
  location_code: string;
  location_name: string;
  quantity: number;
}

export interface ProductionMaterialPlan {
  snapshot: ProductionBomFormula;
  selection: ProductionBomSelection;
  /** Current warehouse 2 stock, read separately from the frozen recipe. */
  stock_locations?: ProductionMaterialStockLocation[];
  parent_job_no?: string;
  backorder_job_no?: string;
}

export interface ProductionMaterialActual {
  item_id: number;
  /** Includes materials consumed by defective finished units. */
  used_qty: number;
  /** Additional component waste before assembly, excluded from used_qty. */
  scrap_qty: number;
  scrap_cause: string;
}
