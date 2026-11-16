import type { BomEditorFormula } from "@/lib/bom-editor";
import type { ProductionBomFormula } from "@/types/production-bom";

export interface BomCatalogProduct {
  product_id: string;
  sku: string;
  product_name: string;
  barcode: string;
  base_unit: string;
}

export interface BomManagementData {
  product: BomCatalogProduct;
  materials: BomCatalogProduct[];
  formulas: BomEditorFormula[];
  production_formulas: ProductionBomFormula[];
}
