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
    window.dispatchEvent(new CustomEvent("stockify-transfer-updated"));
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
            current_step: 3,
            current_step_text: "ย้ายสินค้าแล้ว (รอ Admin อนุมัติ)",
            from_location_id: details?.from_location_id || t.from_location_id,
            to_location_id: details?.to_location_id || t.to_location_id,
            source_allocations: details?.source_allocations || t.source_allocations,
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
                : step === 4
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

function normWh(id?: string): string {
  if (!id) return "";
  const s = String(id).trim().toLowerCase();
  if (s === "โกดัง 1" || s === "โกดัง1" || s === "wh-1" || s === "wh-01" || s === "1") return "wh-1";
  if (s === "โกดัง 2" || s === "โกดัง2" || s === "wh-2" || s === "wh-02" || s === "2") return "wh-2";
  return s.replace(/^wh-0*/, "wh-");
}

export function getPendingTransferNotifications(staffName?: string, warehouseId?: string): TransferNotification[] {
  const notifications = getTransferNotifications();
  return notifications.filter((t) => {
    if (!t) return false;
    // Exclude tasks that are waiting approval, completed, or cancelled
    if (t.status === "WAITING_APPROVAL" || t.current_step === 3) return false;
    if (t.status && t.status !== "PENDING") return false;
    if (isTransferCompleted(t.id)) return false;

    const movedByRaw = String(t.moved_by || "").trim();
    const staffNameRaw = String(staffName || "").trim();

    if (staffNameRaw && staffNameRaw !== "ผู้ใช้งานระบบ" && movedByRaw) {
      const cleanStaff = staffNameRaw.toLowerCase();
      const cleanMovedBy = movedByRaw.replace(/^(?:คนไปย้ายสินค้า|มอบหมาย|ย้ายโดย):\s*/i, "").toLowerCase();

      const isGenericStaff =
        !cleanMovedBy ||
        cleanMovedBy === "พนักงาน" ||
        cleanMovedBy === "พนักงานโกดัง" ||
        cleanMovedBy === "ผู้ใช้งานระบบ" ||
        cleanStaff === "พนักงาน" ||
        cleanStaff === "พนักงานโกดัง";

      if (!isGenericStaff) {
        const staffTokens = cleanStaff.split(/\s+/).filter(Boolean);
        const movedByTokens = cleanMovedBy.split(/\s+/).filter(Boolean);

        const tokenMatch = staffTokens.some((st) => movedByTokens.some((mt) => mt.includes(st) || st.includes(mt)));
        const directMatch = cleanMovedBy.includes(cleanStaff) || cleanStaff.includes(cleanMovedBy);

        if (!tokenMatch && !directMatch) return false;
      }
    }

    if (warehouseId && warehouseId !== "*") {
      const target = normWh(warehouseId);
      const fromId = normWh(t.from_warehouse_id);
      const fromName = normWh(t.from_warehouse_name);
      const toId = normWh(t.to_warehouse_id);
      const toName = normWh(t.to_warehouse_name);

      const matchesFrom = fromId === target || fromName === target;
      const matchesTo = toId === target || toName === target;

      // Show notification if target warehouse matches source or destination, or if warehouse info is unassigned
      if ((fromId || toId || fromName || toName) && !matchesFrom && !matchesTo) {
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
      if (existing[existingIndex].status === "COMPLETED" || isCompleted) {
        cleanTask.status = "COMPLETED";
      } else if (
        existing[existingIndex].status === "WAITING_APPROVAL" ||
        existing[existingIndex].current_step === 3
      ) {
        if (cleanTask.status !== "COMPLETED" && cleanTask.status !== "CANCELLED" && cleanTask.status !== "REJECTED") {
          cleanTask.status = "WAITING_APPROVAL";
          cleanTask.current_step = 3;
          cleanTask.current_step_text = "ย้ายสินค้าแล้ว (รอ Admin อนุมัติ)";
        }
      }
      // If cleanTask does not have a current_step, or existing has a valid step and cleanTask has 0/undefined, preserve existing
      if (cleanTask.current_step === undefined && existing[existingIndex].current_step !== undefined) {
        cleanTask.current_step = existing[existingIndex].current_step;
        cleanTask.current_step_text = existing[existingIndex].current_step_text;
        cleanTask.last_active_at = existing[existingIndex].last_active_at;
      }
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
    const serverActiveDocIds = new Set<string>();

    for (const doc of serverDocs) {
      if (!doc) continue;
      const docId = String(doc.document_id || doc.document_no || "").trim().toLowerCase();
      const status = String(doc.status || "").toUpperCase();

      // Safely parse JSON metadata stored inside doc.note
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let meta: Record<string, any> = {};
      if (doc.note && typeof doc.note === "string" && doc.note.startsWith("{")) {
        try {
          meta = JSON.parse(doc.note);
        } catch {}
      }

      const prodId = String(meta.product_id || doc.product_id || "").trim();
      const movedBy = String(
        meta.moved_by ||
        meta.assigned_to_name ||
        doc.assigned_to_name ||
        doc.moved_by ||
        (typeof doc.note === "string" && doc.note.match(/(?:คนไปย้ายสินค้า|มอบหมาย|ย้ายโดย):\s*([^|]+)/i)?.[1]?.trim()) ||
        ""
      ).trim();

      const fromWhId = String(meta.from_warehouse_id || doc.from_warehouse_id || "wh-1");
      const toWhId = String(meta.to_warehouse_id || doc.to_warehouse_id || "wh-2");
      const qty = Number(meta.qty || doc.qty) || 1;
      const sku = String(meta.sku || doc.sku || (prodId && !prodId.startsWith("trf") ? prodId.replace(/^prod-/, "") : ""));
      const barcode = String(meta.barcode || doc.barcode || "");
      const productName = String(meta.product_name || doc.product_name || (sku ? `สินค้า ${sku}` : ""));
      const serverStep = typeof meta.current_step === "number" ? meta.current_step : typeof doc.current_step === "number" ? doc.current_step : undefined;
      const serverStepText = meta.current_step_text || doc.current_step_text || undefined;
      const serverLastActive = meta.last_active_at || doc.last_active_at || undefined;

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
        const fromWhName =
          fromWhId === "wh-1" || fromWhId === "wh-01"
            ? "โกดัง 1"
            : fromWhId === "wh-2" || fromWhId === "wh-02"
            ? "โกดัง 2"
            : fromWhId;

        const toWhName =
          toWhId === "wh-1" || toWhId === "wh-01"
            ? "โกดัง 1"
            : toWhId === "wh-2" || toWhId === "wh-02"
            ? "โกดัง 2"
            : toWhId;

        const notifStatus =
          status === "WAITING_APPROVAL" ||
          meta.status === "WAITING_APPROVAL" ||
          serverStep === 3 ||
          meta.current_step === 3
            ? ("WAITING_APPROVAL" as const)
            : ("PENDING" as const);

        saveTransferNotification(
          {
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
            created_at: String(doc.created_at || new Date().toISOString()),
            status: notifStatus,
            current_step: serverStep || (notifStatus === "WAITING_APPROVAL" ? 3 : undefined),
            current_step_text: serverStepText || (notifStatus === "WAITING_APPROVAL" ? "ย้ายสินค้าแล้ว (รอ Admin อนุมัติ)" : undefined),
            last_active_at: serverLastActive,
            from_location_id: meta.from_location_id,
            to_location_id: meta.to_location_id,
            source_allocations: meta.source_allocations,
            note: String(meta.original_note || doc.note || ""),
          },
          { silent: true }
        );
      }
    }

    const latest = getTransferNotifications();
    const cleaned = latest.filter((item) => {
      const itemId = String(item.id || "").trim().toLowerCase();

      if (itemId && serverDoneDocIds.has(itemId)) {
        return false;
      }
      if (isTransferCompleted(item.id)) {
        return false;
      }

      // Purge ghost notifications if deleted from server Documents sheet
      const isServerSynced = itemId && serverActiveDocIds.has(itemId);
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

      let res = await fetch(`/api/movements/transfer?_t=${now}`, {
        cache: "no-store",
        headers,
      });

      if (!res.ok) {
        res = await fetch(`/api/movements/transfer/assigned?_t=${now}`, {
          cache: "no-store",
          headers,
        });
      }

      if (!res.ok) return;
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        syncServerTransferNotifications(json.data);
      }
    } catch (e) {
      console.error("[TransferNotification] Sync server error:", e);
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
