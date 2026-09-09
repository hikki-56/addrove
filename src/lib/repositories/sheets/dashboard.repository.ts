import {
  readSheet,
  SHEETS,
  getWarehouseSheetName,
  getSheetReadError,
} from "@/lib/google-sheets/client";
import { SheetsProductRepository } from "./product.repository";
import { cleanSkuCode } from "@/lib/services/stock/shared";
import { aggregateDashboardOperations } from "@/lib/dashboard/dashboard-aggregation";
import type { IDashboardRepository } from "../interfaces";
import type {
  DashboardStats,
  Document,
  MovementWithDetails,
  MovementType,
  StockMovement,
  User,
  UserRole,
  Warehouse,
} from "@/types/models";

// ชีตรายโกดังที่ใช้รวม "จำนวนคงเหลือ" และนับ SKU — ชื่อแท็บต้องตรงกับ Google Sheets ตัวจริง
const WAREHOUSE_STOCK_TABS = [
  { warehouse_id: "wh-6", warehouse_name: "สำนักงานใหญ่" },
  { warehouse_id: "wh-1", warehouse_name: "โกดัง1" },
  { warehouse_id: "wh-2", warehouse_name: "โกดัง2" },
  { warehouse_id: "wh-3", warehouse_name: "โกดัง3" },
  { warehouse_id: "wh-4", warehouse_name: "โกดัง4" },
  { warehouse_id: "wh-5", warehouse_name: "โกดัง5" },
] as const;

function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  const clean = val.replace(/,/g, "").trim();
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

// จำนวนคงเหลือในชีตโกดังอาจเป็น "1,200" / ทศนิยม / มีช่องว่างในตัวเลข / ติดลบ
// ล้าง comma และช่องว่างทั้งหมดก่อน parse — ช่องว่างหรือค่าที่ไม่ใช่ตัวเลขนับเป็น 0
// ส่วนจำนวนติดลบต้องรวมตามจริง (ห้าม clamp เป็น 0)
function parseQuantity(val: string | undefined): number {
  if (!val) return 0;
  const clean = val.replace(/[,\s]/g, "");
  if (clean === "" || clean === "-") return 0;
  const num = Number(clean);
  return Number.isFinite(num) ? num : 0;
}

// หา index ของคอลัมน์ "จำนวนคงเหลือ" จากแถวหัวตารางของแต่ละแท็บเสมอ
// ห้ามเดาจากตำแหน่งคอลัมน์ (row[4]/row[5]) เพราะโครงสร้างแต่ละแท็บอาจต่างกัน
// และการหยิบ "ตัวเลขตัวแรกในแถว" อาจได้จำนวนขั้นต่ำหรือราคาแทน
function findRemainingQtyColumn(header: string[]): number {
  const cols = header.map((h) => (h ?? "").replace(/\s+/g, "").trim());
  // คอลัมน์จำนวนขั้นต่ำ (เช่น "จำนวนคงเหลือขั้นต่ำ", "min qty") มีคำว่า "คงเหลือ" อยู่ด้วย — ตัดออกจากการจับคู่แบบคลุมเครือ
  const isMinimumColumn = (c: string) =>
    c.includes("ขั้นต่ำ") || c.toLowerCase().includes("min");
  let idx = cols.findIndex((c) => c === "จำนวนคงเหลือ");
  if (idx !== -1) return idx;
  idx = cols.findIndex((c) => c.includes("จำนวนคงเหลือ") && !isMinimumColumn(c));
  if (idx !== -1) return idx;
  return cols.findIndex((c) => c.includes("คงเหลือ") && !isMinimumColumn(c));
}

function rowToDocument(row: string[]): Document {
  return {
    document_id: row[0] ?? "",
    document_no: row[1] ?? "",
    document_type: (row[2] || "RECEIVE") as Document["document_type"],
    reference_no: row[3] ?? "",
    document_date: row[4] ?? "",
    status: (row[5] || "DRAFT") as Document["status"],
    note: row[6] ?? "",
    created_by: row[7] ?? "",
    created_at: row[8] ?? "",
  };
}

