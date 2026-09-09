import { normalizeWarehouseId, getWarehouseName, detectWarehouseFromLocation, getWarehouseDisplayName } from "./warehouse-utils";
import type { Product } from "@/types/models";

export interface TransferNotification {
  id: string;
  doc_no?: string;
  product_id: string;
  product_name: string;
  sku: string;
  barcode?: string;
  from_warehouse_id: string;
  from_warehouse_name: string;
  to_warehouse_id: string;
  to_warehouse_name: string;
  qty: number;
  moved_by: string;
  assigned_to_user_id?: string;
  assigned_to_name?: string;
  created_at: string;
  created_by?: string;
  created_by_name?: string;
  status: "PENDING" | "ACKNOWLEDGED" | "WAITING_APPROVAL" | "COMPLETED" | "CANCELLED" | "REJECTED";
  current_step?: number;
  current_step_text?: string;
  last_active_at?: string;
  location_code?: string;
  from_location_id?: string;
  to_location_id?: string;
  source_allocations?: Array<{ location_id: string; location_name?: string; qty: number }>;
  note?: string;
}

export interface ParsedTransferMetadata {
  from_warehouse_id?: string;
  to_warehouse_id?: string;
  from_location_id?: string;
  to_location_id?: string;
  source_allocations?: Array<{ location_id: string; location_name?: string; qty: number }>;
  product_id?: string;
  sku?: string;
  barcode?: string;
  product_name?: string;
  category?: string;
  base_unit?: string;
  supplier?: string;
  qty?: number;
  moved_by?: string;
  assigned_to_user_id?: string;
  assigned_to_name?: string;
  created_by?: string;
  created_by_name?: string;
  idempotency_key?: string;
  completed_at?: string;
  completed_by?: string;
  completed_by_name?: string;
  express_tag?: string;
  express_status?: string;
  original_note?: string;
  current_step?: number;
  current_step_text?: string;
  last_active_at?: string;
  [key: string]: any;
}

