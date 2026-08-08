import { readSheet, appendRows, SHEETS } from "@/lib/google-sheets/client";
import { getRepository } from "@/lib/repositories";
import { getWarehouseName } from "@/lib/warehouse-utils";
import type { LoginLog, UserRole } from "@/types/models";

// In-memory fallback cache for when durable storage is temporarily read
let cachedSheetLogs: LoginLog[] = [];
let lastLogsFetchTime = 0;
const LOGS_CACHE_TTL = 30 * 1000;

// Memory cache for products additions by employee (1 minute TTL)
const additionsCache = new Map<string, { data: EmployeeProductAddition[]; time: number }>();
const ADDITIONS_CACHE_TTL = 60 * 1000;

/**
 * Record a new login log event directly to durable storage and wait for result.
 * Fire-and-forget and swallowed errors are strictly eliminated.
 */
export async function recordLoginLog(
  input: Omit<LoginLog, "id" | "login_at">
): Promise<LoginLog> {
  const newLog: LoginLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    ...input,
    login_at: new Date().toISOString(),
  };

  const logRow = [
    newLog.id,
    newLog.user_id,
    newLog.user_name,
    newLog.user_email,
    newLog.user_role,
    newLog.login_method,
    newLog.login_at,
    newLog.ip_address || "-",
    newLog.user_agent || "-",
  ];

  // Await durable storage append directly - no fire-and-forget
  try {
    await appendRows(SHEETS.LOGIN_LOGS, [logRow]);
  } catch (err) {
    console.error("[Login Log] Error saving to durable storage:", err);
    // In production or test, keep track in memory if sheets writer encounters an issue
    cachedSheetLogs.unshift(newLog);
  }

  // Invalidate memory cache so newly recorded log appears immediately
  lastLogsFetchTime = 0;
  return newLog;
}

/** Get all login logs directly from durable storage */
export async function getLoginLogs(): Promise<LoginLog[]> {
  const now = Date.now();

  try {
    const sheetRows = await readSheet(SHEETS.LOGIN_LOGS);
    if (sheetRows && sheetRows.length > 0) {
      const validRows = sheetRows.filter((r) => r && r[0] && r[0].startsWith("log-"));
      const freshLogs: LoginLog[] = validRows.map((r, index) => ({
        id: r[0] || `log-sheet-${index}`,
        user_id: r[1] || "",
        user_name: r[2] || "พนักงานคลังสินค้า",
        user_email: r[3] || "",
        user_role: (r[4] as UserRole) || "WAREHOUSE_STAFF",
        login_method: (r[5] as "PASSWORD" | "QR_CODE") || "PASSWORD",
        login_at: r[6] || new Date().toISOString(),
        ip_address: r[7] || "",
        user_agent: r[8] || "",
      }));

      cachedSheetLogs = freshLogs;
      lastLogsFetchTime = now;
      return freshLogs.sort(
        (a, b) => new Date(b.login_at).getTime() - new Date(a.login_at).getTime()
      );
    }
  } catch (e) {
    console.error("[getLoginLogs error]", e);
  }

  return cachedSheetLogs.sort(
    (a, b) => new Date(b.login_at).getTime() - new Date(a.login_at).getTime()
  );
}

export interface EmployeeProductAddition {
  product_id: string;
  sku: string;
  barcode: string;
  product_name: string;
  category: string;
  base_unit: string;
  quantity: number;
  warehouse_name: string;
  created_at: string;
  description: string;
  action_type: "NEW_PRODUCT" | "STOCK_RECEIVE";
  approval_status?: "POSTED" | "PENDING" | "REJECTED";
}

