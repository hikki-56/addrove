"use client";

export type ExpressItemType = "RECEIVE" | "ISSUE" | "TRANSFER";
export type ExpressSyncStatus = "PENDING" | "IMPORTED";

export interface TaggedExpressItem {
  id: string; // unique item id (e.g. `rec_${docId}_${sku}_${idx}` or `iss_${movementId}`)
  type: ExpressItemType;
  tag: string; // e.g. "ล็อตด่วน", "รอนำเข้า Express", "รอบบ่าย"
  status: ExpressSyncStatus; // "PENDING" | "IMPORTED"
  tagged_at: string;
  imported_at?: string;
  sku: string;
  barcode: string;
  product_name: string;
  quantity: number;
  location: string;
  warehouse: string;
  warehouse_code?: string;
  from_warehouse?: string;
  to_warehouse?: string;
  from_warehouse_code?: string;
  to_warehouse_code?: string;
  document_no: string;
  document_date: string;
  supplier?: string;
  note?: string;
}

const STORAGE_KEY = "stockify_express_tagged_items_v1";

// ทนได้ถึงเท่าไหร่ — polling ทุก 6-12 วิเคยยัด "ทุกรายการที่เคยแสดง" ลง storage จนเสี่ยง QuotaExceeded (5MB)
const MAX_STORED_ITEMS = 800;
const IMPORTED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function pruneStoredItems(items: TaggedExpressItem[]): TaggedExpressItem[] {
  if (items.length <= MAX_STORED_ITEMS) return items;
  // ตัดรายการที่ "นำเข้าแล้ว" เก่ากว่า 7 วันออกก่อน (สถานะจริงอยู่บนชีตอยู่แล้ว) แล้วค่อย cap ที่ 800
  const cutoff = Date.now() - IMPORTED_RETENTION_MS;
  const kept = items.filter((i) => i.status !== "IMPORTED" || Date.parse(i.tagged_at || "") > cutoff);
  return kept.length > MAX_STORED_ITEMS ? kept.slice(0, MAX_STORED_ITEMS) : kept;
}

function getStoredItems(): TaggedExpressItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Error reading express tagged items:", e);
    return [];
  }
}

function saveStoredItems(items: TaggedExpressItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruneStoredItems(items)));
    window.dispatchEvent(new CustomEvent("stockify-express-tags-updated", { detail: items }));
    window.dispatchEvent(new Event("storage"));
  } catch (e) {
    console.error("Error saving express tagged items:", e);
  }
}

export function getAllTaggedExpressItems(type?: ExpressItemType): TaggedExpressItem[] {
  const items = getStoredItems();
  if (!type) return items;
  return items.filter((item) => item.type === type);
}

export function isItemTaggedForExpress(id: string): boolean {
  const items = getStoredItems();
  return items.some((item) => item.id === id);
}

export function getTaggedItemById(id: string): TaggedExpressItem | undefined {
  const items = getStoredItems();
  return items.find((item) => item.id === id);
}

export function tagExpressItem(item: Omit<TaggedExpressItem, "tagged_at" | "status"> & { status?: ExpressSyncStatus }): TaggedExpressItem {
  const items = getStoredItems();
  const existingIdx = items.findIndex((i) => i.id === item.id);
  const now = new Date().toISOString();

  const newItem: TaggedExpressItem = {
    ...item,
    status: item.status ?? "PENDING",
    tag: item.tag?.trim() || "รอนำเข้า Express",
    tagged_at: now,
  };

  let updated: TaggedExpressItem[];
  if (existingIdx >= 0) {
    updated = [...items];
    updated[existingIdx] = { ...updated[existingIdx], ...newItem };
  } else {
    updated = [newItem, ...items];
  }

  saveStoredItems(updated);
  return newItem;
}

export function batchTagExpressItems(newItems: Array<Omit<TaggedExpressItem, "tagged_at" | "status"> & { status?: ExpressSyncStatus }>) {
  const items = getStoredItems();
  const itemMap = new Map<string, TaggedExpressItem>(items.map((i) => [i.id, i]));
  const now = new Date().toISOString();

  newItems.forEach((item) => {
    const existing = itemMap.get(item.id);
    // ใช้ ?? ไม่ใช่ || — caller ที่ไม่ส่ง status หมายถึง "คงค่าเดิม" ไม่ใช่บังคับ PENDING
    // (เดิม "PENDING" เป็น truthy ทำให้ค่า IMPORTED ที่เพิ่งกดถูกทับเสมอเมื่อ caller ส่ง status มา)
    const mergedStatus = item.status ?? existing?.status ?? "PENDING";
    itemMap.set(item.id, {
      ...item,
      status: mergedStatus,
      imported_at: mergedStatus === "IMPORTED" ? existing?.imported_at || now : undefined,
      tag: item.tag?.trim() || existing?.tag || "รอนำเข้า Express",
      tagged_at: existing?.tagged_at || now,
    });
  });

  saveStoredItems(Array.from(itemMap.values()));
}

export function untagExpressItem(id: string) {
  const items = getStoredItems();
  const updated = items.filter((i) => i.id !== id);
  saveStoredItems(updated);
}

export function batchUntagExpressItems(ids: string[]) {
  const idSet = new Set(ids);
  const items = getStoredItems();
  const updated = items.filter((i) => !idSet.has(i.id));
  saveStoredItems(updated);
}

export function updateExpressItemStatus(id: string, status: ExpressSyncStatus) {
  const items = getStoredItems();
  const updated = items.map((item) => {
    if (item.id === id) {
      return {
        ...item,
        status,
        imported_at: status === "IMPORTED" ? new Date().toISOString() : undefined,
      };
    }
    return item;
  });
  saveStoredItems(updated);
}