export function parseTransferMetadata(note?: string | null): ParsedTransferMetadata {
  if (!note || typeof note !== "string") return {};

  const raw = note.trim();
  if (!raw) return {};

  // Helper to attempt parsing JSON
  const tryParse = (str: string): ParsedTransferMetadata | null => {
    if (!str) return null;
    try {
      // Direct parse
      if ((str.startsWith("{") && str.endsWith("}")) || (str.startsWith("[") && str.endsWith("]"))) {
        const parsed = JSON.parse(str);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      }
      // Substring parse
      const firstBrace = str.indexOf("{");
      const lastBrace = str.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const parsed = JSON.parse(str.slice(firstBrace, lastBrace + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return null;
  };

  // 1. Direct parse
  let res = tryParse(raw);
  if (res) return res;

  // 2. Unescape quotes (handles """ -> ", "" -> ", \" -> ")
  const unescapeQuotes = (s: string) =>
    s
      .replace(/^"+|"+$/g, "")
      .replace(/\\"/g, '"')
      .replace(/"""+/g, '"')
      .replace(/""/g, '"');

  res = tryParse(unescapeQuotes(raw));
  if (res) return res;

  // 3. Double-stringified JSON attempt
  try {
    const onceParsed = JSON.parse(raw);
    if (typeof onceParsed === "string") {
      res = tryParse(onceParsed) || tryParse(unescapeQuotes(onceParsed));
      if (res) return res;
    } else if (onceParsed && typeof onceParsed === "object") {
      return onceParsed;
    }
  } catch {}

  // 4. Robust Regex extraction for partially malformed or quote-escaped strings
  const result: ParsedTransferMetadata = {};

  const matchField = (patterns: string[]): string | undefined => {
    for (const p of patterns) {
      const re = new RegExp(`["'\\\\]*${p}["'\\\\]*\\s*[:=]\\s*["'\\\\]*([^"',}\\n\\]]+)["'\\\\]*`, "i");
      const m = raw.match(re);
      if (m && m[1]) {
        const val = m[1].trim().replace(/^["'\\]+|["'\\]+$/g, "");
        if (val && val !== "null" && val !== "undefined") return val;
      }
    }
    return undefined;
  };

  result.sku = matchField(["sku", "รหัสสินค้า"]);
  result.product_id = matchField(["product_id", "รหัส"]);
  result.barcode = matchField(["barcode", "บาร์โค้ด"]);
  result.product_name = matchField(["product_name", "ชื่อสินค้า", "สินค้า"]);
  result.base_unit = matchField(["base_unit", "หน่วย"]);
  result.from_warehouse_id = matchField(["from_warehouse_id", "from_wh", "จากโกดัง", "ย้ายจาก"]);
  result.to_warehouse_id = matchField(["to_warehouse_id", "to_wh", "ไปโกดัง", "ปลายทาง"]);
  // ห้ามใส่ key generic อย่าง "location"/"ตำแหน่ง" — matchField ใช้ substring match
  // จึงไปจับ "to_location"/"ไปตำแหน่ง" แล้วดึงค่าปลายทางมาเป็นต้นทาง ทำให้ from/to สลับข้าง
  result.from_location_id = matchField(["from_location_id", "from_loc", "จากตำแหน่ง", "location_code"]);
  result.to_location_id = matchField(["to_location_id", "to_loc", "ไปตำแหน่ง"]);
  result.moved_by = matchField(["moved_by", "assigned_to_name", "คนไปย้ายสินค้า", "คนเบิก"]);
  result.assigned_to_name = matchField(["assigned_to_name", "moved_by"]);
  result.assigned_to_user_id = matchField(["assigned_to_user_id"]);
  result.created_by = matchField(["created_by"]);
  result.created_by_name = matchField(["created_by_name"]);
  result.idempotency_key = matchField(["idempotency_key"]);
  result.current_step_text = matchField(["current_step_text"]);

  // Detect route delimiter e.g. "โกดัง1 -> โกดัง2", "โกดัง 1 ➔ โกดัง 2", "wh-01 -> wh-02", "ย้ายจาก โกดัง 1 ไป โกดัง 2"
  if (!result.from_warehouse_id || !result.to_warehouse_id) {
    const routeMatch = raw.match(/(?:ย้ายจาก\s*)?(โกดัง\s*[1-6]|สำนักงานใหญ่|wh-?0?[1-6])\s*(?:->|➔|→|ไป|to|\/)\s*(โกดัง\s*[1-6]|สำนักงานใหญ่|wh-?0?[1-6])/i);
    if (routeMatch) {
      if (!result.from_warehouse_id) result.from_warehouse_id = normalizeWarehouseId(routeMatch[1]);
      if (!result.to_warehouse_id) result.to_warehouse_id = normalizeWarehouseId(routeMatch[2]);
    }
  }

  // Deduce from location IDs if still missing
  if (!result.from_warehouse_id && result.from_location_id) {
    const inferred = detectWarehouseFromLocation(result.from_location_id);
    if (inferred) result.from_warehouse_id = inferred;
  }
  if (!result.to_warehouse_id && result.to_location_id) {
    const inferred = detectWarehouseFromLocation(result.to_location_id);
    if (inferred) result.to_warehouse_id = inferred;
  }

  const qtyStr = matchField(["qty", "จำนวน"]);
  if (qtyStr && !isNaN(Number(qtyStr))) {
    result.qty = Number(qtyStr);
  }

  const stepStr = matchField(["current_step"]);
  if (stepStr && !isNaN(Number(stepStr))) {
    result.current_step = Number(stepStr);
  }

  const noteText = matchField(["original_note", "note", "หมายเหตุ"]);
  if (noteText && !noteText.startsWith("{")) {
    result.original_note = noteText;
  } else if (!raw.includes("{") && !raw.includes("from_warehouse_id")) {
    result.original_note = raw;
  }

  return result;
}

const STORAGE_KEY = "stockify_transfer_notifications";

const A1_PLACEHOLDER_RE = /^loc-?(a0?1|b0?1)?$/i;

export function isUsableLocationCode(loc?: string | null): boolean {
  const v = (loc || "").trim();
  if (!v || v === "-" || v === "null" || v === "undefined" || v === "A1" || v === "ตำแหน่งเริ่มต้น") return false;
  if (A1_PLACEHOLDER_RE.test(v)) return false;
  return true;
}

export function normalizeLocationKey(loc?: string | null): string {
  return (loc || "").trim().toLowerCase().replace(/^loc-/, "").replace(/[\s\-_#]/g, "");
}

/**
 * คืนลิสต์ชั้นวางต้นทางที่ "ยังมีสต็อกเหลืออยู่จริง" เท่านั้น (quantity > 0)
 * เพื่อตัดชั้นวางที่เคยถูกสแกน/หยิบจนหมดไปแล้วออกจากการแสดงผล
 * - คืน [] เมื่อมีข้อมูลสต็อกแยกชั้นวางของโกดังต้นทางชัดเจน แต่ทุกชั้นวางหมดแล้ว
 * - คืน null เมื่อไม่มีข้อมูลสต็อกแยกชั้นวางให้สรุปได้ (ผู้เรียกควรใช้ logic สำรองเดิมต่อ)
 */
export function getInStockSourceLocations(
  t: Pick<TransferNotification, "sku" | "product_id" | "barcode" | "from_warehouse_id" | "from_warehouse_name">,
  products?: Product[]
): string[] | null {
  if (!products || products.length === 0) return null;

  const normSkuLike = (v?: string) => (v || "").trim().toLowerCase().replace(/^prod-/, "");
  const normSku = normSkuLike(t.sku);
  const normPid = normSkuLike(t.product_id);
  const tBarcode = (t.barcode || "").trim().toLowerCase();

  const matched = products.find((p) => {
    const pSku = normSkuLike(p.sku);
    const pPid = normSkuLike(p.product_id);
    const pBcode = (p.barcode || "").trim().toLowerCase();
    if (normSku && (pSku === normSku || pPid === normSku)) return true;
    if (normPid && (pPid === normPid || pSku === normPid)) return true;
    return Boolean(tBarcode && pBcode && pBcode === tBarcode);
  });
  if (!matched) return null;

  const normFromWh = (t.from_warehouse_id || "").trim().toLowerCase();
  const normFromWhName = (t.from_warehouse_name || "").trim().toLowerCase();
  const whEntries = (matched.locations_breakdown || []).filter((b) => {
    const bId = (b.warehouse_id || "").trim().toLowerCase();
    const bName = (b.warehouse_name || "").trim().toLowerCase();
    return (normFromWh && bId === normFromWh) || (normFromWhName && bName === normFromWhName);
  });

  // ไม่มี breakdown ของโกดังต้นทาง → สรุปไม่ได้ ให้ผู้เรียกใช้ logic สำรองเดิม
  if (whEntries.length === 0) return null;

  const result: string[] = [];
  const seen = new Set<string>();
  for (const b of whEntries) {
    if (!(Number(b.quantity ?? 0) > 0)) continue;
    if (!isUsableLocationCode(b.location)) continue;
    const cleanLoc = b.location.replace(/^loc-/, "");
    for (const part of cleanLoc.split(",").map((s) => s.trim()).filter(Boolean)) {
      const key = normalizeLocationKey(part);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(part);
    }
  }
  return result;
}

export function getDisplayProductName(t?: { product_name?: string; note?: string; sku?: string; product_id?: string }): string {
  if (!t) return "รายการย้ายสินค้า";
  let str = t.product_name || "";

  if (!str || str.startsWith("{") || str.includes('"""') || str === "รายการเบิกสินค้า" || str === "รายการย้ายสินค้า") {
    if (t.note) {
      const meta = parseTransferMetadata(t.note);
      if (meta.product_name) {
        str = meta.product_name;
      }
    }
  }

  let cleaned = str.replace(/คนไปย้ายสินค้า.*?(?=\||$)/gi, "").replace(/^[|\s]+|[|\s]+$/g, "").trim();
  if (!cleaned && (t.sku || t.product_id)) {
    cleaned = (t.sku || t.product_id || "").replace(/^prod-/, "");
  }
  return cleaned || "รายการย้ายสินค้า";
}

export function cleanProductName(name?: string, note?: string): string {
  return getDisplayProductName({ product_name: name, note });
}

export function getTransferNotifications(): TransferNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: TransferNotification[] = JSON.parse(raw);
    const list = parsed.map((t) => {
      const completed = isTransferCompleted(t.id) || isTransferCompleted(t.doc_no);
      return {
        ...t,
        product_name: getDisplayProductName(t),
        status: completed ? ("COMPLETED" as const) : t.status,
      };
    });
    return list.sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.doc_no || "").localeCompare(a.doc_no || "");
    });
  } catch {
    return [];
  }
}


