import type { Product } from "@/types/models";
import type { CreateProductInput, UpdateProductInput } from "@/types/api";

export interface IProductRepository {
  findAll(opts?: { activeOnly?: boolean }): Promise<Product[]>;
  findById(id: string): Promise<Product | null>;
  findBySku(sku: string): Promise<Product | null>;
  findByBarcode(barcode: string): Promise<Product | null>;
  create(input: CreateProductInput): Promise<Product>;
  update(id: string, input: UpdateProductInput): Promise<Product | null>;
  hasMovements(id: string): Promise<boolean>;
}
