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
  document_no: string;
  document_date: string;
  supplier?: string;
  note?: string;
}

const STORAGE_KEY = "stockify_express_tagged_items_v1";

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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
    status: item.status || "PENDING",
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
    itemMap.set(item.id, {
      ...item,
      status: item.status || existing?.status || "PENDING",
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
