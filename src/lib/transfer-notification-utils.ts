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
  created_at: string;
  created_by?: string;
  status: "PENDING" | "ACKNOWLEDGED" | "COMPLETED" | "CANCELLED";
  location_code?: string;
  note?: string;
}

const STORAGE_KEY = "stockify_transfer_notifications";

export function getDisplayProductName(t?: { product_name?: string; note?: string; sku?: string; product_id?: string }): string {
  if (!t) return "รายการย้ายสินค้า";
  const str = t.product_name || t.note || "";
  let cleaned = str.replace(/คนไปย้ายสินค้า.*?(?=\||$)/gi, "").replace(/^[|\s]+|[|\s]+$/g, "").trim();
  if (!cleaned && t.note) {
    cleaned = t.note.replace(/คนไปย้ายสินค้า.*?(?=\||$)/gi, "").replace(/^[|\s]+|[|\s]+$/g, "").trim();
  }
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
    return parsed.map((t) => {
      const completed = isTransferCompleted(t.id) || isTransferCompleted(t.doc_no);
      return {
        ...t,
        product_name: getDisplayProductName(t),
        status: completed ? "COMPLETED" : t.status,
      };
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
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: TransferNotification[] = JSON.parse(raw);
    const cleaned = parsed.filter((t) => {
      // Keep notifications that have real product data
      const hasBadSku = !t.sku || t.sku === "TRF" || t.sku.startsWith("TRF-");
      const hasBadPid = !t.product_id || t.product_id === "TRF" || t.product_id.startsWith("TRF-");
      const hasDummyToWh = t.to_warehouse_name === "โกดังปลายทาง" || !t.to_warehouse_name;
      
      // Remove entries where product data is bad or destination warehouse is unassigned/dummy
      if ((hasBadSku && hasBadPid) || hasDummyToWh) return false;
      return true;
    });
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    }
  } catch (e) {
    console.error("[TransferNotification] Purge error:", e);
  }
}

