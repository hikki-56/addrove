"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import ScrollSelect from "@/components/ui/ScrollSelect";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { getWarehouseName } from "@/lib/warehouse-utils";
import type { Product } from "@/types/models";
import {
  getAllTaggedExpressItems,
  tagExpressItem,
  untagExpressItem,
  batchTagExpressItems,
  batchUntagExpressItems,
  updateExpressItemStatus,
  batchUpdateExpressItemStatus,
  clearImportedExpressItems,
  type TaggedExpressItem,
  type ExpressSyncStatus,
} from "@/lib/express-tag-utils";

interface ApprovalDoc {
  document_id: string;
  document_no: string;
  warehouse_id: string;
  target_sheet: string;
  document_date: string;
  created_by: string;
  created_at?: string;
  status: string;
  express_status?: string;
  express_status_text?: string;
  rows: Array<[string, string, string, string, number, string, string, string]>;
}

type TagFilterType = "ALL" | "TAGGED_ONLY" | "PENDING" | "IMPORTED" | "UNTAGGED";

export default function ExpressReceivePage() {
  const router = useRouter();
  const { user, status } = useTabAuth();

  useEffect(() => {
    if (status !== "loading" && user && user.role !== "ADMIN") {
      router.replace("/dashboard");
    }
  }, [status, user, router]);

  const [apiItems, setApiItems] = useState<any[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string>("ALL");
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDay, setSelectedDay] = useState<string>("ALL");
  const [selectedMonth, setSelectedMonth] = useState<string>("ALL");
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState<TagFilterType>("ALL");
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [copiedItemSku, setCopiedItemSku] = useState<string | null>(null);

  // Tagging State
  const [taggedItemsMap, setTaggedItemsMap] = useState<Map<string, TaggedExpressItem>>(new Map());
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [customTagInput, setCustomTagInput] = useState<string>("นำเข้าสินค้าเข้าExpress");
  const [showTagModal, setShowTagModal] = useState<boolean>(false);

  // Sync tagged items from localStorage
  const refreshTaggedMap = useCallback(() => {
    const tagged = getAllTaggedExpressItems("RECEIVE");
    const map = new Map<string, TaggedExpressItem>();
    tagged.forEach((t) => map.set(t.id, t));
    setTaggedItemsMap(map);
  }, []);

  useEffect(() => {
    refreshTaggedMap();
    window.addEventListener("stockify-express-tags-updated", refreshTaggedMap);
    window.addEventListener("storage", refreshTaggedMap);
    return () => {
      window.removeEventListener("stockify-express-tags-updated", refreshTaggedMap);
      window.removeEventListener("storage", refreshTaggedMap);
    };
  }, [refreshTaggedMap]);

  // Extract 2-digit Express warehouse code (e.g. "01", "02", "03")
  const toExpressWhCode = (targetSheet: string): string => {
    if (!targetSheet) return "01";
    const match = targetSheet.match(/\d+/);
    if (match) return match[0].padStart(2, "0");
    return "01";
  };

  // Helper to get user-friendly Thai warehouse name
  const getWarehouseDisplayName = (raw: string | undefined | null): string => {
    if (!raw) return "-";
    if (raw.includes("โกดัง") || raw.includes("สำนักงานใหญ่")) return raw;
    return getWarehouseName(raw);
  };

  const fetchDocs = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const ts = Date.now();
      const [recRes, prodRes, statusRes] = await Promise.all([
        fetch(`/api/express-import/receive?_t=${ts}`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/products?limit=5000&_t=${ts}`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/express-import/status?type=RECEIVE&_t=${ts}`, { cache: "no-store" }).catch(() => null),
      ]);

      const recJson = recRes ? await recRes.json().catch(() => null) : null;
      const prodJson = prodRes ? await prodRes.json().catch(() => null) : null;
      const statusJson = statusRes ? await statusRes.json().catch(() => null) : null;

      if (recJson?.success && Array.isArray(recJson.data)) {
        const incoming: any[] = recJson.data.filter((item: any) => {
          const docNo = String(item.document_no || "").trim();
          const sku = String(item.sku || "").trim();
          const date = String(item.created_at || "").trim();
          const name = String(item.product_name || "").trim();
          return !(
            docNo === "เลขที่เอกสาร" ||
            date === "วันที่เอกสาร" ||
            sku.startsWith("คอลัมน์") ||
            sku === "รหัสสินค้า" ||
            name === "ชื่อแท็ก"
          );
        });
        setApiItems((prev) => {
          if (
            prev.length === incoming.length &&
            prev[0]?.id === incoming[0]?.id &&
            prev[prev.length - 1]?.id === incoming[incoming.length - 1]?.id
          ) {
            return prev;
          }
          return incoming;
        });
      }

      const products: Product[] = Array.isArray(prodJson?.data)
        ? prodJson.data
        : Array.isArray(prodJson?.data?.data)
        ? prodJson.data.data
        : [];
      setCatalogProducts(products);

      // If server returned express statuses, synchronize into tagged map in a SINGLE batch
      if (statusJson?.success && statusJson?.data && recJson?.success && Array.isArray(recJson.data)) {
        const serverStatusMap: Record<string, { status: ExpressSyncStatus; type: string }> = statusJson.data;
        const currentTagged = getAllTaggedExpressItems("RECEIVE");
        const localMap = new Map<string, TaggedExpressItem>(currentTagged.map((i) => [i.id, i]));
        const toUpdate: Array<Omit<TaggedExpressItem, "tagged_at" | "status"> & { status?: ExpressSyncStatus }> = [];

        recJson.data.forEach((item: any) => {
          const docKey = (item.document_no || "").trim().toLowerCase();
          const docIdKey = (item.document_id || "").trim().toLowerCase();
          const srv = (docKey ? serverStatusMap[docKey] : undefined) || (docIdKey ? serverStatusMap[docIdKey] : undefined);
          const docExpressStatus = srv?.status || (item.status as ExpressSyncStatus);

          if (docExpressStatus) {
            const uniqueId = item.id;
            const existing = localMap.get(uniqueId);
            if (!existing || existing.status !== docExpressStatus) {
              toUpdate.push({
                id: uniqueId,
                type: "RECEIVE",
                tag: existing?.tag || "นำเข้าสินค้าเข้าExpress",
                sku: item.sku,
                barcode: item.barcode,
                product_name: item.product_name,
                warehouse: item.warehouse_name || "โกดัง1",
                warehouse_code: toExpressWhCode(item.warehouse_name || "โกดัง1"),
                quantity: item.quantity || 1,
                document_no: item.document_no,
                document_date: item.created_at || "-",
                location: item.location || "-",
                status: docExpressStatus,
              });
            }
          }
        });

        if (toUpdate.length > 0) {
          batchTagExpressItems(toUpdate);
        }
      }
    } catch (e) {
      console.error("Failed to fetch documents for Express receive:", e);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [refreshTaggedMap]);

  useEffect(() => {
    fetchDocs();
    const interval = setInterval(() => {
      fetchDocs(true);
    }, 6000);
    return () => clearInterval(interval);
  }, [fetchDocs]);

  // Product catalog indexing
  const catalogProductsMap = useMemo(() => {
    const bySku = new Map<string, Product>();
    const byBarcode = new Map<string, Product>();
    const byName = new Map<string, Product>();

    catalogProducts.forEach((p) => {
      if (!p) return;
      const sku = (p.sku || "").trim().toLowerCase();
      const barcode = (p.barcode || "").trim().toLowerCase();
      const name = (p.product_name || "").replace(/[\s\-_#]/g, "").toLowerCase();

      if (sku) bySku.set(sku, p);
      if (barcode && barcode !== "-") byBarcode.set(barcode, p);
      if (name) byName.set(name, p);
    });

    return { bySku, byBarcode, byName };
  }, [catalogProducts]);

  // Flatten items with metadata & unique ID
  const allItems = useMemo(() => {
    const list: Array<{
      id: string;
      document_id: string;
      document_no: string;
      target_sheet: string;
      document_date: string;
      created_by: string;
      sku: string;
      product_name: string;
      category: string;
      unit: string;
      quantity: number;
      location: string;
      supplier: string;
      barcode: string;
      status: string;
      express_status?: ExpressSyncStatus;
    }> = [];

    const seenIds = new Set<string>();

    // 1. Ingest items from /api/express-import/receive (from Google Sheets tab & DB)
    apiItems.forEach((item) => {
      const docNo = String(item.document_no || "").trim();
      const sku = String(item.sku || "").trim();
      const date = String(item.created_at || "").trim();
      const name = String(item.product_name || "").trim();
      if (
        docNo === "เลขที่เอกสาร" ||
        date === "วันที่เอกสาร" ||
        sku.startsWith("คอลัมน์") ||
        sku === "รหัสสินค้า" ||
        name === "ชื่อแท็ก"
      ) {
        return;
      }

      if (selectedDocId !== "ALL" && item.document_no !== selectedDocId && item.document_id !== selectedDocId) return;
      if (selectedWarehouse !== "ALL" && item.warehouse_name !== selectedWarehouse && item.warehouse_id !== selectedWarehouse) return;

      const uid = item.id || `api_${item.document_no}_${item.sku}`;
      seenIds.add(uid);
      seenIds.add(`${(item.document_no || "").toLowerCase()}_${(item.sku || "").toLowerCase()}`);

      list.push({
        id: uid,
        document_id: item.document_id || item.document_no || "-",
        document_no: item.document_no || "-",
        target_sheet: item.warehouse_name || "โกดัง1",
        document_date: item.created_at || "-",
        created_by: item.created_by_name || "-",
        sku: item.sku,
        product_name: item.product_name,
        category: "ทั่วไป",
        unit: "ชิ้น",
        quantity: item.quantity,
        location: item.location || "-",
        supplier: "-",
        barcode: item.barcode || item.sku,
        status: item.status,
        express_status: (item.status as ExpressSyncStatus) || "PENDING",
      });
    });

    return list;
  }, [apiItems, selectedDocId, selectedWarehouse]);

  const availableWarehouses = useMemo(() => {
    const set = new Set<string>();
    apiItems.forEach((i) => {
      if (i.warehouse_name) set.add(i.warehouse_name);
    });
    return Array.from(set);
  }, [apiItems]);

  // Helper to parse date into { year, month, day }
  const parseDateParts = (raw: string | undefined | null) => {
    if (!raw || raw === "-") return null;
    const clean = (raw.includes("T") ? raw.split("T")[0] : raw.split(" ")[0]).trim();
    if (clean.includes("-")) {
      const parts = clean.split("-");
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          return {
            year: parts[0],
            month: parts[1].padStart(2, "0"),
            day: parts[2].padStart(2, "0"),
          };
        } else if (parts[2].length === 4) {
          return {
            year: parts[2],
            month: parts[1].padStart(2, "0"),
            day: parts[0].padStart(2, "0"),
          };
        }
      }
    } else if (clean.includes("/")) {
      const parts = clean.split("/");
      if (parts.length === 3) {
        if (parts[2].length === 4) {
          return {
            year: parts[2],
            month: parts[1].padStart(2, "0"),
            day: parts[0].padStart(2, "0"),
          };
        } else if (parts[0].length === 4) {
          return {
            year: parts[0],
            month: parts[1].padStart(2, "0"),
            day: parts[2].padStart(2, "0"),
          };
        }
      }
    }
    return null;
  };

  const availableYears = useMemo(() => {
    const set = new Set<string>();
    const currentYear = String(new Date().getFullYear());
    set.add(currentYear);
    set.add(String(new Date().getFullYear() - 1));
    allItems.forEach((item) => {
      const parts = parseDateParts(item.document_date);
      if (parts && /^\d{4}$/.test(parts.year)) {
        set.add(parts.year);
      }
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allItems]);

  const warehouseOptions = useMemo(() => [
    { value: "ALL", label: `ทุกคลังสินค้า (${availableWarehouses.length})` },
    ...availableWarehouses.map((wh) => ({
      value: wh,
      label: `โกดัง: ${getWarehouseDisplayName(wh)}`,
    })),
  ], [availableWarehouses]);

  const dayOptions = useMemo(() => [
    { value: "ALL", label: "ทุกวัน" },
    ...Array.from({ length: 31 }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      return { value: d, label: `วันที่ ${parseInt(d, 10)}` };
    }),
  ], []);

  const monthOptions = useMemo(() => [
    { value: "ALL", label: "ทุกเดือน" },
    { value: "01", label: "ม.ค. (01)" },
    { value: "02", label: "ก.พ. (02)" },
    { value: "03", label: "มี.ค. (03)" },
    { value: "04", label: "เม.ย. (04)" },
    { value: "05", label: "พ.ค. (05)" },
    { value: "06", label: "มิ.ย. (06)" },
    { value: "07", label: "ก.ค. (07)" },
    { value: "08", label: "ส.ค. (08)" },
    { value: "09", label: "ก.ย. (09)" },
    { value: "10", label: "ต.ค. (10)" },
    { value: "11", label: "พ.ย. (11)" },
    { value: "12", label: "ธ.ค. (12)" },
  ], []);

  const yearOptions = useMemo(() => [
    { value: "ALL", label: "ทุกปี" },
    ...availableYears.map((yr) => ({ value: yr, label: `ปี ${yr}` })),
  ], [availableYears]);

  const resetDateFilter = () => {
    setSelectedYear("ALL");
    setSelectedMonth("ALL");
    setSelectedDay("ALL");
  };

  // Filter items by search query, Tag filter, & Day/Month/Year date filter
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      // Tag filter check
      const tagged = taggedItemsMap.get(item.id);
      const effectiveStatus: ExpressSyncStatus = tagged?.status || item.express_status || "PENDING";
      const isTagged = !!tagged || !!item.express_status;

      if (tagFilter === "TAGGED_ONLY" && !isTagged) return false;
      if (tagFilter === "PENDING" && effectiveStatus !== "PENDING") return false;
      if (tagFilter === "IMPORTED" && effectiveStatus !== "IMPORTED") return false;
      if (tagFilter === "UNTAGGED" && isTagged) return false;

      // Day / Month / Year date filter check
      if (selectedYear !== "ALL" || selectedMonth !== "ALL" || selectedDay !== "ALL") {
        const parts = parseDateParts(item.document_date);
        if (parts) {
          if (selectedYear !== "ALL" && parts.year !== selectedYear) return false;
          if (selectedMonth !== "ALL" && parts.month !== selectedMonth) return false;
          if (selectedDay !== "ALL" && parts.day !== selectedDay) return false;
        } else {
          return false;
        }
      }

      // Search query check
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        item.sku.toLowerCase().includes(q) ||
        item.product_name.toLowerCase().includes(q) ||
        item.barcode.toLowerCase().includes(q) ||
        item.document_no.toLowerCase().includes(q) ||
        item.target_sheet.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q) ||
        (tagged && tagged.tag.toLowerCase().includes(q))
      );
    });
  }, [allItems, searchQuery, tagFilter, taggedItemsMap, selectedDay, selectedMonth, selectedYear]);

  // Tagging Stats
  const tagStats = useMemo(() => {
    let taggedCount = 0;
    let pendingCount = 0;
    let importedCount = 0;

    const baseItems = allItems.filter((item) => {
      if (selectedYear !== "ALL" || selectedMonth !== "ALL" || selectedDay !== "ALL") {
        const parts = parseDateParts(item.document_date);
        if (parts) {
          if (selectedYear !== "ALL" && parts.year !== selectedYear) return false;
          if (selectedMonth !== "ALL" && parts.month !== selectedMonth) return false;
          if (selectedDay !== "ALL" && parts.day !== selectedDay) return false;
        } else {
          return false;
        }
      }
      return true;
    });

    baseItems.forEach((item) => {
      const t = taggedItemsMap.get(item.id);
      const effectiveStatus: ExpressSyncStatus = t?.status || item.express_status || "PENDING";
      const isTagged = !!t || !!item.express_status;
      if (isTagged) taggedCount++;
      if (effectiveStatus === "PENDING") pendingCount++;
      if (effectiveStatus === "IMPORTED") importedCount++;
    });

    return {
      total: baseItems.length,
      taggedCount,
      pendingCount,
      importedCount,
      untaggedCount: baseItems.length - taggedCount,
    };
  }, [allItems, taggedItemsMap, selectedDay, selectedMonth, selectedYear]);

  // Handle single tag toggle
  const handleToggleTag = (item: (typeof allItems)[0]) => {
    const existing = taggedItemsMap.get(item.id);
    if (existing) {
      untagExpressItem(item.id);
    } else {
      tagExpressItem({
        id: item.id,
        type: "RECEIVE",
        tag: customTagInput.trim() || "นำเข้าสินค้าเข้าExpress",
        sku: item.sku,
        barcode: item.barcode,
        product_name: item.product_name,
        warehouse: item.target_sheet,
        warehouse_code: toExpressWhCode(item.target_sheet),
        quantity: item.quantity,
        document_no: item.document_no,
        document_date: item.document_date,
        location: item.location,
        status: "PENDING",
      });
    }
    refreshTaggedMap();
  };

  // Helper to sync status to Google Sheets and DB in background
  const syncStatusToSheet = async (items: Array<{ document_no: string; sku?: string; status: ExpressSyncStatus; type: "RECEIVE" }>) => {
    try {
      await fetch("/api/express-import/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
    } catch (e) {
      console.warn("[ExpressReceivePage] Background status sync to sheet failed:", e);
    }
  };

  // Handle single item status update
  const handleSetStatus = (item: (typeof allItems)[0], status: ExpressSyncStatus) => {
    const existing = taggedItemsMap.get(item.id);
    if (!existing) {
      tagExpressItem({
        id: item.id,
        type: "RECEIVE",
        tag: customTagInput.trim() || "นำเข้าสินค้าเข้าExpress",
        sku: item.sku,
        barcode: item.barcode,
        product_name: item.product_name,
        warehouse: item.target_sheet,
        warehouse_code: toExpressWhCode(item.target_sheet),
        quantity: item.quantity,
        document_no: item.document_no,
        document_date: item.document_date,
        location: item.location,
        status: status,
      });
    } else {
      updateExpressItemStatus(item.id, status);
    }
    refreshTaggedMap();
    syncStatusToSheet([{ document_no: item.document_no, sku: item.sku, status, type: "RECEIVE" }]);
  };

  // Handle batch tagging
  const handleBatchTag = (tagText: string) => {
    const itemsToTag = allItems.filter((i) => selectedItemIds.has(i.id));
    const dtos = itemsToTag.map((i) => ({
      id: i.id,
      type: "RECEIVE" as const,
      tag: tagText.trim() || "นำเข้าสินค้าเข้าExpress",
      sku: i.sku,
      barcode: i.barcode,
      product_name: i.product_name,
      warehouse: i.target_sheet,
      warehouse_code: toExpressWhCode(i.target_sheet),
      quantity: i.quantity,
      document_no: i.document_no,
      document_date: i.document_date,
      location: i.location,
      status: "PENDING" as const,
    }));
    batchTagExpressItems(dtos);
    refreshTaggedMap();
    setSelectedItemIds(new Set());
    setShowTagModal(false);
  };

  // Handle batch mark status
  const handleBatchMarkStatus = (status: ExpressSyncStatus) => {
    const ids = Array.from(selectedItemIds);
    batchUpdateExpressItemStatus(ids, status);
    refreshTaggedMap();
    const itemsToSync = allItems
      .filter((i) => selectedItemIds.has(i.id))
      .map((i) => ({ document_no: i.document_no, sku: i.sku, status, type: "RECEIVE" as const }));
    syncStatusToSheet(itemsToSync);
    setSelectedItemIds(new Set());
  };

  // Handle batch untag
  const handleBatchUntag = () => {
    const ids = Array.from(selectedItemIds);
    batchUntagExpressItems(ids);
    refreshTaggedMap();
    setSelectedItemIds(new Set());
  };

  // Select all / Deselect all
  const handleSelectAll = () => {
    if (selectedItemIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(filteredItems.map((i) => i.id)));
    }
  };

  const handleSelectItem = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Express Tab Format: [Barcode] \t [Product Name] \t [Warehouse Code] \t [Quantity]
  const getItemExpressRowString = useCallback(
    (item: (typeof allItems)[0]) => {
      const expressBarcode = item.barcode || item.sku;
      const whCode = toExpressWhCode(item.target_sheet);
      const cleanName = item.product_name.replace(/\t/g, " ");
      return `${expressBarcode}\t${cleanName}\t${whCode}\t${item.quantity}`;
    },
    []
  );

  // Copy single row with TAB separators
  const handleCopyRow = (item: (typeof allItems)[0]) => {
    const tabString = getItemExpressRowString(item);
    navigator.clipboard.writeText(tabString);

    setCopiedItemId(item.id);
    setTimeout(() => setCopiedItemId(null), 2000);
  };

  // Copy single barcode value
  const handleCopySingleBarcode = (barcode: string) => {
    navigator.clipboard.writeText(barcode);
    setCopiedItemSku(barcode);
    setTimeout(() => setCopiedItemSku(null), 2000);
  };

  // Copy all selected rows as batch TSV
  const handleCopySelectedRows = () => {
    const selectedItems = filteredItems.filter((i) => selectedItemIds.has(i.id));
    if (selectedItems.length === 0) return;

    const tsvData = selectedItems.map((item) => getItemExpressRowString(item)).join("\n");
    navigator.clipboard.writeText(tsvData);
    setCopySuccess(`คัดลอกเฉพาะ ${selectedItems.length} รายการที่เลือกเรียบร้อยแล้ว!`);
    setTimeout(() => setCopySuccess(null), 3000);
  };

  // Copy entire filtered list
  const handleCopyAllExpressData = () => {
    if (filteredItems.length === 0) return;

    const tsvData = filteredItems.map((item) => getItemExpressRowString(item)).join("\n");
    navigator.clipboard.writeText(tsvData);
    setCopySuccess(`คัดลอกทั้งหมด ${filteredItems.length} รายการแล้ว! นำไปกด Ctrl+V ใน Express ได้เลย`);
    setTimeout(() => setCopySuccess(null), 3000);
  };

  const handleDownloadExpressTxt = () => {
    if (filteredItems.length === 0) return;
    const headerLine = "บาร์โค้ด\tชื่อสินค้า\tโกดัง\tจำนวน\n";
    const body = filteredItems.map((item) => getItemExpressRowString(item)).join("\n");

    const blob = new Blob([headerLine + body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `express-receive-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrintBarcodes = () => {
    window.print();
  };

  return (
    <div className="w-full max-w-full space-y-5 pb-12 print:p-0 print:m-0 print:max-w-none text-slate-800">
      {/* Header Banner (Clean Light Theme) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 bg-white border border-slate-200 rounded-2xl shadow-xs print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-2xs">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-slate-900">
              นำเข้า Express — รับสินค้า
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyAllExpressData}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            <span>{copySuccess || "คัดลอกข้อมูลทั้งหมด"}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadExpressTxt}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            title="ดาวน์โหลดไฟล์ .txt สำหรับ Express"
          >
            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>ดาวน์โหลด .txt</span>
          </button>

          <button
            type="button"
            onClick={handlePrintBarcodes}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            <span>พิมพ์ใบสแกน</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
              } else {
                document.exitFullscreen().catch(() => {});
              }
            }}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            title="ขยายเต็มหน้าจอ (Fullscreen)"
          >
            <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
            <span>เต็มจอ</span>
          </button>
        </div>
      </div>

      {/* Express Tagging & Batch Stats Bar (Clean Light Theme Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:hidden">
        {/* All Items Card */}
        <div
          onClick={() => setTagFilter("ALL")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            tagFilter === "ALL"
              ? "bg-slate-100 border-slate-400 shadow-sm"
              : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70 shadow-2xs"
          }`}
        >
          <div className="text-xs font-bold text-slate-600">รายการรับทั้งหมด</div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono">{tagStats.total}</div>
        </div>

        {/* Pending Card */}
        <div
          onClick={() => setTagFilter("PENDING")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            tagFilter === "PENDING"
              ? "bg-amber-100/70 border-amber-500 shadow-sm"
              : "bg-white border-slate-200 hover:border-amber-300 hover:bg-amber-50/40 shadow-2xs"
          }`}
        >
          <div className="text-xs font-bold text-amber-800">⏳ รอนำเข้า Express</div>
          <div className="text-2xl font-black text-amber-900 mt-1 font-mono">{tagStats.pendingCount}</div>
        </div>

        {/* Imported Card */}
        <div
          onClick={() => setTagFilter("IMPORTED")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            tagFilter === "IMPORTED"
              ? "bg-emerald-100/70 border-emerald-500 shadow-sm"
              : "bg-white border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40 shadow-2xs"
          }`}
        >
          <div className="text-xs font-bold text-emerald-800">✅ นำเข้าแล้ว</div>
          <div className="text-2xl font-black text-emerald-900 mt-1 font-mono">{tagStats.importedCount}</div>
        </div>
      </div>

      {/* Filter Controls & Search (Clean Light Box) */}
      <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3.5 shadow-2xs print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Search Box */}
          <div className="sm:col-span-5 relative">
            <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาบาร์โค้ด, SKU, ชื่อสินค้า, แท็ก, โกดัง, เลขเอกสาร..."
              className="w-full pl-10 pr-8 py-2.5 min-h-[42px] bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white transition-all font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-800"
              >
                ✕
              </button>
            )}
          </div>

          {/* Warehouse Selector */}
          <div className="sm:col-span-3">
            <ScrollSelect
              value={selectedWarehouse}
              onChange={setSelectedWarehouse}
              options={warehouseOptions}
              maxVisibleItems={4}
              title="เลือกคลังสินค้า"
            />
          </div>

          {/* Day / Month / Year Dropdowns */}
          <div className="sm:col-span-4 flex items-center gap-1.5">
            {/* วัน (Day) */}
            <ScrollSelect
              value={selectedDay}
              onChange={setSelectedDay}
              options={dayOptions}
              maxVisibleItems={4}
              title="เลือกวัน"
            />

            {/* เดือน (Month) */}
            <ScrollSelect
              value={selectedMonth}
              onChange={setSelectedMonth}
              options={monthOptions}
              maxVisibleItems={4}
              title="เลือกเดือน"
            />

            {/* ปี (Year) */}
            <ScrollSelect
              value={selectedYear}
              onChange={setSelectedYear}
              options={yearOptions}
              maxVisibleItems={4}
              title="เลือกปี"
            />

            {(selectedDay !== "ALL" || selectedMonth !== "ALL" || selectedYear !== "ALL") && (
              <button
                type="button"
                onClick={resetDateFilter}
                className="px-2.5 py-2 min-h-[42px] text-sm text-rose-600 hover:bg-rose-50 rounded-xl font-bold cursor-pointer flex-shrink-0 border border-rose-200"
                title="ล้างตัวกรองวันที่"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Items Content (Clean Light Table Design) */}
      <div className="space-y-4">
        {/* Printable Header */}
        <div className="hidden print:block text-center mb-6 pb-3 border-b-2 border-black">
          <h1 className="text-xl font-bold text-black">ใบสแกนบาร์โค้ดรับสินค้า — Express ERP</h1>
          <p className="text-xs text-gray-600 mt-1">
            วันที่พิมพ์: {new Date().toLocaleDateString("th-TH")} | รวม {filteredItems.length} รายการ
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl p-16 text-center border border-slate-200 bg-white shadow-sm">
            <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-600 text-sm font-medium">กำลังโหลดข้อมูลรายการรับสินค้า...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl p-12 sm:p-16 text-center border border-slate-200 bg-white shadow-sm">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-slate-800 mb-1">
              {allItems.length === 0
                ? "ยังไม่มีรายการรับสินค้าเข้า Express ในระบบ"
                : "ไม่พบรายการที่ตรงกับเงื่อนไขตัวกรองหรือการค้นหา"}
            </h3>
            <p className="text-slate-500 text-xs sm:text-sm max-w-md mx-auto">
              {allItems.length === 0
                ? "รายการจะปรากฏเมื่อมีการบันทึกลงในแท็บชีต นำเข้าสินค้าเข้าExpress หรืออนุมัติเอกสารรับสินค้าเข้า Express ในระบบ"
                : "ลองเปลี่ยนตัวกรองสถานะ Express หรือล้างตัวกรองวันที่/คำค้นหาเพื่อดูรายการอื่น"}
            </p>
            {allItems.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                {tagFilter !== "ALL" && (
                  <button
                    type="button"
                    onClick={() => setTagFilter("ALL")}
                    className="px-3.5 py-2 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-xs cursor-pointer transition-colors"
                  >
                    สลับดูรายการทั้งหมด
                  </button>
                )}
                {searchQuery.trim() && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-xs cursor-pointer transition-colors"
                  >
                    ล้างคำค้นหา
                  </button>
                )}
                {(selectedDay !== "ALL" || selectedMonth !== "ALL" || selectedYear !== "ALL") && (
                  <button
                    type="button"
                    onClick={resetDateFilter}
                    className="px-3.5 py-2 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold text-xs cursor-pointer transition-colors"
                  >
                    ล้างตัวกรองวันที่
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Table View */
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden print:border-black">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/95 border-b border-slate-200 text-slate-700 text-sm font-bold tracking-normal print:bg-white">
                    <th className="py-3.5 px-3 text-center w-10 print:hidden">
                      <input
                        type="checkbox"
                        checked={filteredItems.length > 0 && selectedItemIds.size === filteredItems.length}
                        onChange={handleSelectAll}
                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
                        title="เลือกทั้งหมด"
                      />
                    </th>
                    <th className="py-3.5 px-3 text-center w-14 text-sm font-bold text-slate-700">ลำดับ</th>
                    <th className="py-3.5 px-3 whitespace-nowrap text-sm font-bold text-slate-700">เลขที่เอกสาร</th>
                    <th className="py-3.5 px-3 text-center whitespace-nowrap text-sm font-bold text-slate-700">บาร์โค้ด</th>
                    <th className="py-3.5 px-3 whitespace-nowrap text-sm font-bold text-slate-700">รหัสสินค้า</th>
                    <th className="py-3.5 px-3 min-w-[220px] text-sm font-bold text-slate-700">ชื่อสินค้า</th>
                    <th className="py-3.5 px-3 whitespace-nowrap text-center text-sm font-bold text-slate-700">คลังสินค้า</th>
                    <th className="py-3.5 px-3 whitespace-nowrap text-center text-sm font-bold text-slate-700">ตำแหน่ง</th>
                    <th className="py-3.5 px-3 text-right whitespace-nowrap text-sm font-bold text-slate-700">จำนวน</th>
                    <th className="py-3.5 px-3 text-center whitespace-nowrap text-sm font-bold text-slate-700">สถานะ Express</th>
                    <th className="py-3.5 px-3 text-center whitespace-nowrap print:hidden text-sm font-bold text-slate-700">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredItems.map((item, idx) => {
                    const barcodeValue = item.barcode || item.sku;
                    const isRowCopied = copiedItemId === item.id;
                    const isBarcodeCopied = copiedItemSku === barcodeValue;
                    const isSelected = selectedItemIds.has(item.id);
                    const tagged = taggedItemsMap.get(item.id);
                    const effectiveStatus: ExpressSyncStatus = tagged?.status || item.express_status || "PENDING";
                    const isImported = effectiveStatus === "IMPORTED";

                    return (
                      <tr
                        key={`${item.id}-${idx}`}
                        className={`transition-colors duration-150 ${
                          isSelected
                            ? "bg-emerald-50/80"
                            : isImported
                            ? "!bg-emerald-100 hover:!bg-emerald-200/80"
                            : idx % 2 === 0
                            ? "bg-white hover:bg-slate-50/80"
                            : "bg-slate-50/40 hover:bg-slate-50/80"
                        }`}
                      >
                        {/* 0. Checkbox */}
                        <td className={`py-3 px-3 text-center print:hidden ${isImported ? "!bg-emerald-100" : ""}`}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectItem(item.id)}
                            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
                          />
                        </td>

                        {/* 1. ลำดับ */}
                        <td className={`py-3 px-3 text-center font-bold font-mono text-sm text-slate-500 ${isImported ? "!bg-emerald-100" : ""}`}>
                          {idx + 1}
                        </td>

                        {/* 2. เลขที่เอกสาร */}
                        <td className={`py-3 px-3 whitespace-nowrap ${isImported ? "!bg-emerald-100" : ""}`}>
                          <div className="font-mono font-bold text-slate-900 text-sm">
                            {item.document_no}
                          </div>
                          {item.document_date && (
                            <div className="text-xs text-slate-400 font-mono mt-0.5">
                              {item.document_date}
                            </div>
                          )}
                        </td>

                        {/* 3. บาร์โค้ด (รูปบาร์โค้ด) */}
                        <td className={`py-2.5 px-3 whitespace-nowrap text-center ${isImported ? "!bg-emerald-100" : ""}`}>
                          <div className="flex flex-col items-center justify-center gap-1">
                            <BarcodeSvg
                              value={barcodeValue}
                              height={40}
                              width={1.4}
                              fontSize={12}
                              showText={true}
                            />
                            <button
                              type="button"
                              onClick={() => handleCopySingleBarcode(barcodeValue)}
                              className="text-xs font-mono text-slate-500 hover:text-emerald-600 px-2 py-0.5 rounded hover:bg-slate-100 transition-colors cursor-pointer inline-flex items-center gap-1 print:hidden"
                              title="คัดลอกเฉพาะเลขบาร์โค้ด"
                            >
                              {isBarcodeCopied ? (
                                <span className="text-emerald-600 font-bold">✓ คัดลอกแล้ว</span>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                  <span>คัดลอกเลข</span>
                                </>
                              )}
                            </button>
                          </div>
                        </td>

                        {/* 4. รหัสสินค้า SKU */}
                        <td className={`py-3 px-3 whitespace-nowrap font-mono text-xs font-bold text-slate-900 text-sm ${isImported ? "!bg-emerald-100" : ""}`}>
                          {item.sku || "-"}
                        </td>

                        {/* 5. ชื่อสินค้า */}
                        <td className={`py-3 px-3 min-w-[220px] ${isImported ? "!bg-emerald-100" : ""}`}>
                          <div className="text-slate-900 font-semibold text-sm leading-snug" title={item.product_name}>
                            {item.product_name}
                          </div>
                        </td>

                        {/* 6. คลังสินค้า */}
                        <td className={`py-3 px-3 whitespace-nowrap text-center text-sm ${isImported ? "!bg-emerald-100" : ""}`}>
                          <span className="text-slate-800 font-semibold">
                            {getWarehouseDisplayName(item.target_sheet)}
                          </span>
                        </td>

                        {/* 7. ตำแหน่ง */}
                        <td className={`py-3 px-3 whitespace-nowrap text-center text-sm ${isImported ? "!bg-emerald-100" : ""}`}>
                          <span className="font-mono font-bold text-slate-800 text-sm">
                            {item.location && item.location !== "-" ? item.location : "-"}
                          </span>
                        </td>

                        {/* 8. จำนวน */}
                        <td className={`py-3 px-3 text-right whitespace-nowrap ${isImported ? "!bg-emerald-100" : ""}`}>
                          <span className="font-mono font-bold text-slate-900 text-base">
                            {item.quantity.toLocaleString()} <span className="font-normal text-slate-500 text-xs">ชิ้น</span>
                          </span>
                        </td>

                        {/* 9. สถานะ Express Tag */}
                        <td className={`py-2.5 px-3 text-center whitespace-nowrap ${isImported ? "!bg-emerald-100" : ""}`}>
                          <select
                            value={effectiveStatus}
                            onChange={(e) => handleSetStatus(item, e.target.value as ExpressSyncStatus)}
                            className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold border transition-all cursor-pointer outline-none ${
                              isImported
                                ? "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                                : "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                            }`}
                          >
                            <option value="PENDING">⏳ รอนำเข้า</option>
                            <option value="IMPORTED">✅ นำเข้าแล้ว</option>
                          </select>
                        </td>

                        {/* 10. จัดการ (คัดลอกแถว) */}
                        <td className={`py-2.5 px-3 text-center whitespace-nowrap print:hidden ${isImported ? "!bg-emerald-100" : ""}`}>
                          <button
                            type="button"
                            onClick={() => handleCopyRow(item)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                              isRowCopied
                                ? "bg-emerald-600 text-white shadow-xs"
                                : "bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 border border-slate-200"
                            }`}
                            title="คัดลอกทั้งแถวสำหรับ Express"
                          >
                            {isRowCopied ? (
                              <>
                                <span>✓</span>
                                <span>คัดลอกแล้ว</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                </svg>
                                <span>คัดลอกแถว</span>
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Floating / Sticky Batch Action Bar */}
      {selectedItemIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl flex flex-wrap items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2 font-bold text-sm">
            <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-black">
              {selectedItemIds.size}
            </span>
            <span>รายการที่เลือก</span>
          </div>
          <div className="h-4 w-px bg-slate-700 hidden sm:block" />
          <button
            type="button"
            onClick={handleCopySelectedRows}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            <span>คัดลอกที่เลือก (TSV)</span>
          </button>
          <button
            type="button"
            onClick={() => handleBatchMarkStatus("IMPORTED")}
            className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
          >
            <span>✅ นำเข้าแล้ว</span>
          </button>
          <button
            type="button"
            onClick={() => handleBatchMarkStatus("PENDING")}
            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
          >
            <span>⏳ รอนำเข้า</span>
          </button>
          <button
            type="button"
            onClick={() => setShowTagModal(true)}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>🏷️ กำหนดแท็ก</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedItemIds(new Set())}
            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white font-bold text-xs cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* Batch Tag Input Modal (Clean Light Design) */}
      {showTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>🏷️ กำหนดชื่อแท็กสำหรับ Express</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">
                {selectedItemIds.size} รายการ
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              ระบุชื่อแท็กหรือกลุ่มข้อมูลสำหรับจัดเก็บรายการรับสินค้านี้ เช่น &quot;ล็อตนำเข้าเช้า&quot;, &quot;บิล 101&quot;
            </p>

            <input
              type="text"
              value={customTagInput}
              onChange={(e) => setCustomTagInput(e.target.value)}
              placeholder="ระบุชื่อแท็ก..."
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTagModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => handleBatchTag(customTagInput)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer shadow-xs"
              >
                บันทึกแท็ก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