/**
 * Removes notification entries that have dummy/invalid product data
 * (e.g. sku starts with "TRF-", product_id is empty or "TRF").
 * These will be re-synced from the server with enriched product info.
 */
export function purgeInvalidNotifications() {
  if (typeof window === "undefined") return;
  try {
    // Purge collided/composite keys from COMPLETED_KEY to restore false-completed notifications
    const rawCompleted = localStorage.getItem(COMPLETED_KEY);
    if (rawCompleted) {
      try {
        const completedList: unknown = JSON.parse(rawCompleted);
        if (Array.isArray(completedList)) {
          const cleanedList = completedList.filter((item) => {
            const str = String(item || "").toLowerCase();
            if (str.includes("_prod-") || str.startsWith("trf-20")) return false;
            return true;
          });
          if (cleanedList.length !== completedList.length) {
            localStorage.setItem(COMPLETED_KEY, JSON.stringify(cleanedList));
          }
        }
      } catch {}
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: TransferNotification[] = JSON.parse(raw);
    const cleaned = parsed.filter((t) => {
      // Keep notifications that have real product data
      const hasBadSku = !t.sku || t.sku === "TRF" || t.sku.startsWith("TRF-");
      const hasBadPid = !t.product_id || t.product_id === "TRF" || t.product_id.startsWith("TRF-") || t.product_id === "trf-item";
      const hasNoProdName = !t.product_name || t.product_name === "รายการย้ายสินค้า";
      const hasDummyToWh = t.to_warehouse_name === "โกดังปลายทาง" || !t.to_warehouse_name;
      
      // Remove entries where product data is completely empty or destination warehouse is unassigned/dummy
      if ((hasBadSku && hasBadPid && hasNoProdName) || hasDummyToWh) return false;
      return true;
    });
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      broadcastTransferChange();
    }
  } catch (e) {
    console.error("[TransferNotification] Purge error:", e);
  }
}