function rowToMovement(row: string[]): StockMovement {
  return {
    movement_id: row[0] ?? "",
    document_id: row[1] ?? "",
    product_id: row[2] ?? "",
    warehouse_id: row[3] ?? "",
    location_id: row[4] ?? "",
    qty_change: parseNumber(row[5]),
    movement_type: (row[6] || "ADJUST") as MovementType,
    idempotency_key: row[7] ?? "",
    created_by: row[8] ?? "",
    created_at: row[9] ?? "",
  };
}

function rowToUser(row: string[]): User {
  const fullName = [row[4], row[5]].filter(Boolean).join(" ").trim() || row[1] || "";
  return {
    user_id: row[0] ?? "",
    full_name: fullName,
    email: row[6] || row[1] || "",
    password_hash: "",
    pin_hash: "",
    role: (row[3] || "VIEWER") as UserRole,
    warehouse_access: row[12] || "[]",
    active: true,
    created_at: row[9] ?? "",
    updated_at: row[10] ?? "",
  };
}

function rowToWarehouse(row: string[]): Warehouse {
  return {
    warehouse_id: row[0] ?? "",
    warehouse_code: row[1] ?? "",
    warehouse_name: row[2] || row[1] || row[0] || "",
    address: row[3] ?? "",
    active: true,
    created_at: row[5] ?? "",
    updated_at: row[6] ?? "",
  };
}

interface WarehouseTabStock {
  remainingQuantity: number;
  distinctSku: Set<string>;
}

// Throw เมื่อชีตสำคัญอ่านไม่ได้ — API ต้องตอบ error status ไม่ใช่ตัวเลข 0 ที่ทำให้เข้าใจผิด
export class DashboardDataError extends Error {
  readonly sheet: string;
  readonly operation: string;
  constructor(sheet: string, operation: string, cause?: string) {
    super(`อ่านชีต "${sheet}" ไม่สำเร็จ (operation: ${operation})${cause ? `: ${cause}` : ""}`);
    this.name = "DashboardDataError";
    this.sheet = sheet;
    this.operation = operation;
  }
}

export class SheetsDashboardRepository implements IDashboardRepository {
  // ชีตสำคัญ: อ่านได้ [] พร้อมบันทึก error = อ่านไม่สำเร็จ → throw ไม่ใช่เงียบแล้วคืน 0
  private async readCriticalSheet(
    sheetName: string,
    range: string,
    operation: string
  ): Promise<string[][]> {
    const rows = await readSheet(sheetName, range);
    if (rows.length === 0) {
      const readError = getSheetReadError(sheetName);
      if (readError) {
        console.error(
          `[SheetsDashboardRepository] ${operation} ล้มเหลว: ชีต "${sheetName}" — ${readError}`
        );
        throw new DashboardDataError(sheetName, operation, readError);
      }
    }
    return rows;
  }

  // ชีตเสริม (ชื่อเอกสาร/โกดัง/ตำแหน่ง/ผู้ใช้ — ใช้แค่ตกแต่ง recent movements):
  // อ่านไม่ได้ให้ log เตือนแล้วทำต่อ ไม่ให้พังทั้งหน้า
  private async readEnrichmentSheet(
    sheetName: string,
    range: string,
    operation: string
  ): Promise<string[][]> {
    const rows = await readSheet(sheetName, range);
    if (rows.length === 0) {
      const readError = getSheetReadError(sheetName);
      if (readError) {
        console.warn(
          `[SheetsDashboardRepository] ${operation}: ชีต "${sheetName}" อ่านไม่สำเร็จ (${readError}) — แสดงผลต่อโดยไม่ใช้ชีตนี้`
        );
      }
    }
    return rows;
  }

