import { v4 as uuidv4 } from "uuid";
import {
  readSheet,
  appendRows,
  updateRow,
  SHEETS,
  parseBoolean,
  formatBoolean,
} from "@/lib/google-sheets/client";
import type { IProductRepository } from "../interfaces";
import type { Product } from "@/types/models";
import type { CreateProductInput, UpdateProductInput } from "@/types/api";

// Columns: product_id, sku, barcode, product_name, category, base_unit, minimum_stock, description, active, created_at, updated_at
function rowToProduct(row: string[]): Product {
  return {
    product_id: row[0] ?? "",
    sku: row[1] ?? "",
    barcode: row[2] ?? "",
    product_name: row[3] ?? "",
    category: row[4] ?? "",
    base_unit: row[5] ?? "",
    minimum_stock: parseFloat(row[6] ?? "0") || 0,
    description: row[7] ?? "",
    active: parseBoolean(row[8]),
    created_at: row[9] ?? "",
    updated_at: row[10] ?? "",
  };
}

function productToRow(p: Product): (string | number | boolean)[] {
  return [
    p.product_id,
    p.sku,
    p.barcode,
    p.product_name,
    p.category,
    p.base_unit,
    p.minimum_stock,
    p.description,
    formatBoolean(p.active),
    p.created_at,
    p.updated_at,
  ];
}

export class SheetsProductRepository implements IProductRepository {
  private async getAllRows(): Promise<string[][]> {
    return readSheet(SHEETS.PRODUCTS, "A2:K");
  }

  async findAll(opts?: { activeOnly?: boolean }): Promise<Product[]> {
    const rows = await this.getAllRows();
    const products = rows.filter((r) => r[0]).map(rowToProduct);
    return opts?.activeOnly ? products.filter((p) => p.active) : products;
  }

  async findById(id: string): Promise<Product | null> {
    const rows = await this.getAllRows();
    const row = rows.find((r) => r[0] === id);
    return row ? rowToProduct(row) : null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    const rows = await this.getAllRows();
    const row = rows.find((r) => r[1] === sku);
    return row ? rowToProduct(row) : null;
  }

  async findByBarcode(barcode: string): Promise<Product | null> {
    const rows = await this.getAllRows();
    const row = rows.find((r) => r[2] === barcode);
    return row ? rowToProduct(row) : null;
  }

  async create(input: CreateProductInput): Promise<Product> {
    const now = new Date().toISOString();
    const product: Product = {
      product_id: uuidv4(),
      sku: input.sku,
      barcode: input.barcode,
      product_name: input.product_name,
      category: input.category,
      base_unit: input.base_unit,
      minimum_stock: input.minimum_stock,
      description: input.description,
      active: true,
      created_at: now,
      updated_at: now,
    };
    await appendRows(SHEETS.PRODUCTS, [productToRow(product)]);
    return product;
  }

  async update(id: string, input: UpdateProductInput): Promise<Product | null> {
    const rows = await this.getAllRows();
    const idx = rows.findIndex((r) => r[0] === id);
    if (idx === -1) return null;
    const product = rowToProduct(rows[idx]);
    const updated: Product = {
      ...product,
      ...input,
      product_id: product.product_id,
      updated_at: new Date().toISOString(),
    };
    await updateRow(SHEETS.PRODUCTS, idx + 2, productToRow(updated));
    return updated;
  }

  async hasMovements(id: string): Promise<boolean> {
    const rows = await readSheet(SHEETS.STOCK_MOVEMENTS, "A2:K");
    return rows.some((r) => r[2] === id);
  }
}