export function markTransferNotificationAcknowledged(id: string) {
  if (typeof window === "undefined") return;
  try {
    const existing = getTransferNotifications();
    const targetLower = String(id).trim().toLowerCase();
    const updated = existing.map((t) =>
      t.id && String(t.id).trim().toLowerCase() === targetLower
        ? { ...t, status: "ACKNOWLEDGED" as const }
        : t
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("stockify-transfer-updated"));
  } catch (e) {
    console.error("[TransferNotification] Mark error:", e);
  }
}

export function markTransferCancelled(id: string) {
  if (typeof window === "undefined") return;
  try {
    const existing = getTransferNotifications();
    const targetLower = String(id).trim().toLowerCase();
    const updated = existing.map((t) =>
      t.id && String(t.id).trim().toLowerCase() === targetLower
        ? { ...t, status: "CANCELLED" as const }
        : t
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    markTransferCompleted(id);
    broadcastTransferChange();
  } catch (e) {
    console.error("[TransferNotification] Mark cancelled error:", e);
  }
}

export function markTransferWaitingApproval(
  id: string,
  details?: {
    from_location_id?: string;
    to_location_id?: string;
    source_allocations?: Array<{ location_id: string; location_name?: string; qty: number }>;
    moved_by?: string;
    assigned_to_name?: string;
    assigned_to_user_id?: string;
  }
) {
  if (typeof window === "undefined") return;
  try {
    const existing = getTransferNotifications();
    const targetLower = String(id).trim().toLowerCase();
    const updated = existing.map((t) =>
      t.id && String(t.id).trim().toLowerCase() === targetLower
        ? {
            ...t,
            status: "WAITING_APPROVAL" as const,
            current_step: 4,
            current_step_text: "ย้ายสินค้าแล้ว (รอ Admin อนุมัติ)",
            from_location_id: details?.from_location_id || t.from_location_id,
            to_location_id: details?.to_location_id || t.to_location_id,
            source_allocations: details?.source_allocations || t.source_allocations,
            moved_by: details?.moved_by || t.moved_by,
            assigned_to_name: details?.assigned_to_name || details?.moved_by || t.assigned_to_name,
            assigned_to_user_id: details?.assigned_to_user_id || t.assigned_to_user_id,
            last_active_at: new Date().toISOString(),
          }
        : t
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    broadcastTransferChange();
  } catch (e) {
    console.error("[TransferNotification] Mark waiting approval error:", e);
  }
}

export function updateTransferTaskProgress(id: string, step: number, stepText?: string) {
  if (typeof window === "undefined" || !id) return;
  try {
    const existing = getTransferNotifications();
    const targetLower = String(id).trim().toLowerCase();
    const updated = existing.map((t) =>
      t.id && String(t.id).trim().toLowerCase() === targetLower
        ? {
            ...t,
            current_step: step,
            current_step_text:
              stepText ||
              (step === 1
                ? "กำลังสแกนบาร์โค้ดสินค้า"
                : step === 2
                ? "กำลังหยิบสินค้าต้นทาง"
                : step === 3
                ? "กำลังนำเข้าตำแหน่งปลายทาง"
                : step >= 4
                ? "ย้ายสินค้าสำเร็จ"
                : "รอดำเนินการ"),
            last_active_at: new Date().toISOString(),
          }
        : t
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    broadcastTransferChange();

    // Sync to server API in real-time
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const storedToken =
      typeof window !== "undefined"
        ? sessionStorage.getItem("stockify_tab_token") ||
          localStorage.getItem("stockify_tab_token") ||
          (function () {
            try {
              return JSON.parse(sessionStorage.getItem("stockify_tab_session") || "{}")?.token;
            } catch {
              return null;
            }
          })()
        : null;

    if (storedToken) {
      headers["x-tab-token"] = storedToken;
      headers["Authorization"] = `Bearer ${storedToken}`;
    }

    fetch(`/api/movements/transfer/${encodeURIComponent(id)}/progress`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ step, step_text: stepText }),
    }).catch((err) => {
      console.warn("[TransferNotification] API sync progress failed:", err);
    });
  } catch (e) {
    console.error("[TransferNotification] Update progress error:", e);
  }
}