  // อ่านชีตรายโกดัง 1 แท็บพร้อมแถวหัวตาราง (keepHeader) แล้วคำนวณในการอ่านครั้งเดียว:
  // - remainingQuantity = ผลรวมคอลัมน์ "จำนวนคงเหลือ" ทุกแถว (SKU เดิมซ้ำหลายแถว/หลายแท็บรวมทุกแถวตามจริง)
  // - distinctSku = ชุด SKU ไม่ซ้ำจากคอลัมน์ A (normalize ด้วย cleanSkuCode)
  // อ่านแท็บไม่สำเร็จต้อง throw — ถ้าปล่อยผ่าน จะได้ผลรวมที่น้อยกว่าความจริงแบบเงียบ ๆ
  // แท็บว่างจริง (อ่านได้แต่ไม่มีข้อมูล) นับเป็น 0
  private async readWarehouseTabStock(
    tab: string,
    operation: string
  ): Promise<WarehouseTabStock> {
    const rows = await readSheet(tab, "A1:Z", { keepHeader: true });
    if (rows.length === 0) {
      const readError = getSheetReadError(tab);
      if (readError) {
        console.error(
          `[SheetsDashboardRepository] ${operation} ล้มเหลว: ชีต "${tab}" — ${readError}`
        );
        throw new DashboardDataError(tab, operation, readError);
      }
      return { remainingQuantity: 0, distinctSku: new Set<string>() };
    }

    // แถวแรกคือหัวตาราง (keepHeader: true) — ข้อมูลเริ่มที่แถวถัดไป
    const qtyCol = findRemainingQtyColumn(rows[0]);
    if (qtyCol === -1) {
      const cause =
        'ไม่พบคอลัมน์ "จำนวนคงเหลือ" (หรือ "คงเหลือ") ในแถวหัวตาราง — โครงสร้างชีตไม่ถูกต้อง';
      console.error(
        `[SheetsDashboardRepository] ${operation} ล้มเหลว: ชีต "${tab}" — ${cause}`
      );
      throw new DashboardDataError(tab, operation, cause);
    }

    const distinctSku = new Set<string>();
    let remainingQuantity = 0;
    for (const row of rows.slice(1)) {
      const code = cleanSkuCode(row[0]);
      if (code) distinctSku.add(code);
      remainingQuantity += parseQuantity(row[qtyCol]);
    }
    return { remainingQuantity, distinctSku };
  }