export function batchUpdateExpressItemStatus(ids: string[], status: ExpressSyncStatus) {
  const idSet = new Set(ids);
  const now = new Date().toISOString();
  const items = getStoredItems();
  const updated = items.map((item) => {
    if (idSet.has(item.id)) {
      return {
        ...item,
        status,
        imported_at: status === "IMPORTED" ? now : undefined,
      };
    }
    return item;
  });
  saveStoredItems(updated);
}

export function clearImportedExpressItems(type?: ExpressItemType) {
  const items = getStoredItems();
  const updated = items.filter((i) => {
    if (type && i.type !== type) return true;
    return i.status !== "IMPORTED";
  });
  saveStoredItems(updated);
}

export function getExpressTagCounts(type?: ExpressItemType) {
  const items = getAllTaggedExpressItems(type);
  const pending = items.filter((i) => i.status === "PENDING").length;
  const imported = items.filter((i) => i.status === "IMPORTED").length;
  return { total: items.length, pending, imported };
}

export function updateExpressItemWarehouse(id: string, fromWarehouse: string, toWarehouse: string): TaggedExpressItem | undefined {
  const items = getStoredItems();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return undefined;

  const item = items[idx];
  const updated: TaggedExpressItem = {
    ...item,
    from_warehouse: fromWarehouse,
    to_warehouse: toWarehouse,
    warehouse: `${fromWarehouse} -> ${toWarehouse}`,
  };

  items[idx] = updated;
  saveStoredItems(items);
  return updated;
}

// ── คิว retry การเปลี่ยนสถานะ Express ──────────────────────────────────────
// เดิม toast สัญญา "ระบบจะลองใหม่อัตโนมัติ" แต่ไม่มี retry จริง — สถานะที่ผู้ใช้กด
// เด้งกลับเงียบ ๆ หลัง polling รอบถัดไป ทีม Express อาจจัดของซ้ำ/ไม่รู้สถานะจริง

export interface ExpressStatusRetryItem {
  type: ExpressItemType;
  document_no: string;
  raw_document_no?: string;
  sku?: string;
  status: ExpressSyncStatus;
  attempts: number;
  queued_at: string;
}

const RETRY_KEY = "stockify_express_status_retry_v1";
const MAX_RETRY_ATTEMPTS = 6;
const RETRY_BASE_DELAY_MS = 30_000;

function getRetryQueue(): ExpressStatusRetryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RETRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRetryQueue(items: ExpressStatusRetryItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RETRY_KEY, JSON.stringify(items));
  } catch (e) {
    console.error("Error saving express status retry queue:", e);
  }
}

export function expressRetryItemKey(
  item: Pick<ExpressStatusRetryItem, "type" | "document_no" | "sku">
): string {
  return `${item.type}|${item.document_no.trim().toLowerCase()}|${(item.sku || "").trim().toLowerCase()}`;
}

/** เก็บรายการที่ sync สถานะเข้าชีตไม่สำเร็จ ไว้ลองใหม่ในรอบ polling ถัด ๆ ไป */
export function queueExpressStatusRetry(
  items: Array<Pick<ExpressStatusRetryItem, "type" | "document_no" | "raw_document_no" | "sku" | "status">>
) {
  const queue = getRetryQueue();
  const now = new Date().toISOString();
  items.forEach((item) => {
    const key = expressRetryItemKey(item);
    const existing = queue.find((q) => expressRetryItemKey(q) === key);
    if (existing) {
      existing.status = item.status;
      existing.raw_document_no = item.raw_document_no ?? existing.raw_document_no;
    } else {
      queue.push({ ...item, attempts: 0, queued_at: now });
    }
  });
  saveRetryQueue(queue);
}

/** รายการที่ถึงเวลาลองใหม่แล้ว (backoff 30 วิ → 1 นาที → 2 นาที … สูงสุด 6 ครั้ง) */
export function getDueExpressStatusRetries(
  type?: ExpressItemType,
  now: Date = new Date()
): ExpressStatusRetryItem[] {
  return getRetryQueue().filter((q) => {
    if (type && q.type !== type) return false;
    if (q.attempts >= MAX_RETRY_ATTEMPTS) return false;
    const dueAt = Date.parse(q.queued_at) + RETRY_BASE_DELAY_MS * Math.pow(2, q.attempts);
    return now.getTime() >= dueAt;
  });
}

/** นับครั้งที่พยายาม + เลื่อนเวลาลองครั้งถัดไป (รายการที่เกินจำนวนครั้งตกออกจากคิวเอง) */
export function markExpressStatusRetryAttempt(
  item: Pick<ExpressStatusRetryItem, "type" | "document_no" | "sku">
) {
  const queue = getRetryQueue();
  const key = expressRetryItemKey(item);
  const existing = queue.find((q) => expressRetryItemKey(q) === key);
  if (!existing) return;
  existing.attempts += 1;
  existing.queued_at = new Date().toISOString();
  saveRetryQueue(queue.filter((q) => q.attempts < MAX_RETRY_ATTEMPTS));
}

/** นำออกจากคิวเมื่อ sync สำเร็จ */
export function removeExpressStatusRetry(
  items: Array<Pick<ExpressStatusRetryItem, "type" | "document_no" | "sku">>
) {
  const keys = new Set(items.map(expressRetryItemKey));
  saveRetryQueue(getRetryQueue().filter((q) => !keys.has(expressRetryItemKey(q))));
}