export function getPendingTransferNotifications(staffName?: string, warehouseId?: string): TransferNotification[] {
  const notifications = getTransferNotifications();
  return notifications.filter((t) => {
    if (!t) return false;
    // Exclude tasks that are waiting approval, completed, or cancelled
    if (t.status === "WAITING_APPROVAL") return false;
    if (t.status && t.status !== "PENDING" && t.status !== "ACKNOWLEDGED") return false;
    if (isTransferCompleted(t.id)) return false;

    // Filter by source warehouse if specified
    if (warehouseId && warehouseId !== "*") {
      const target = normalizeWarehouseId(warehouseId);
      const fromId = normalizeWarehouseId(t.from_warehouse_id || t.from_warehouse_name);

      // Staff can ONLY see tasks to be picked from the warehouse they are currently in
      if (fromId !== target) {
        return false;
      }
    }

    return true;
  });
}

const COMPLETED_KEY = "stockify_completed_transfers";

export function isTransferCompleted(id?: string, docNo?: string, productId?: string): boolean {
  if (typeof window === "undefined" || !id) return false;
  try {
    const raw = localStorage.getItem(COMPLETED_KEY);
    if (!raw) return false;
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return false;
    const idLower = String(id).trim().toLowerCase();
    if (!idLower) return false;

    return list.some((item) => {
      if (!item) return false;
      const lower = String(item).trim().toLowerCase();
      return lower === idLower;
    });
  } catch {
    return false;
  }
}

export function markTransferCompleted(id: string, docNo?: string, productId?: string) {
  if (!id || typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(COMPLETED_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const idLower = String(id).trim().toLowerCase();

    if (idLower && !list.includes(idLower)) {
      list.push(idLower);
    }
    localStorage.setItem(COMPLETED_KEY, JSON.stringify(list));

    const existing = getTransferNotifications();
    const updated = existing.map((t) => {
      const matchId = t.id && String(t.id).trim().toLowerCase() === idLower;
      if (matchId) {
        return { ...t, status: "COMPLETED" as const };
      }
      return t;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("stockify-transfer-updated"));
  } catch (e) {
    console.error("[TransferNotification] Mark completed error:", e);
  }
}

/**
 * Rollback ของ markTransferCompleted — ใช้เมื่อ optimistic UI สำเร็จแต่ server ล้มเหลว
 * ลบ id ออกจาก COMPLETED_KEY และคืนสถานะใน STORAGE_KEY กลับเป็น WAITING_APPROVAL
 * เพื่อไม่ให้รายการถูก force COMPLETED และกรองทิ้งตอน sync ถัดไป
 */
export function unmarkTransferCompleted(id: string) {
  if (!id || typeof window === "undefined") return;
  try {
    const idLower = String(id).trim().toLowerCase();
    if (!idLower) return;

    const raw = localStorage.getItem(COMPLETED_KEY);
    if (raw) {
      const list: unknown = JSON.parse(raw);
      if (Array.isArray(list)) {
        const filtered = list.filter(
          (item) => String(item || "").trim().toLowerCase() !== idLower
        );
        localStorage.setItem(COMPLETED_KEY, JSON.stringify(filtered));
      }
    }

    const existing = getTransferNotifications();
    const updated = existing.map((t) =>
      t.id && String(t.id).trim().toLowerCase() === idLower
        ? { ...t, status: "WAITING_APPROVAL" as const }
        : t
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    broadcastTransferChange();
  } catch (e) {
    console.error("[TransferNotification] Unmark completed error:", e);
  }
}

let syncChannel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    syncChannel = new BroadcastChannel("stockify_transfer_sync");
    syncChannel.onmessage = () => {
      window.dispatchEvent(new CustomEvent("stockify-transfer-updated"));
    };
  } catch {}
}

export function broadcastTransferChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("stockify-transfer-updated"));
  try {
    syncChannel?.postMessage("updated");
  } catch {}
}

