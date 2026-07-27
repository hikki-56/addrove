import { readSheet, SHEETS } from "@/lib/google-sheets/client";
import { SheetsProductRepository } from "./product.repository";
import type { IDashboardRepository } from "../interfaces";
import type { DashboardStats, MovementWithDetails, MovementType } from "@/types/models";

function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const clean = val.replace(/,/g, "").trim();
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

export class SheetsDashboardRepository implements IDashboardRepository {
  async getStats(
    warehouseId?: string,
    days: number = 7
  ): Promise<DashboardStats> {
    const productRepo = new SheetsProductRepository();
    const [movRows, docRows, products, warehouseRows, locationRows, userRows, summaryRows] =
      await Promise.all([
        readSheet(SHEETS.STOCK_MOVEMENTS, "A2:J"),
        readSheet(SHEETS.DOCUMENTS, "A2:I"),
        productRepo.findAll({ activeOnly: true }),
        readSheet(SHEETS.WAREHOUSES, "A2:G"),
        readSheet(SHEETS.LOCATIONS, "A2:L"),
        readSheet(SHEETS.USERS, "A2:I"),
        readSheet(SHEETS.STOCK_SUMMARY, "A2:E"),
      ]);

    const docMap = new Map(docRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const productMap = new Map(products.map((p) => [p.product_id, p]));
    const warehouseMap = new Map(warehouseRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const locationMap = new Map(locationRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const userMap = new Map(userRows.filter((r) => r[0]).map((r) => [r[0], r]));

    const today = new Date().toISOString().slice(0, 10);

    // Filter movements by warehouse
    let filteredMov = movRows.filter((r) => r[0]);
    if (warehouseId) {
      filteredMov = filteredMov.filter((r) => r[3] === warehouseId);
    }

    // Summary stats from stock summary
    let summaries = summaryRows.filter((r) => r[0]);
    if (warehouseId) {
      summaries = summaries.filter((r) => r[1] === warehouseId);
    }

    // Product stats
    const productQtyMap = new Map<string, number>();
    for (const s of summaries) {
      const pid = s[0];
      const qty = parseNumber(s[3]);
      productQtyMap.set(pid, (productQtyMap.get(pid) ?? 0) + qty);
    }

    const total_sku = products.length;
    let total_quantity = 0;
    let low_stock_count = 0;
    let out_of_stock_count = 0;

    for (const p of products) {
      const qty = productQtyMap.get(p.product_id) ?? 0;
      total_quantity += qty;
      if (qty <= 0) out_of_stock_count++;
      else if (qty <= p.minimum_stock) low_stock_count++;
    }

    // Today stats
    const todayMov = filteredMov.filter((r) => r[9]?.startsWith(today));
    const received_today = todayMov
      .filter((r) => r[6] === "RECEIVE" || r[6] === "TRANSFER_IN")
      .reduce((s, r) => s + parseNumber(r[5]), 0);
    const issued_today = Math.abs(
      todayMov
        .filter((r) => r[6] === "ISSUE" || r[6] === "TRANSFER_OUT")
        .reduce((s, r) => s + parseNumber(r[5]), 0)
    );

    // Recent movements (last 10)
    const recent = filteredMov
      .sort((a, b) => b[9].localeCompare(a[9]))
      .slice(0, 10);

    const recent_movements: MovementWithDetails[] = recent.map((r) => {
      const doc = docMap.get(r[1]);
      const product = productMap.get(r[2]);
      const warehouse = warehouseMap.get(r[3]);
      const location = locationMap.get(r[4]);
      const user = userMap.get(r[8]);
      return {
        movement_id: r[0],
        document_id: r[1],
        product_id: r[2],
        warehouse_id: r[3],
        location_id: r[4],
        qty_change: parseNumber(r[5]),
        movement_type: r[6] as MovementType,
        idempotency_key: r[7],
        created_by: r[8],
        created_at: r[9],
        document_no: doc?.[1] ?? "",
        document_type: (doc?.[2] ?? "RECEIVE") as MovementWithDetails["document_type"],
        product_name: product?.product_name ?? "",
        sku: product?.sku ?? "",
        warehouse_name: warehouse?.[2] ?? "",
        location_code: location?.[7] ?? "",
        created_by_name: user?.[1] ?? r[8],
      };
    });

    // Chart data (last N days)
    const chart_data: DashboardStats["chart_data"] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayMov = filteredMov.filter((r) => r[9]?.startsWith(dateStr));
      const received = dayMov
        .filter((r) => r[6] === "RECEIVE" || r[6] === "TRANSFER_IN")
        .reduce((s, r) => s + parseNumber(r[5]), 0);
      const issued = Math.abs(
        dayMov
          .filter((r) => r[6] === "ISSUE" || r[6] === "TRANSFER_OUT")
          .reduce((s, r) => s + parseNumber(r[5]), 0)
      );
      chart_data.push({ date: dateStr, received, issued });
    }

    return {
      total_sku,
      total_quantity,
      low_stock_count,
      out_of_stock_count,
      received_today,
      issued_today,
      recent_movements,
      chart_data,
    };
  }
}
