import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getRepository } from "@/lib/repositories";
import { CreateProductSchema } from "@/types/api";
import {
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  zodErrorResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { readSheet, SHEETS } from "@/lib/google-sheets/client";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get("active") === "true";
    const category = searchParams.get("category");
    const search = searchParams.get("search");
    const warehouseId = searchParams.get("warehouse_id");
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");

    const repo = getRepository();
    let products = await repo.products.findAll({ activeOnly });

    // Filter by Warehouse ID if specified
    if (warehouseId) {
      const [summaryRows, movRows] = await Promise.all([
        readSheet(SHEETS.STOCK_SUMMARY, "A2:E").catch(() => []),
        readSheet(SHEETS.STOCK_MOVEMENTS, "A2:K").catch(() => []),
      ]);

      const whProductIds = new Set<string>();

      for (const row of summaryRows) {
        if (row[1] === warehouseId) {
          whProductIds.add(row[0]);
        }
      }
      for (const row of movRows) {
        if (row[3] === warehouseId) {
          whProductIds.add(row[2]);
        }
      }

      if (warehouseId === "wh-1") {
        // If wh-1 selected, include default sheet products as well
        products = products.filter(
          (p) => whProductIds.size === 0 || whProductIds.has(p.product_id) || whProductIds.has(p.sku) || true
        );
      } else {
        // For wh-2, wh-3, wh-4, wh-5, filter only products that have stock or movements in this warehouse
        products = products.filter(
          (p) => whProductIds.has(p.product_id) || whProductIds.has(p.sku)
        );
      }
    }

    if (category) products = products.filter((p) => p.category === category);
    if (search) {
      const q = search.toLowerCase();
      products = products.filter(
        (p) =>
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q) ||
          p.product_name.toLowerCase().includes(q)
      );
    }

    const total = products.length;

    // If Server-side Pagination parameters are provided
    if (pageParam || limitParam) {
      const isAll = limitParam === "ALL";
      const page = Math.max(1, Number(pageParam || 1));
      const limit = isAll ? total || 1 : Math.max(1, Number(limitParam || 10));

      const startIndex = (page - 1) * limit;
      const paginatedItems = isAll ? products : products.slice(startIndex, startIndex + limit);

      return successResponse({
        items: paginatedItems,
        total,
        page,
        limit: isAll ? "ALL" : limit,
        totalPages: isAll ? 1 : Math.ceil(total / limit) || 1,
      }, "โหลดข้อมูลสินค้าสำเร็จ");
    }

    // Default response format for legacy callers
    return successResponse(products, "โหลดข้อมูลสินค้าสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return unauthorizedResponse();
    if (session.user.role === "VIEWER") return forbiddenResponse();
    const body = await req.json();
    const input = CreateProductSchema.parse(body);
    const repo = getRepository();
    const bySku = await repo.products.findBySku(input.sku);
    if (bySku) return errorResponse("SKU นี้มีอยู่ในระบบแล้ว");
    const byBarcode = await repo.products.findByBarcode(input.barcode);
    if (byBarcode) return errorResponse("Barcode นี้มีอยู่ในระบบแล้ว");
    const product = await repo.products.create(input);
    return successResponse(product, "เพิ่มสินค้าสำเร็จ", 201);
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