  async getStats(
    warehouseId?: string,
    _days: number = 90
  ): Promise<DashboardStats> {
    const productRepo = new SheetsProductRepository();

    // ชีตรายโกดัง (สำนักงานใหญ่ + โกดัง1-5) คือแหล่งข้อมูลเดียวของสองค่านี้:
    // - total_remaining_quantity = ผลรวมคอลัมน์ "จำนวนคงเหลือ" ทุกแถวทุกแท็บ (หน่วย: ชิ้น)
    // - total_sku = จำนวนรหัสสินค้าไม่ซ้ำ (คอลัมน์ A) — คนละความหมายกับจำนวนชิ้น
    // เมื่อกรองรายโกดังจะอ่านเฉพาะแท็บของโกดังนั้น
    const requestedTab = warehouseId ? getWarehouseSheetName(warehouseId) : null;
    const stockTabs = requestedTab
      ? WAREHOUSE_STOCK_TABS.filter((tab) => tab.warehouse_name === requestedTab)
      : [...WAREHOUSE_STOCK_TABS];
    if (requestedTab && stockTabs.length === 0) {
      throw new DashboardDataError(requestedTab, "getStats:resolveWarehouseStock", "ไม่พบโกดังที่ร้องขอ");
    }

    // อ่านทุกชีตที่ Dashboard ต้องการพร้อมกันในรอบเดียว — ชั้น client
    // (micro-batch) จะรวมเป็น spreadsheets.values.batchGet ครั้งเดียว
    // แทนการตีความเป็น 13 Google API calls แยกกันแบบเรียงคิวเดิม
    const [
      movRows,
      docRows,
      warehouseRows,
      locationRows,
      userRows,
      products,
      summaryRows,
      tabStocks,
    ] = await Promise.all([
      // ชีตสำคัญ: อ่านไม่ได้ต้อง throw (จะคืน 0 ทำให้เข้าใจว่าหมดสต็อกทั้งหมด)
      this.readCriticalSheet(
        SHEETS.STOCK_MOVEMENTS,
        "A2:J",
        "getStats:readStockMovements"
      ),
      // Documents เป็นข้อมูลหลักของการแยกรับเข้า/ผลิตและจำนวนรออนุมัติ
      // อ่านไม่ได้ต้องยกเลิกทั้ง Dashboard เพื่อไม่แสดงยอดที่นับปนหรือไม่ครบ
      this.readCriticalSheet(
        SHEETS.DOCUMENTS,
        "A2:I",
        "getStats:readDocuments"
      ),
      // ชีตเสริมสำหรับชื่อใน recent movements / activities
      this.readEnrichmentSheet(SHEETS.WAREHOUSES, "A2:G", "getStats:readWarehouses"),
      this.readEnrichmentSheet(SHEETS.LOCATIONS, "A2:L", "getStats:readLocations"),
      this.readEnrichmentSheet(SHEETS.USERS, "A2:M", "getStats:readUsers"),
      // PRODUCTS คือแหล่งข้อมูลเดียวกับ /api/products — อ่านไม่ได้ต้อง throw
      productRepo.findAll({ activeOnly: true }),
      // StockSummary คือแหล่งข้อมูลเดียวกับ /api/stock — ถ้าอ่านไม่ได้ยังไม่ throw
      // เพราะมี fallback คำนวณยอดจาก StockMovements แทนได้
      readSheet(SHEETS.STOCK_SUMMARY, "A2:E"),
      Promise.all(
        stockTabs.map((tab) =>
          this.readWarehouseTabStock(tab.warehouse_name, "getStats:readWarehouseStock")
        )
      ),
    ]);

    // PRODUCTS อ่านมาแล้วเหลือ 0 แถว + มี read error = อ่านไม่สำเร็จจริง → throw
    if (products.length === 0) {
      const productsReadError = getSheetReadError(SHEETS.PRODUCTS);
      if (productsReadError) {
        console.error(
          `[SheetsDashboardRepository] getStats:readProducts ล้มเหลว: ชีต "${SHEETS.PRODUCTS}" — ${productsReadError}`
        );
        throw new DashboardDataError(SHEETS.PRODUCTS, "getStats:readProducts", productsReadError);
      }
    }

    const summaryReadError =
      summaryRows.length === 0 ? getSheetReadError(SHEETS.STOCK_SUMMARY) : null;

    const docMap = new Map(docRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const productMap = new Map(products.map((p) => [p.product_id, p]));
    for (const product of products) productMap.set(cleanSkuCode(product.sku), product);
    const warehouseMap = new Map(warehouseRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const locationMap = new Map(locationRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const userMap = new Map(userRows.filter((r) => r[0]).map((r) => [r[0], r]));

    const total_remaining_quantity = tabStocks.reduce(
      (sum, tab) => sum + tab.remainingQuantity,
      0
    );
    const total_sku = new Set(
      tabStocks.flatMap((tab) => [...tab.distinctSku])
    ).size;
    const warehouse_distribution = stockTabs.map((tab, index) => ({
      warehouse_id: tab.warehouse_id,
      warehouse_name: tab.warehouse_name,
      quantity: tabStocks[index].remainingQuantity,
    }));

    // Filter movements by warehouse
    let filteredMov = movRows.filter((r) => r[0]);
    if (warehouseId) {
      filteredMov = filteredMov.filter(
        (r) => getWarehouseSheetName(r[3]) === getWarehouseSheetName(warehouseId)
      );
    }

    // Summary stats from stock summary
    let summaries = summaryRows.filter((r) => r[0]);
    if (warehouseId) {
      summaries = summaries.filter(
        (r) => getWarehouseSheetName(r[1]) === getWarehouseSheetName(warehouseId)
      );
    }

    // ยอดคงเหลือรายสินค้าจาก StockSummary — key เดียวกับ /api/stock
    // Normalize ด้วย cleanSkuCode รองรับทั้งรูปแบบ "SKU" และ "prod-SKU" ให้จับคู่กับ PRODUCTS ได้
    const summaryQtyByKey = new Map<string, number>();
    for (const s of summaries) {
      const key = cleanSkuCode(s[0]);
      if (!key) continue;
      const qty = parseNumber(s[3]);
      summaryQtyByKey.set(key, (summaryQtyByKey.get(key) ?? 0) + qty);
    }

    // fallback: คำนวณยอดจาก StockMovements (ต้นทางความจริงเดียวกับระบบรับ-เบิก-โอน)
    // สำหรับสินค้าที่ไม่มีข้อมูลใน StockSummary
    const movementQtyByKey = new Map<string, number>();
    for (const r of filteredMov) {
      const key = cleanSkuCode(r[2]);
      if (!key) continue;
      const qty = parseNumber(r[5]);
      movementQtyByKey.set(key, (movementQtyByKey.get(key) ?? 0) + qty);
    }

    let total_quantity = 0;
    let low_stock_count = 0;
    let out_of_stock_count = 0;
    let summaryMatchCount = 0;

    for (const p of products) {
      const key = cleanSkuCode(p.product_id) || cleanSkuCode(p.sku);
      let qty: number | null = summaryQtyByKey.get(key) ?? null;
      if (qty !== null) {
        summaryMatchCount++;
      } else {
        // ไม่พบใน StockSummary → ใช้ยอดคำนวณจาก StockMovements
        qty = movementQtyByKey.get(key) ?? 0;
      }
      total_quantity += qty;
      if (qty <= 0) out_of_stock_count++;
      else if (qty <= p.minimum_stock) low_stock_count++;
    }

    // StockSummary อ่านไม่ได้ และไม่มี StockMovements ให้คำนวณแทน
    // → ต้องตอบ error ไม่ใช่รายงานว่าสินค้าหมดสต็อกทั้งหมด
    if (products.length > 0 && summaryReadError && summaryMatchCount === 0 && movRows.length === 0) {
      console.error(
        `[SheetsDashboardRepository] getStats:readStockSummary ล้มเหลว: ชีต "${SHEETS.STOCK_SUMMARY}" — ${summaryReadError} และไม่มี StockMovements สำหรับคำนวณยอดคงเหลือแทน`
      );
      throw new DashboardDataError(SHEETS.STOCK_SUMMARY, "getStats:readStockSummary", summaryReadError);
    }

    const documents = docRows.filter((row) => row[0]).map(rowToDocument);
    const movements = filteredMov.map(rowToMovement);
    const users = userRows.filter((row) => row[0]).map(rowToUser);
    const warehouses = warehouseRows.filter((row) => row[0]).map(rowToWarehouse);
    const warehouseIds = new Set(warehouses.map((warehouse) => warehouse.warehouse_id));
    for (const warehouse of WAREHOUSE_STOCK_TABS) {
      if (!warehouseIds.has(warehouse.warehouse_id)) {
        warehouses.push({
          warehouse_id: warehouse.warehouse_id,
          warehouse_code: warehouse.warehouse_id,
          warehouse_name: warehouse.warehouse_name,
          address: "",
          active: true,
          created_at: "",
          updated_at: "",
        });
      }
    }

    // สูตรรับเข้า/เบิก/ผลิต, กราฟ 90 วัน, กิจกรรมวันนี้ และ pending count
    // อยู่ใน pure server-side aggregation เดียวกันเพื่อแยก production และ de-duplicate ก่อนรวมยอด
    const operationalStats = aggregateDashboardOperations({
      movements,
      documents,
      products,
      users,
      warehouses,
    });

    // Recent movements (last 10)
    const recent = filteredMov
      .sort((a, b) => b[9].localeCompare(a[9]))
      .slice(0, 10);

    const recent_movements: MovementWithDetails[] = recent.map((r) => {
      const doc = docMap.get(r[1]);
      const product = productMap.get(r[2]) || productMap.get(cleanSkuCode(r[2]));
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
        created_by_name:
          [user?.[4], user?.[5]].filter(Boolean).join(" ").trim() ||
          user?.[1] ||
          "ไม่ทราบผู้ทำรายการ",
      };
    });

    return {
      total_sku,
      total_remaining_quantity,
      total_quantity,
      low_stock_count,
      out_of_stock_count,
      ...operationalStats,
      warehouse_distribution,
      recent_movements,
    };
  }
}