export function saveTransferNotification(task: TransferNotification, options?: { silent?: boolean }) {
  if (typeof window === "undefined") return;
  try {
    const isCompleted = isTransferCompleted(task.id) || task.status === "COMPLETED";
    const cleanTask: TransferNotification = {
      ...task,
      product_name: getDisplayProductName(task),
      status: isCompleted ? "COMPLETED" : task.status,
    };

    const existing = getTransferNotifications();

    const isMatchTask = (t: TransferNotification) => {
      if (t.id && cleanTask.id && String(t.id).trim().toLowerCase() === String(cleanTask.id).trim().toLowerCase()) return true;
      return false;
    };

    const existingIndex = existing.findIndex(isMatchTask);
    const isNew = existingIndex === -1;

    if (!isNew) {
      const prev = existing[existingIndex];
      if (prev.status === "COMPLETED" || isCompleted) {
        cleanTask.status = "COMPLETED";
      } else if (cleanTask.status === "WAITING_APPROVAL") {
        cleanTask.status = "WAITING_APPROVAL";
        if (cleanTask.current_step === undefined) {
          cleanTask.current_step = prev.current_step || 4;
          cleanTask.current_step_text = prev.current_step_text || "ย้ายสินค้าแล้ว (รอ Admin อนุมัติ)";
        }
      }
      // If cleanTask does not have a current_step, or existing has a valid step and cleanTask has 0/undefined, preserve existing
      if (cleanTask.current_step === undefined && prev.current_step !== undefined) {
        cleanTask.current_step = prev.current_step;
        cleanTask.current_step_text = prev.current_step_text;
        cleanTask.last_active_at = prev.last_active_at;
      }
      const isGenericName = (name?: string) => {
        if (!name) return true;
        const lower = name.trim().toLowerCase();
        return (
          lower === "ผู้ดูแลระบบ (admin)" ||
          lower === "ผู้ดูแลระบบ" ||
          lower === "admin" ||
          lower === "ผู้สร้างใบเบิก" ||
          lower === "ผู้ใช้งาน"
        );
      };

      if (
        prev.created_by_name &&
        !isGenericName(prev.created_by_name) &&
        isGenericName(cleanTask.created_by_name)
      ) {
        cleanTask.created_by_name = prev.created_by_name;
      } else if (!cleanTask.created_by_name && prev.created_by_name) {
        cleanTask.created_by_name = prev.created_by_name;
      }

      if (!cleanTask.created_by && prev.created_by) {
        cleanTask.created_by = prev.created_by;
      }
    }

    let updated: TransferNotification[];
    if (!isNew) {
      // Update IN-PLACE to preserve list order and eliminate flickering/shuffling!
      updated = [...existing];
      updated[existingIndex] = cleanTask;
    } else {
      updated = [cleanTask, ...existing];
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated.slice(0, 100)));

    if (!options?.silent) {
      if (isNew && cleanTask.status === "PENDING") {
        window.dispatchEvent(new CustomEvent("stockify-transfer-created", { detail: cleanTask }));
      }
      broadcastTransferChange();
    }
  } catch (e) {
    console.error("[TransferNotification] Save error:", e);
  }
}

export function clearAllTransferNotifications() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    broadcastTransferChange();
  } catch {}
}

