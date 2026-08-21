import {
  readSheet,
  appendRows,
  updateRow,
  SHEETS,
} from "@/lib/google-sheets/client";
import type { IProductRepository } from "../interfaces";
import type { Product } from "@/types/models";
import type { CreateProductInput, UpdateProductInput } from "@/types/api";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function rowToProduct(row: string[], idx: number = 0): Product | null {
  if (!row || row.length === 0 || row.every((c) => !c || !c.trim())) return null;
  const col0 = row[0]?.trim() ?? "";
  const col1 = row[1]?.trim() ?? "";
  const col2 = row[2]?.trim() ?? "";

  // Skip header rows
  if (
    col0 === "ลำดับ" ||
    col0 === "รหัสสินค้า" ||
    col0 === "product_id" ||
    col0 === "SKU" ||
    col2 === "รหัสสินค้า" ||
    col2 === "SKU"
  ) {
    return null;
  }

  let sku = "";
  let barcode = "";
  let productName = "";
  let category = "ทั่วไป";
  let baseUnit = "ชิ้น";
  let supplier = "";

  // Detect New 7-Column Layout: [0:ลำดับ, 1:ผู้จัดจำหน่าย, 2:รหัสสินค้า, 3:รหัสนำหน้า 4 หลัก, 4:รายละเอียด, 5:หมวดสินค้า, 6:บาร์โค้ด]
  const is7ColLayout =
    row.length >= 7 &&
    col0 !== "" &&
    !isNaN(Number(col0)) &&
    Number(col0) < 10000 &&
    (row[3]?.trim() === col2.slice(0, 4) || (col2 !== "" && row[4]?.trim() !== ""));

  if (is7ColLayout) {
    supplier = col1;
    sku = col2 || col0;
    productName = row[4]?.trim() || sku;
    category = row[5]?.trim() || "ทั่วไป";
    barcode = row[6]?.trim() || sku;
  } else if (row.length >= 4) {
    // Standard/Legacy layout: [0:รหัสสินค้า/SKU, 1:บาร์โค้ด, 2:ชื่อสินค้า/รายละเอียด, 3:หมวดหมู่, 4:หน่วยนับ, 5:สต็อกขั้นต่ำ, 6:ตำแหน่ง, 7:ผู้จัดจำหน่าย]
    sku = col0 || `SKU-${idx}`;
    barcode = col1 && col1 !== "-" ? col1 : sku;
    productName = col2 || sku;
    category = row[3]?.trim() || "ทั่วไป";
    baseUnit = row[4]?.trim() || "ชิ้น";
    supplier = row[7]?.trim() ?? "";
  } else {
    sku = col0 || `SKU-${idx}`;
    barcode = col0 || `SKU-${idx}`;
    productName = col1 || sku;
    category = col2 || "ทั่วไป";
    baseUnit = row[3]?.trim() || "ชิ้น";
  }

  if (!sku && !productName) return null;

  return {
    product_id: `prod-${sku}`,
    sku: sku,
    barcode: barcode || sku,
    product_name: productName,
    category: category || "ทั่วไป",
    base_unit: baseUnit || "ชิ้น",
    minimum_stock: 0,
    supplier: supplier,
    description: supplier ? `ผู้จำหน่าย: ${supplier}` : "",
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function productToRow(p: Product, seqNum: number = 1): (string | number | boolean)[] {
  // New PRODUCTS sheet layout: [ลำดับ, ผู้จัดจำหน่าย, รหัสสินค้า, รหัสนำหน้า 4 หลัก, รายละเอียด, หมวดสินค้า, บาร์โค้ด]
  const prefix4 = p.sku.slice(0, 4);
  return [
    seqNum,
    p.supplier || "",
    p.sku,
    prefix4,
    p.product_name,
    p.category || "ทั่วไป",
    p.barcode || p.sku,
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

    // Deduplicate duplicate product entries by product_id to ensure unique React keys
    const seen = new Set<string>();
    const uniqueProducts: Product[] = [];
    for (const p of products) {
      if (!seen.has(p.product_id)) {
        seen.add(p.product_id);
        uniqueProducts.push(p);
      }
    }

    return opts?.activeOnly ? uniqueProducts.filter((p) => p.active) : uniqueProducts;
  }

  async findById(id: string): Promise<Product | null> {
    const products = await this.findAll();
    if (!id) return null;
    const cleanId = id.trim().toLowerCase();
    const rawSku = cleanId.replace(/^prod-/, "");
    return (
      products.find(
        (p) =>
          p.product_id.toLowerCase() === cleanId ||
          p.sku.toLowerCase() === cleanId ||
          p.sku.toLowerCase() === rawSku ||
          p.product_id.toLowerCase() === `prod-${rawSku}` ||
          (p.barcode && p.barcode.trim().toLowerCase() === cleanId) ||
          (p.barcode && p.barcode.trim().toLowerCase() === rawSku) ||
          p.sku.toLowerCase().replace(/[\s\-_#]/g, "") === rawSku.replace(/[\s\-_#]/g, "")
      ) ?? null
    );
  }

  async findBySku(sku: string): Promise<Product | null> {
    const products = await this.findAll();
    return products.find((p) => p.sku.toLowerCase() === sku.toLowerCase()) ?? null;
  }

  async findByBarcode(barcode: string): Promise<Product | null> {
    if (!barcode) return null;
    const cleanBarcode = barcode.trim().toLowerCase();
    const products = await this.findAll();
    return (
      products.find(
        (p) =>
          (p.barcode && p.barcode.trim().toLowerCase() === cleanBarcode) ||
          p.sku.toLowerCase() === cleanBarcode ||
          p.product_id.toLowerCase() === cleanBarcode ||
          p.product_id.toLowerCase() === `prod-${cleanBarcode}`
      ) ?? null
    );
  }

  async create(input: CreateProductInput): Promise<Product> {
    const now = new Date().toISOString();
    const rows = await this.getAllRows();
    const seqNum = rows.length > 0 ? rows.length : 1;

    const product: Product = {
      product_id: `prod-${generateUuid()}`,
      sku: input.sku.trim(),
      barcode: input.barcode,
      product_name: input.product_name,
      category: input.category,
      base_unit: input.base_unit,
      minimum_stock: input.minimum_stock,
      description: input.description,
      supplier: input.supplier || "",
      active: true,
      created_at: now,
      updated_at: now,
    };
    await appendRows(SHEETS.PRODUCTS, [productToRow(product, seqNum)]);
    return product;
  }

  async update(id: string, input: UpdateProductInput): Promise<Product | null> {
    const rows = await this.getAllRows();
    const cleanId = id.trim().toLowerCase().replace(/^prod-/, "");
    const idx = rows.findIndex((r) => {
      const sku = (r[2] || r[0] || "").trim().toLowerCase().replace(/^prod-/, "");
      return sku === cleanId;
    });
    if (idx === -1) return null;
    const existing = rowToProduct(rows[idx], idx);
    if (!existing) return null;
    const updated: Product = {
      ...existing,
      ...input,
      updated_at: new Date().toISOString(),
    };
    await updateRow(SHEETS.PRODUCTS, idx + 1, productToRow(updated, idx + 1));
    return updated;
  }

  async hasMovements(id: string): Promise<boolean> {
    const rows = await readSheet(SHEETS.STOCK_MOVEMENTS, "A2:K");
    return rows.some((r) => r[2] === id);
  }
}