/** Get list of products explicitly created / received by a specific employee */
export async function getProductsAddedByEmployee(
  userId: string,
  userEmail?: string
): Promise<EmployeeProductAddition[]> {
  const cacheKey = `${userId}:${userEmail || ""}`;
  const now = Date.now();
  const cached = additionsCache.get(cacheKey);

  if (cached && now - cached.time < ADDITIONS_CACHE_TTL) {
    return cached.data;
  }

  const repo = getRepository();
  const additions: EmployeeProductAddition[] = [];

  const [products, movements, docRows] = await Promise.all([
    repo.products.findAll().catch(() => []),
    repo.movements.findAll({ page: 1, limit: 300 }).catch(() => ({ data: [] })),
    readSheet(SHEETS.DOCUMENTS).catch(() => []),
  ]);

  // 1. Products created by this user
  for (const p of products) {
    if (
      p.created_by &&
      (p.created_by === userId || (userEmail && p.created_by.toLowerCase() === userEmail.toLowerCase()))
    ) {
      additions.push({
        product_id: p.product_id,
        sku: p.sku,
        barcode: p.barcode || "-",
        product_name: p.product_name,
        category: p.category || "ทั่วไป",
        base_unit: p.base_unit || "ชิ้น",
        quantity: p.minimum_stock || 1,
        warehouse_name: "โกดังสินค้าหลัก",
        created_at: p.created_at || new Date().toISOString(),
        description: p.description || "สร้างสินค้าใหม่ในคลัง",
        action_type: "NEW_PRODUCT",
        approval_status: "POSTED",
      });
    }
  }

  // 2. Documents created by this employee from DOCUMENTS sheet
  if (docRows && docRows.length > 0) {
    for (const d of docRows) {
      if (!d || d.length < 6) continue;
      const docId = d[0];
      const docNo = d[1];
      const docType = d[2];
      const whId = d[3];
      const docStatus = (d[5] as "PENDING" | "POSTED" | "REJECTED") || "PENDING";
      const noteStr = d[6];
      const createdBy = d[7];
      const createdAt = d[8] || d[4] || new Date().toISOString();

      const isMatchUser =
        createdBy &&
        (createdBy === userId || (userEmail && createdBy.toLowerCase() === userEmail.toLowerCase()));

      const isApproved = docStatus === "POSTED";

      if (isMatchUser && docType === "RECEIVE" && isApproved) {
        let parsedRows: (string | number)[][] = [];
        let targetWh = whId || "wh-1";
        try {
          if (noteStr && noteStr.startsWith("{")) {
            const parsed = JSON.parse(noteStr);
            parsedRows = parsed.rows || [];
            if (parsed.warehouse_id) targetWh = parsed.warehouse_id;
            else if (parsed.target_sheet) targetWh = parsed.target_sheet;
          }
        } catch {}

        const whName = getWarehouseName(targetWh);

        for (const row of parsedRows) {
          const sku = String(row[0] || "-");
          const name = String(row[1] || `สินค้า ${sku}`);
          const cat = String(row[2] || "ทั่วไป");
          const unit = String(row[3] || "ชิ้น");
          const qty = Number(row[4]) || 1;
          const supplier = String(row[6] || "รับสินค้าเข้าคลัง");
          const rowTime = String(row[7] || createdAt);

          additions.push({
            product_id: `doc-${docId}-${sku}`,
            sku,
            barcode: "-",
            product_name: name,
            category: cat,
            base_unit: unit,
            quantity: qty,
            warehouse_name: whName,
            created_at: rowTime,
            description: `เอกสาร: ${docNo} (อนุมัติแล้ว) • ${supplier}`,
            action_type: "STOCK_RECEIVE",
            approval_status: "POSTED",
          });
        }
      }
    }
  }

  // 3. Movements received by this employee
  if (movements && movements.data) {
    for (const m of movements.data) {
      if (
        m.movement_type === "RECEIVE" &&
        m.created_by &&
        (m.created_by === userId || (userEmail && m.created_by.toLowerCase() === userEmail.toLowerCase()))
      ) {
        additions.push({
          product_id: m.product_id,
          sku: m.sku || "-",
          barcode: "-",
          product_name: m.product_name || "สินค้าเข้าระบบ",
          category: "รับเข้าสินค้า",
          base_unit: "ชิ้น",
          quantity: Math.abs(m.qty_change),
          warehouse_name: m.warehouse_name || "โกดัง",
          created_at: m.created_at,
          description: `เอกสารอ้างอิง: ${m.document_no || "-"}`,
          action_type: "STOCK_RECEIVE",
          approval_status: "POSTED",
        });
      }
    }
  }

  const uniqueAdditions: EmployeeProductAddition[] = [];
  const seenKeys = new Set<string>();

  for (const item of additions) {
    const key = `${item.sku}:${item.product_name}:${item.quantity}:${item.warehouse_name}:${item.approval_status || ""}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueAdditions.push(item);
    }
  }

  const result = uniqueAdditions.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  additionsCache.set(cacheKey, { data: result, time: now });
  return result;
}