export function markTransferNotificationAcknowledged(id: string) {
  if (typeof window === "undefined") return;
  try {
    const existing = getTransferNotifications();
    const targetLower = id.toLowerCase();
    const updated = existing.map((t) =>
      t.id && t.id.toLowerCase() === targetLower
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
    const targetLower = id.toLowerCase();
    const updated = existing.map((t) =>
      t.id && t.id.toLowerCase() === targetLower
        ? { ...t, status: "CANCELLED" as const }
        : t
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("stockify-transfer-updated"));
  } catch (e) {
    console.error("[TransferNotification] Mark cancelled error:", e);
  }
}

function normWh(id?: string): string {
  if (!id) return "";
  return id.trim().toLowerCase().replace(/^wh-0*/, "wh-");
}

export function getPendingTransferNotifications(staffName?: string, warehouseId?: string): TransferNotification[] {
  const notifications = getTransferNotifications();
  return notifications.filter((t) => {
    if (t.status && t.status !== "PENDING") return false;
    if (isTransferCompleted(t.id, t.doc_no, t.product_id)) return false;

    if (staffName && staffName.trim() !== "" && staffName !== "ผู้ใช้งานระบบ" && t.moved_by) {
      const cleanStaff = staffName.trim().toLowerCase();
      const cleanMovedBy = t.moved_by.replace(/^(?:คนไปย้ายสินค้า|มอบหมาย|ย้ายโดย):\s*/i, "").trim().toLowerCase();

      const staffTokens = cleanStaff.split(/\s+/).filter(Boolean);
      const movedByTokens = cleanMovedBy.split(/\s+/).filter(Boolean);

      const tokenMatch = staffTokens.some((st) => movedByTokens.some((mt) => mt.includes(st) || st.includes(mt)));
      const directMatch = cleanMovedBy.includes(cleanStaff) || cleanStaff.includes(cleanMovedBy);

      if (!tokenMatch && !directMatch) return false;
    }

    if (warehouseId) {
      const target = normWh(warehouseId);
      const from = normWh(t.from_warehouse_id);
      const to = normWh(t.to_warehouse_id);

      if (from && to && from !== target && to !== target) {
        return false;
      }
    }

    return true;
  });
}

const COMPLETED_KEY = "stockify_completed_transfers";

export function isTransferCompleted(id?: string, docNo?: string, productId?: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(COMPLETED_KEY);
    if (!raw) return false;
    const list: string[] = JSON.parse(raw);
    const idLower = (id || "").toLowerCase();
    const docNoLower = (docNo || "").toLowerCase();
    const prodIdLower = (productId || "").toLowerCase();

    return list.some((item) => {
      if (typeof item !== "string") return false;
      const lower = item.toLowerCase();
      if (idLower && lower === idLower) return true;
      if (docNoLower && prodIdLower && lower === `${docNoLower}_${prodIdLower}`) return true;
      return false;
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
    const idLower = id.toLowerCase();
    const docNoLower = (docNo || "").toLowerCase();
    const prodIdLower = (productId || "").toLowerCase();

    if (!list.includes(idLower)) {
      list.push(idLower);
    }
    if (docNoLower && prodIdLower) {
      const key = `${docNoLower}_${prodIdLower}`;
      if (!list.includes(key)) {
        list.push(key);
      }
    }
    localStorage.setItem(COMPLETED_KEY, JSON.stringify(list));

    const existing = getTransferNotifications();
    const updated = existing.map((t) => {
      const matchId = t.id && t.id.toLowerCase() === idLower;
      const matchComposite =
        docNoLower && prodIdLower && t.doc_no && t.product_id &&
        t.doc_no.toLowerCase() === docNoLower &&
        t.product_id.toLowerCase() === prodIdLower;

      if (matchId || matchComposite) {
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
    const isCompleted = isTransferCompleted(task.id) || isTransferCompleted(task.doc_no) || task.status === "COMPLETED";
    const cleanTask: TransferNotification = {
      ...task,
      product_name: getDisplayProductName(task),
      status: isCompleted ? "COMPLETED" : task.status,
    };

    const existing = getTransferNotifications();

    const isMatchTask = (t: TransferNotification) => {
      if (t.id && cleanTask.id && t.id.toLowerCase() === cleanTask.id.toLowerCase()) return true;
      if (
        t.doc_no && cleanTask.doc_no &&
        t.doc_no.toLowerCase() === cleanTask.doc_no.toLowerCase() &&
        t.product_id && cleanTask.product_id &&
        t.product_id.toLowerCase() === cleanTask.product_id.toLowerCase()
      ) return true;
      return false;
    };

    const existingIndex = existing.findIndex(isMatchTask);
    const isNew = existingIndex === -1;

    if (!isNew && (existing[existingIndex].status === "COMPLETED" || isCompleted)) {
      cleanTask.status = "COMPLETED";
    }

    const filtered = existing.filter((t) => !isMatchTask(t));

    const updated = [cleanTask, ...filtered];
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function syncServerTransferNotifications(serverDocs: Array<Record<string, any>>) {
  if (typeof window === "undefined" || !Array.isArray(serverDocs)) return;
  try {
    const serverDoneDocIds = new Set<string>();
    const serverActiveKeys = new Set<string>();
    const pendingDocIds = new Set<string>();
    const pendingCompositeKeys = new Set<string>();

    for (const doc of serverDocs) {
      const docId = (doc.document_id || "").trim().toLowerCase();
      const docNo = (doc.document_no || "").trim().toLowerCase();
      const prodId = (doc.product_id || "").trim().toLowerCase();
      const status = (doc.status || "").toUpperCase();

      if (docId) serverActiveKeys.add(docId);
      if (docNo) serverActiveKeys.add(docNo);
      if (docNo && prodId) serverActiveKeys.add(`${docNo}_${prodId}`);

      const isDone =
        status === "COMPLETED" ||
        status === "CANCELLED" ||
        status === "APPROVED" ||
        status === "POSTED" ||
        status === "REJECTED";

      if (isDone) {
        if (docId) serverDoneDocIds.add(docId);
        if (docNo && doc.product_id) serverDoneDocIds.add(`${docNo}_${doc.product_id.toLowerCase()}`);
        if (docId) markTransferCompleted(docId, docNo, doc.product_id);
      } else {
        if (docId) pendingDocIds.add(docId);
        if (docNo) pendingDocIds.add(docNo);
        if (docNo && prodId) pendingCompositeKeys.add(`${docNo}_${prodId}`);

        const movedBy = doc.moved_by || (doc.note?.match(/(?:คนไปย้ายสินค้า|มอบหมาย|ย้ายโดย):\s*([^|]+)/i)?.[1]?.trim() || "");

        saveTransferNotification(
          {
            id: doc.document_id || doc.document_no || `trf-${Date.now()}`,
            doc_no: doc.document_no || doc.document_id || "",
            product_id: doc.product_id || "",
            product_name: doc.product_name || "รายการย้ายสินค้า",
            sku: doc.sku || "",
            barcode: doc.barcode || "",
            from_warehouse_id: doc.from_warehouse_id || "wh-1",
            from_warehouse_name: doc.from_warehouse_name || "โกดัง1",
            to_warehouse_id: doc.to_warehouse_id || "wh-2",
            to_warehouse_name: doc.to_warehouse_name || "โกดัง2",
            qty: doc.qty || 1,
            moved_by: movedBy,
            created_at: doc.created_at || new Date().toISOString(),
            status: "PENDING",
            note: doc.note || "",
          },
          { silent: true }
        );
      }
    }

    // Clean up stockify_completed_transfers so PENDING server documents are NEVER blocked by stale completed keys
    if (pendingDocIds.size > 0 || pendingCompositeKeys.size > 0) {
      const rawCompleted = localStorage.getItem(COMPLETED_KEY);
      if (rawCompleted) {
        try {
          const completedList: string[] = JSON.parse(rawCompleted);
          const cleanedCompleted = completedList.filter((itemKey) => {
            const keyLower = String(itemKey).toLowerCase();
            if (pendingDocIds.has(keyLower)) return false;
            if (pendingCompositeKeys.has(keyLower)) return false;
            return true;
          });
          if (cleanedCompleted.length !== completedList.length) {
            localStorage.setItem(COMPLETED_KEY, JSON.stringify(cleanedCompleted));
          }
        } catch {}
      }
    }

    const latest = getTransferNotifications();
    const cleaned = latest.filter((item) => {
      const itemId = (item.id || "").toLowerCase();
      const itemDocNo = (item.doc_no || "").toLowerCase();
      const itemProdId = (item.product_id || "").toLowerCase();
      const compositeKey = itemDocNo && itemProdId ? `${itemDocNo}_${itemProdId}` : "";

      if (
        (itemId && serverDoneDocIds.has(itemId)) ||
        (compositeKey && serverDoneDocIds.has(compositeKey)) ||
        isTransferCompleted(item.id, item.doc_no, item.product_id)
      ) {
        return false;
      }

      // Purge ghost notifications if deleted from server Documents sheet
      const isServerSynced =
        (itemId && serverActiveKeys.has(itemId)) ||
        (itemDocNo && serverActiveKeys.has(itemDocNo)) ||
        (compositeKey && serverActiveKeys.has(compositeKey));

      const createdAt = new Date(item.created_at || 0).getTime();
      const ageMs = Date.now() - createdAt;

      if (!isServerSynced && ageMs > 180000) {
        return false;
      }

      return true;
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    broadcastTransferChange();
  } catch (e) {
    console.error("[TransferNotification] Sync server error:", e);
  }
}

let globalSyncPromise: Promise<void> | null = null;
let lastSyncTimestamp = 0;

export function fetchAndSyncTransferNotifications(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const now = Date.now();
  if (globalSyncPromise && now - lastSyncTimestamp < 3000) {
    return globalSyncPromise;
  }

  lastSyncTimestamp = now;
  globalSyncPromise = fetch(`/api/movements/transfer?_t=${now}`, { cache: "no-store" })
    .then((r) => r.json())
    .then((res) => {
      if (res.success && Array.isArray(res.data)) {
        syncServerTransferNotifications(res.data);
      }
    })
    .catch(() => {})
    .finally(() => {
      globalSyncPromise = null;
    });

  return globalSyncPromise;
}