export function syncServerTransferNotifications(serverDocs: Array<Record<string, any>>) {
  if (typeof window === "undefined" || !Array.isArray(serverDocs)) return;
  try {
    const serverDoneDocIds = new Set<string>();
    const serverActiveDocIds = new Set<string>();
    const serverMappedTasks: TransferNotification[] = [];

    for (const doc of serverDocs) {
      if (!doc) continue;
      const docId = String(doc.document_id || doc.document_no || "").trim().toLowerCase();
      const status = String(doc.status || "").toUpperCase();

      // Safely parse metadata stored inside doc.note
      const meta = parseTransferMetadata(doc.note);

      const prodId = String(meta.product_id || doc.product_id || "").trim();
      const movedBy = String(
        meta.moved_by ||
        meta.assigned_to_name ||
        doc.assigned_to_name ||
        doc.moved_by ||
        ""
      ).trim();

      const rawFromWh = String(
        meta.from_warehouse_id ||
        doc.from_warehouse_id ||
        (meta.from_location_id ? detectWarehouseFromLocation(meta.from_location_id) : "") ||
        "wh-01"
      );
      const rawToWh = String(
        meta.to_warehouse_id ||
        doc.to_warehouse_id ||
        (meta.to_location_id ? detectWarehouseFromLocation(meta.to_location_id) : "") ||
        "wh-02"
      );
      const fromWhId = normalizeWarehouseId(rawFromWh);
      const toWhId = normalizeWarehouseId(rawToWh);
      const qty = Number(meta.qty !== undefined && meta.qty !== null ? meta.qty : (doc.qty || 1));
      const sku = String(meta.sku || doc.sku || (prodId && !prodId.startsWith("trf") ? prodId.replace(/^prod-/, "") : ""));
      const barcode = String(meta.barcode || doc.barcode || "");
      const productName = String(meta.product_name || doc.product_name || (sku ? `สินค้า ${sku}` : ""));
      const serverStep = typeof meta.current_step === "number" ? meta.current_step : typeof doc.current_step === "number" ? doc.current_step : undefined;
      const serverStepText = meta.current_step_text || doc.current_step_text || undefined;
      const serverLastActive = meta.last_active_at || doc.last_active_at || undefined;

      const createdBy = String(meta.created_by || doc.created_by || "").trim();
      const createdByName = String(
        meta.created_by_name ||
        doc.created_by_name ||
        (createdBy && !createdBy.toLowerCase().includes("admin") && !createdBy.startsWith("usr-") ? createdBy : "") ||
        ""
      ).trim();

      if (docId) serverActiveDocIds.add(docId);

      // Fix: A transfer document is only done if status is COMPLETED, CANCELLED, or REJECTED
      const isDone =
        status === "COMPLETED" ||
        status === "CANCELLED" ||
        status === "REJECTED";

      if (isDone) {
        if (docId) {
          serverDoneDocIds.add(docId);
          markTransferCompleted(docId);
        }
      } else {
        const fromWhName = getWarehouseName(fromWhId);
        const toWhName = getWarehouseName(toWhId);

        const notifStatus =
          status === "WAITING_APPROVAL" ||
          meta.status === "WAITING_APPROVAL"
            ? ("WAITING_APPROVAL" as const)
            : ("PENDING" as const);

        serverMappedTasks.push({
          id: docId || String(`trf-${Date.now()}`),
          doc_no: String(doc.document_no || doc.document_id || ""),
          product_id: prodId || "trf-item",
          product_name: productName || (sku ? `สินค้า ${sku}` : "รายการย้ายสินค้า"),
          sku: sku,
          barcode: barcode,
          from_warehouse_id: fromWhId,
          from_warehouse_name: fromWhName,
          to_warehouse_id: toWhId,
          to_warehouse_name: toWhName,
          qty: qty,
          moved_by: movedBy,
          assigned_to_user_id: String(meta.assigned_to_user_id || doc.assigned_to_user_id || "").trim(),
          assigned_to_name: String(meta.assigned_to_name || doc.assigned_to_name || movedBy || "").trim(),
          created_by: createdBy || "admin",
          created_by_name: createdByName || "ผู้ดูแลระบบ (Admin)",
          created_at: String(doc.created_at || new Date().toISOString()),
          status: notifStatus,
          current_step: serverStep ?? (notifStatus === "WAITING_APPROVAL" ? 4 : undefined),
          current_step_text: serverStepText || (notifStatus === "WAITING_APPROVAL" ? "ย้ายสินค้าแล้ว (รอ Admin อนุมัติ)" : undefined),
          last_active_at: serverLastActive,
          from_location_id: meta.from_location_id,
          to_location_id: meta.to_location_id,
          source_allocations: meta.source_allocations,
          note: String(meta.original_note || doc.note || ""),
        });
      }
    }

    const existing = getTransferNotifications();
    const updatedMap = new Map<string, TransferNotification>();

    // Seed with existing tasks
    for (const item of existing) {
      if (item && item.id) {
        const idLower = String(item.id).trim().toLowerCase();
        updatedMap.set(idLower, item);
      }
    }

    // Merge server tasks in batch
    for (const serverTask of serverMappedTasks) {
      const idLower = String(serverTask.id).trim().toLowerCase();
      const existingTask = updatedMap.get(idLower);

      if (existingTask) {
        // คงค่าข้อมูลสินค้าเดิมไว้เมื่อ server ส่งมาเป็นค่าว่าง/dummy
        // (note ในชีตโดนเขียนทับจน parse ไม่ได้ — ห้ามให้ sync ลบ sku/barcode ที่เคยแสดงอยู่ทิ้ง)
        const existingPid = (existingTask.product_id || "").trim();
        const existingSku = (existingTask.sku || "").trim();
        const existingBarcode = (existingTask.barcode || "").trim();
        const existingName = (existingTask.product_name || "").trim();
        const existingHasProduct =
          existingPid !== "" && existingPid.toLowerCase() !== "trf-item" && (existingSku !== "" || existingBarcode !== "" || existingName !== "");

        const serverHasProduct = Boolean(serverTask.sku.trim() || (serverTask.barcode || "").trim()) && serverTask.product_id.trim().toLowerCase() !== "trf-item";

        // เก็บ note เดิมไว้ถ้า note จาก server ไม่มีข้อมูลสินค้า (progress-only) แต่ของเดิมเคยมี
        const serverNoteMeta = parseTransferMetadata(serverTask.note);
        const existingNoteMeta = parseTransferMetadata(existingTask.note || "");
        const keepExistingNote = Boolean(
          existingTask.note && !serverNoteMeta.sku && (existingNoteMeta.sku || existingHasProduct)
        );

        // ตำแหน่ง/ผู้เบิกที่พนักงานสแกนไว้ตอน submit — server ส่งว่างเมื่อ note โดนทับ ห้ามลบของเดิม
        const merged: TransferNotification = {
          ...serverTask,
          product_id: !serverHasProduct && existingHasProduct ? existingPid : serverTask.product_id,
          sku: !serverHasProduct && existingSku ? existingSku : serverTask.sku,
          barcode: !(serverTask.barcode || "").trim() && existingBarcode ? existingBarcode : serverTask.barcode,
          product_name:
            (!serverTask.product_name.trim() || serverTask.product_name === "รายการย้ายสินค้า") && existingName
              ? existingName
              : serverTask.product_name,
          from_location_id: !serverTask.from_location_id ? existingTask.from_location_id : serverTask.from_location_id,
          to_location_id: !serverTask.to_location_id ? existingTask.to_location_id : serverTask.to_location_id,
          location_code: !serverTask.location_code ? existingTask.location_code : serverTask.location_code,
          source_allocations:
            (!serverTask.source_allocations || serverTask.source_allocations.length === 0) && existingTask.source_allocations
              ? existingTask.source_allocations
              : serverTask.source_allocations,
          moved_by: !serverTask.moved_by.trim() ? existingTask.moved_by : serverTask.moved_by,
          assigned_to_name: !serverTask.assigned_to_name?.trim() ? existingTask.assigned_to_name : serverTask.assigned_to_name,
          note: keepExistingNote ? existingTask.note : serverTask.note,
          status: existingTask.status === "COMPLETED" ? "COMPLETED" : serverTask.status,
          current_step: existingTask.current_step !== undefined ? existingTask.current_step : serverTask.current_step,
          current_step_text: existingTask.current_step_text || serverTask.current_step_text,
          last_active_at: existingTask.last_active_at || serverTask.last_active_at,
          created_by_name: existingTask.created_by_name || serverTask.created_by_name,
        };
        updatedMap.set(idLower, merged);
      } else {
        updatedMap.set(idLower, {
          ...serverTask,
          product_name: getDisplayProductName(serverTask),
        });
      }
    }

    // Filter out completed and purged tasks
    const mergedList = Array.from(updatedMap.values()).filter((item) => {
      const itemId = String(item.id || "").trim().toLowerCase();
      if (itemId && serverDoneDocIds.has(itemId)) return false;
      if (isTransferCompleted(item.id)) return false;

      const isServerSynced = itemId && serverActiveDocIds.has(itemId);
      const createdAt = new Date(item.created_at || 0).getTime();
      const ageMs = Date.now() - createdAt;
      if (!isServerSynced && ageMs > 180000) return false;

      return true;
    });

    // Stably sort: newest first
    mergedList.sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return (b.doc_no || "").localeCompare(a.doc_no || "");
    });

    const rawExisting = localStorage.getItem(STORAGE_KEY);
    const newJson = JSON.stringify(mergedList.slice(0, 100));

    // ONLY write to localStorage and broadcast if data actually changed!
    if (rawExisting !== newJson) {
      localStorage.setItem(STORAGE_KEY, newJson);
      broadcastTransferChange();
    }
  } catch (e) {
    console.error("[TransferNotification] Sync server error:", e);
  }
}

