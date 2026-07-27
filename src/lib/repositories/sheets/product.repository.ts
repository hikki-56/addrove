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

function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const clean = val.replace(/,/g, "").trim();
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

// Support both Thai header format (8 columns) and English schema format (11 columns)
function rowToProduct(row: string[], idx: number = 0): Product | null {
  if (!row || row.length === 0 || row.every(c => !c || !c.trim())) return null;
  if (row[0]?.trim() === "รหัสสินค้า" || row[0]?.trim() === "product_id") return null;

  // Check if row matches Thai Sheet layout: [รหัสสินค้า, ชื่อสินค้า, หมวดหมู่, หน่วย, สต็อกขั้นต่ำ, ตำแหน่ง, สร้างเมื่อ, อัปเดตเมื่อ]
  // In Thai layout, row[0] is SKU (e.g. AD01) and row[1] is Product Name (e.g. D8400 #AD-01 ก๊อกบอล)
  const isThaiLayout = Boolean(row[1] && (row[2] || row[3] || parseNumber(row[4]) > 0));

  if (isThaiLayout && (!row[8] || row[8] === "TRUE" || row[8] === "FALSE" || row[8] === "true" || row[8] === "false")) {
    const sku = row[0]?.trim() ?? "";
    const productName = row[1]?.trim() ?? "";
    const category = row[2]?.trim() ?? "";
    const baseUnit = row[3]?.trim() ?? "";
    const minStock = parseNumber(row[4]);
    const location = row[5]?.trim() ?? "";

    if (!sku && !productName) return null;

    return {
      product_id: sku ? `prod-${sku}` : `prod-gen-${idx}`,
      sku: sku || `SKU-${idx}`,
      barcode: "",
      product_name: productName || sku,
      category: category,
      base_unit: baseUnit || "ชิ้น",
      minimum_stock: minStock,
      description: location ? `ตำแหน่ง: ${location}` : "",
      active: true,
      created_at: row[6] ?? new Date().toISOString(),
      updated_at: row[7] ?? new Date().toISOString(),
    };
  }

  // Standard English layout: [product_id, sku, barcode, product_name, category, base_unit, minimum_stock, description, active, created_at, updated_at]
  return {
    product_id: row[0] ? row[0] : `prod-gen-${idx}-${row[1] || uuidv4()}`,
    sku: row[1] ?? row[0] ?? "",
    barcode: row[2] ?? "",
    product_name: row[3] ?? row[1] ?? "",
    category: row[4] ?? "",
    base_unit: row[5] ?? "",
    minimum_stock: parseNumber(row[6]),
    description: row[7] ?? "",
    active: parseBoolean(row[8] ?? "true"),
    created_at: row[9] ?? "",
    updated_at: row[10] ?? "",
  };
}

function productToRow(p: Product): (string | number | boolean)[] {
  // Write in Thai Sheet layout format matching Google Sheet columns
  return [
    p.sku,
    p.product_name,
    p.category,
    p.base_unit,
    p.minimum_stock,
    p.description.replace(/^ตำแหน่ง:\s*/, ""),
    p.created_at,
    p.updated_at,
  ];
}

export class SheetsProductRepository implements IProductRepository {
  private async getAllRows(): Promise<string[][]> {
    return readSheet(SHEETS.PRODUCTS, "A1:Z");
  }

  async findAll(opts?: { activeOnly?: boolean }): Promise<Product[]> {
    const rows = await this.getAllRows();
    const products = rows
      .map((r, idx) => rowToProduct(r, idx))
      .filter((p): p is Product => p !== null);
    return opts?.activeOnly ? products.filter((p) => p.active) : products;
  }

  async findById(id: string): Promise<Product | null> {
    const products = await this.findAll();
    return products.find((p) => p.product_id === id || p.sku === id) ?? null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    const products = await this.findAll();
    return products.find((p) => p.sku.toLowerCase() === sku.toLowerCase()) ?? null;
  }

  async findByBarcode(barcode: string): Promise<Product | null> {
    if (!barcode) return null;
    const products = await this.findAll();
    return products.find((p) => p.barcode === barcode) ?? null;
  }

  async create(input: CreateProductInput): Promise<Product> {
    const now = new Date().toISOString();
    const product: Product = {
      product_id: `prod-${input.sku}`,
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
    const idx = rows.findIndex((r) => r[0] === id || `prod-${r[0]}` === id);
    if (idx === -1) return null;
    const existing = rowToProduct(rows[idx], idx);
    if (!existing) return null;
    const updated: Product = {
      ...existing,
      ...input,
      updated_at: new Date().toISOString(),
    };
    await updateRow(SHEETS.PRODUCTS, idx + 1, productToRow(updated));
    return updated;
  }

  async hasMovements(id: string): Promise<boolean> {
    const rows = await readSheet(SHEETS.STOCK_MOVEMENTS, "A2:K");
    return rows.some((r) => r[2] === id);
  }
}
