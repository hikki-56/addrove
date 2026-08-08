import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { CreateProductSchema } from "@/types/api";
import {
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  hasWarehouseAccess,
  zodErrorResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { readSheet, appendRows, SHEETS, getWarehouseSheetName, clearSheetCache } from "@/lib/google-sheets/client";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get("active") === "true";
    const category = searchParams.get("category");
    const search = searchParams.get("search");
    const warehouseId = searchParams.get("warehouse_id");
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");
    const masterOnly = searchParams.get("master_only") === "true" || searchParams.get("source") === "master";
    const noCache = searchParams.has("_t"); // bust cache when _t param is present
    if (
      warehouseId &&
      session.user.role !== "ADMIN" &&
      !hasWarehouseAccess(session.user.warehouse_access, warehouseId)
    ) {
      return forbiddenResponse("คุณไม่มีสิทธิ์ดูสินค้าในโกดังนี้");
    }

    // If cache-busting param is present, clear all sheet cache
    if (noCache) {
      clearSheetCache();
    }

    const repo = getRepository();
    let products: any[] = [];

    const masterProducts = await repo.products.findAll({ activeOnly: false }).catch(() => []);
    const masterMap = new Map<string, any>();
    masterProducts.forEach((mp) => {
      if (mp.sku) masterMap.set(mp.sku.toLowerCase(), mp);
      if (mp.product_id) masterMap.set(mp.product_id.toLowerCase(), mp);
    });

    const readWarehouseProducts = async (whId: string, sheetName: string) => {
      const rows = await readSheet(sheetName, "A2:Z").catch(() => []);
      if (!rows || rows.length === 0) return [];
      const list: any[] = [];
      const seen = new Set<string>();

      rows.forEach((r) => {
        if (!r || r.length === 0 || !r[0] || !r[0].trim()) return;
        const sku = r[0].trim();
        if (sku === "รหัสสินค้า" || sku === "product_id" || sku === "SKU" || sku === "Code") return;

        const master = masterMap.get(sku.toLowerCase()) || masterMap.get(`prod-${sku}`.toLowerCase());

        let qtyVal = 0;
        for (let col = 3; col < r.length; col++) {
          const cell = (r[col] ?? "").replace(/,/g, "").trim();
          if (/^\d+(\.\d+)?$/.test(cell)) {
            qtyVal = parseFloat(cell);
            break;
          }
        }

        const is9Col = r.length >= 6;
        const rawCol2 = r[2]?.trim() || "";
        const rawCol3 = r[3]?.trim() || "";

        let nameVal = master?.product_name || "";
        let categoryVal = master?.category || "";

        if (!nameVal || !categoryVal) {
          const knownCategories = ["สินค้าสำเร็จรูป", "สายน้ำดีและสายถัก", "ทั่วไป", "ก๊อกน้ำ", "อุปกรณ์", "อะไหล่", "ท่อ", "วาล์ว"];
          const isCol2Category = knownCategories.some((c) => rawCol2.includes(c));
          const isCol3Category = knownCategories.some((c) => rawCol3.includes(c));

          if (isCol2Category && !isCol3Category) {
            categoryVal = rawCol2;
            nameVal = rawCol3 || sku;
          } else {
            nameVal = rawCol2 || sku;
            categoryVal = rawCol3 || "ทั่วไป";
          }
        }

        const barcodeVal = (r[1] && r[1].trim() !== sku ? r[1].trim() : master?.barcode) || sku;
        const unitVal = is9Col ? (r[4]?.trim() || master?.base_unit || "ชิ้น") : (r[3]?.trim() || "ชิ้น");
        const minStockVal = is9Col ? (parseFloat((r[5] ?? "").replace(/,/g, "").trim()) || 0) : qtyVal;

        // Skip rows with 0 quantity
        if (minStockVal <= 0) return;

        const locationVal = is9Col ? (r[6]?.trim() || "") : "";
        const supplierVal = is9Col ? (r[7]?.trim() || master?.supplier || "") : (master?.supplier || "");

        const rowKey = `${whId}_${sku}_${locationVal}`.toLowerCase();
        if (seen.has(rowKey)) return;
        seen.add(rowKey);

        list.push({
          product_id: master?.product_id || `prod-${sku}`,
          sku: master?.sku || sku,
          barcode: barcodeVal,
          product_name: nameVal,
          category: categoryVal,
          base_unit: unitVal,
          minimum_stock: minStockVal,
          quantity: qtyVal,
          location: locationVal,
          warehouse_id: whId,
          supplier: supplierVal,
          description: supplierVal ? `ผู้จำหน่าย: ${supplierVal}` : "",
          active: true,
          created_at: master?.created_at || new Date().toISOString(),
          updated_at: master?.updated_at || new Date().toISOString(),
        });
      });
      return list;
    };

    // Read all 5 warehouse tabs in parallel to compute total stock across all warehouses per SKU
    const warehouseTabs = [
      { id: "wh-1", sheet: "โกดัง1" },
      { id: "wh-2", sheet: "โกดัง2" },
      { id: "wh-3", sheet: "โกดัง3" },
      { id: "wh-4", sheet: "โกดัง4" },
      { id: "wh-5", sheet: "โกดัง5" },
    ].filter((tab) =>
      session.user.role === "ADMIN" || hasWarehouseAccess(session.user.warehouse_access, tab.id)
    );

    const warehouseResults = await Promise.all(
      warehouseTabs.map((t) => readWarehouseProducts(t.id, t.sheet))
    );
    const allWarehouseProducts = warehouseResults.flat();

    // Map normalized SKU -> Total stock quantity summed across ALL warehouses
    const totalStockMap = new Map<string, number>();
    // Map normalized SKU -> Array of location entries across all warehouses
    const locationBreakdownMap = new Map<string, Array<{
      warehouse_id: string;
      warehouse_name: string;
      location: string;
      quantity: number;
    }>>();

    allWarehouseProducts.forEach((p) => {
      const skuKey = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
      const qty = Number(p.quantity ?? p.minimum_stock ?? 0);
      totalStockMap.set(skuKey, (totalStockMap.get(skuKey) || 0) + qty);

      const whId = (p as any).warehouse_id || "wh-1";
      const whName =
        whId === "wh-1" ? "โกดัง 1" :
        whId === "wh-2" ? "โกดัง 2" :
        whId === "wh-3" ? "โกดัง 3" :
        whId === "wh-4" ? "โกดัง 4" :
        whId === "wh-5" ? "โกดัง 5" : `โกดัง ${whId.replace(/^wh-/, "")}`;

      const loc = p.location && p.location.trim() !== "" && p.location.trim() !== "-" ? p.location.trim() : "-";

      if (!locationBreakdownMap.has(skuKey)) {
        locationBreakdownMap.set(skuKey, []);
      }
      locationBreakdownMap.get(skuKey)!.push({
        warehouse_id: whId,
        warehouse_name: whName,
        location: loc,
        quantity: qty,
      });
    });

    const deduplicateBySku = (rawList: any[]) => {
      const skuSeen = new Set<string>();
      const consolidated: any[] = [];

      rawList.forEach((p) => {
        const skuKey = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
        if (!skuSeen.has(skuKey)) {
          skuSeen.add(skuKey);
          const totalQty = totalStockMap.get(skuKey) ?? Number(p.quantity ?? p.minimum_stock ?? 0);
          const breakdowns = locationBreakdownMap.get(skuKey) || [];

          consolidated.push({
            ...p,
            total_quantity: totalQty,
            minimum_stock: totalQty,
            locations_breakdown: breakdowns,
          });
        }
      });
      return consolidated;
    };

    if (masterOnly) {
      products = deduplicateBySku(masterProducts);
    } else if (warehouseId) {
      const targetSheet = getWarehouseSheetName(warehouseId);
      const rawWhProds = await readWarehouseProducts(warehouseId, targetSheet);
      products = deduplicateBySku(rawWhProds);
    } else {
      const rawAll = allWarehouseProducts.length > 0 ? allWarehouseProducts : masterProducts;
      products = deduplicateBySku(rawAll);
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
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    if (session.user.role === "VIEWER") return forbiddenResponse();
    const body = await req.json();
    const input = CreateProductSchema.parse(body);
    const repo = getRepository();
    // Do not save to PRODUCTS tab. Save strictly to target warehouse tab (e.g. โกดัง1, โกดัง2, โกดัง3, โกดัง4, โกดัง5)
    const product = {
      product_id: `prod-${input.sku}`,
      sku: input.sku,
      barcode: input.barcode || "",
      product_name: input.product_name,
      category: input.category || "ทั่วไป",
      base_unit: input.base_unit || "ชิ้น",
      minimum_stock: input.minimum_stock || 0,
      description: input.description || "",
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: session.user.id,
      created_by_name: session.user.name,
    };

    const warehouseId = input.warehouse_id || "wh-1";
    if (
      session.user.role !== "ADMIN" &&
      !hasWarehouseAccess(session.user.warehouse_access, warehouseId)
    ) {
      return forbiddenResponse("คุณไม่มีสิทธิ์เพิ่มสินค้าในโกดังนี้");
    }
    const targetSheet = getWarehouseSheetName(warehouseId);
    const now = new Date().toISOString();
    const initialQty = input.initial_quantity || 1;

    const rowItem = [
      product.sku,
      product.barcode || product.sku,
      product.product_name,
      product.category,
      product.base_unit,
      initialQty,
      "14A1",
      product.description || "เพิ่มสินค้าใหม่",
      now,
    ];

    if (session.user.role !== "ADMIN") {
      // Non-admin Staff additions must go to DOCUMENTS tab as PENDING for Admin approval
      const docId = `doc-${Date.now()}`;
      const docNo = `REC-${Date.now().toString().slice(-6)}`;
      const pendingPayload = JSON.stringify({
        warehouse_id: warehouseId,
        target_sheet: targetSheet,
        rows: [rowItem],
      });

      await appendRows(SHEETS.DOCUMENTS, [
        [
          docId,
          docNo,
          "RECEIVE",
          warehouseId,
          now.slice(0, 10),
          "PENDING",
          pendingPayload,
          session.user.name || session.user.id || "Staff",
          now,
        ],
      ]);
    } else {
      // Admin directly appends to warehouse sheet tab
      await appendRows(targetSheet, [rowItem]);
    }

    return successResponse(
      product,
      session.user.role === "ADMIN"
        ? "บันทึกรายการสินค้าแล้ว"
        : "บันทึกรายการสินค้าแล้ว (รอ Admin อนุมัติ)",
      201
    );
  } catch (e) {
    if (e instanceof ZodError) return zodErrorResponse(e);
    return serverErrorResponse(e);
  }
}