let globalSyncPromise: Promise<void> | null = null;
let lastSyncTimestamp = 0;

export async function fetchAndSyncTransferNotifications(): Promise<void> {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (globalSyncPromise && now - lastSyncTimestamp < 3000) {
    try {
      await globalSyncPromise;
    } catch {}
    return;
  }

  lastSyncTimestamp = now;
  const promise = (async () => {
    try {
      const headers: Record<string, string> = {};
      try {
        const stored =
          (typeof window !== "undefined" && sessionStorage.getItem("stockify_tab_session")) ||
          (typeof window !== "undefined" && localStorage.getItem("stockify_tab_session"));
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.token) {
            headers["x-tab-token"] = parsed.token;
            headers["authorization"] = `Bearer ${parsed.token}`;
          }
        }
      } catch {}

      let res: Response | null = null;
      try {
        res = await fetch(`/api/movements/transfer`, {
          cache: "no-store",
          headers,
        });
      } catch {
        res = null;
      }

      if (!res || !res.ok) {
        try {
          res = await fetch(`/api/movements/transfer/assigned`, {
            cache: "no-store",
            headers,
          });
        } catch {
          res = null;
        }
      }

      if (!res || !res.ok) return;
      const json = await res.json().catch(() => null);
      if (json && json.success && Array.isArray(json.data)) {
        syncServerTransferNotifications(json.data);
      }
    } catch {
      // Gracefully ignore transient background sync errors
    }
  })();

  globalSyncPromise = promise;
  try {
    await promise;
  } finally {
    if (globalSyncPromise === promise) {
      globalSyncPromise = null;
    }
  }
}
