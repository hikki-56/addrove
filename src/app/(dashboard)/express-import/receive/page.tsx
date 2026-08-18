"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import { to8DigitBarcode } from "@/lib/barcode-utils";
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
  rows: Array<[string, string, string, string, number, string, string, string]>;
}

export interface DisplayFields {
  barcode: boolean;
  productName: boolean;
  warehouse: boolean;
  quantity: boolean;
  sku: boolean;
  location: boolean;
  docNo: boolean;
}

const DEFAULT_DISPLAY_FIELDS: DisplayFields = {
  barcode: true,
  productName: true,
  warehouse: true,
  quantity: true,
  sku: false,
  location: false,
  docNo: false,
};

type TagFilterType = "ALL" | "TAGGED_ONLY" | "PENDING" | "IMPORTED" | "UNTAGGED";

export default function ExpressReceivePage() {
  const router = useRouter();
  const { user, status } = useTabAuth();

  useEffect(() => {
    if (status !== "loading" && user && user.role !== "ADMIN") {
      router.replace("/dashboard");
    }
  }, [status, user, router]);

  const [docs, setDocs] = useState<ApprovalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string>("ALL");
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<TagFilterType>("ALL");
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [copiedItemSku, setCopiedItemSku] = useState<string | null>(null);
  const [displayFields, setDisplayFields] = useState<DisplayFields>(DEFAULT_DISPLAY_FIELDS);

  // Tagging State
  const [taggedItemsMap, setTaggedItemsMap] = useState<Map<string, TaggedExpressItem>>(new Map());
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [customTagInput, setCustomTagInput] = useState<string>("รอนำเข้า Express");
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

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const ts = Date.now();
      const [postedRes, pendingRes] = await Promise.all([
        fetch(`/api/approvals?status=POSTED&_t=${ts}`, { cache: "no-store" }),
        fetch(`/api/approvals?status=PENDING&_t=${ts}`, { cache: "no-store" }),
      ]);

      const postedJson = await postedRes.json();
      const pendingJson = await pendingRes.json();

      const combined: ApprovalDoc[] = [];
      if (postedJson.success && Array.isArray(postedJson.data)) {
        combined.push(...postedJson.data);
      }
      if (pendingJson.success && Array.isArray(pendingJson.data)) {
        combined.push(...pendingJson.data);
      }

      // Deduplicate by document_id
      const map = new Map<string, ApprovalDoc>();
      combined.forEach((d) => {
        if (!map.has(d.document_id)) {
          map.set(d.document_id, d);
        }
      });
      setDocs(Array.from(map.values()));
    } catch (e) {
      console.error("Failed to fetch documents for Express receive:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, []);

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
    }> = [];

    docs.forEach((doc) => {
      if (selectedDocId !== "ALL" && doc.document_id !== selectedDocId) return;
      if (selectedWarehouse !== "ALL" && doc.target_sheet !== selectedWarehouse) return;

      doc.rows?.forEach((row, rowIdx) => {
        const sku = String(row[0] ?? "").trim();
        const location = String(row[1] ?? "-").trim() || "-";
        const rawBarcode = String(row[2] ?? "").trim();
        const productName = String(row[3] ?? "").trim() || sku;
        const qtyVal = parseFloat(String(row[4] ?? "1").replace(/,/g, "").trim());
        const quantity = !isNaN(qtyVal) && qtyVal > 0 ? qtyVal : 1;
        const targetWarehouse = String(row[5] ?? doc.target_sheet ?? "").trim() || doc.target_sheet;
        const supplier = String(row[6] ?? "-").trim() || "-";

        const barcode =
          rawBarcode && rawBarcode !== "-" && rawBarcode !== "null" && rawBarcode !== "undefined"
            ? rawBarcode
            : to8DigitBarcode(rawBarcode, sku) || sku;

        const uniqueId = `rec_${doc.document_id}_${sku}_${rowIdx}`;

        list.push({
          id: uniqueId,
          document_id: doc.document_id,
          document_no: doc.document_no,
          target_sheet: targetWarehouse,
          document_date: doc.document_date || doc.created_at?.slice(0, 10) || "-",
          created_by: doc.created_by || "-",
          sku,
          product_name: productName,
          category: "ทั่วไป",
          unit: "ชิ้น",
          quantity,
          location,
          supplier,
          barcode,
          status: doc.status,
        });
      });
    });

    return list;
  }, [docs, selectedDocId, selectedWarehouse]);

  // Filter items by search query & Tag filter
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      // Tag filter check
      const tagged = taggedItemsMap.get(item.id);
      if (tagFilter === "TAGGED_ONLY" && !tagged) return false;
      if (tagFilter === "PENDING" && (!tagged || tagged.status !== "PENDING")) return false;
      if (tagFilter === "IMPORTED" && (!tagged || tagged.status !== "IMPORTED")) return false;
      if (tagFilter === "UNTAGGED" && tagged) return false;

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
  }, [allItems, searchQuery, tagFilter, taggedItemsMap]);

  const availableWarehouses = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => {
      if (d.target_sheet) set.add(d.target_sheet);
    });
    return Array.from(set);
  }, [docs]);

  // Tagging Stats
  const tagStats = useMemo(() => {
    let taggedCount = 0;
    let pendingCount = 0;
    let importedCount = 0;

    allItems.forEach((item) => {
      const t = taggedItemsMap.get(item.id);
      if (t) {
        taggedCount++;
        if (t.status === "PENDING") pendingCount++;
        if (t.status === "IMPORTED") importedCount++;
      }
    });

    return { total: allItems.length, taggedCount, pendingCount, importedCount };
  }, [allItems, taggedItemsMap]);

  // Toggle Single Tag
  const handleToggleTag = (item: (typeof allItems)[0]) => {
    const existing = taggedItemsMap.get(item.id);
    if (existing) {
      untagExpressItem(item.id);
    } else {
      tagExpressItem({
        id: item.id,
        type: "RECEIVE",
        tag: customTagInput || "รอนำเข้า Express",
        sku: item.sku,
        barcode: item.barcode,
        product_name: item.product_name,
        quantity: item.quantity,
        location: item.location,
        warehouse: item.target_sheet,
        warehouse_code: toExpressWhCode(item.target_sheet),
        document_no: item.document_no,
        document_date: item.document_date,
        supplier: item.supplier,
      });
    }
  };

  // Update Status
  const handleToggleStatus = (id: string) => {
    const existing = taggedItemsMap.get(id);
    if (!existing) return;
    const nextStatus: ExpressSyncStatus = existing.status === "PENDING" ? "IMPORTED" : "PENDING";
    updateExpressItemStatus(id, nextStatus);
  };

  // Multi-Select
  const handleSelectAll = () => {
    if (selectedItemIds.size === filteredItems.length) {
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

  // Batch Actions
  const handleBatchTag = (tagLabel: string) => {
    const selectedItems = allItems.filter((i) => selectedItemIds.has(i.id));
    if (selectedItems.length === 0) return;

    batchTagExpressItems(
      selectedItems.map((item) => ({
        id: item.id,
        type: "RECEIVE",
        tag: tagLabel || "รอนำเข้า Express",
        sku: item.sku,
        barcode: item.barcode,
        product_name: item.product_name,
        quantity: item.quantity,
        location: item.location,
        warehouse: item.target_sheet,
        warehouse_code: toExpressWhCode(item.target_sheet),
        document_no: item.document_no,
        document_date: item.document_date,
        supplier: item.supplier,
      }))
    );
    setShowTagModal(false);
  };

  const handleBatchUntag = () => {
    if (selectedItemIds.size === 0) return;
    batchUntagExpressItems(Array.from(selectedItemIds));
    setSelectedItemIds(new Set());
  };

  const handleBatchMarkStatus = (status: ExpressSyncStatus) => {
    if (selectedItemIds.size === 0) return;
    batchUpdateExpressItemStatus(Array.from(selectedItemIds), status);
  };

  // Generate Tab-delimited row for an item
  const getItemExpressRowString = useCallback(
    (item: (typeof allItems)[0]) => {
      const parts: string[] = [];
      if (displayFields.barcode) parts.push(item.barcode);
      if (displayFields.productName) parts.push(item.product_name.replace(/\t/g, " "));
      if (displayFields.warehouse) parts.push(toExpressWhCode(item.target_sheet));
      if (displayFields.quantity) parts.push(String(item.quantity));
      if (displayFields.sku) parts.push(item.sku);
      if (displayFields.location) parts.push(item.location);
      if (displayFields.docNo) parts.push(item.document_no);

      if (parts.length === 0) {
        return `${item.barcode}\t${item.product_name.replace(/\t/g, " ")}\t${toExpressWhCode(item.target_sheet)}\t${item.quantity}`;
      }
      return parts.join("\t");
    },
    [displayFields]
  );

  // Copy Single Row with TAB separators
  const handleCopyRow = (item: (typeof allItems)[0]) => {
    const rowStr = getItemExpressRowString(item);
    navigator.clipboard.writeText(rowStr);
    setCopiedItemId(item.id);
    setTimeout(() => setCopiedItemId(null), 2000);
  };

  // Copy Single Barcode Only
  const handleCopySingleBarcode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedItemSku(code);
    setTimeout(() => setCopiedItemSku(null), 2000);
  };

  // Copy All Filtered Rows
  const handleCopyExpressData = () => {
    if (filteredItems.length === 0) return;
    const lines = filteredItems.map((item) => getItemExpressRowString(item));
    const content = lines.join("\n");
    navigator.clipboard.writeText(content);
    setCopySuccess("คัดลอกข้อมูลทั้งหมดเรียบร้อยแล้ว!");
    setTimeout(() => setCopySuccess(null), 3000);
  };

  // Copy Only Selected Rows
  const handleCopySelectedRows = () => {
    const selectedItems = filteredItems.filter((i) => selectedItemIds.has(i.id));
    if (selectedItems.length === 0) return;
    const lines = selectedItems.map((item) => getItemExpressRowString(item));
    const content = lines.join("\n");
    navigator.clipboard.writeText(content);
    setCopySuccess(`คัดลอกเฉพาะ ${selectedItems.length} รายการที่เลือกเรียบร้อยแล้ว!`);
    setTimeout(() => setCopySuccess(null), 3000);
  };

  const handleDownloadExpressTxt = () => {
    if (filteredItems.length === 0) return;
    const headers: string[] = [];
    if (displayFields.barcode) headers.push("บาร์โค้ด");
    if (displayFields.productName) headers.push("ชื่อสินค้า");
    if (displayFields.warehouse) headers.push("โกดัง");
    if (displayFields.quantity) headers.push("จำนวน");
    if (displayFields.sku) headers.push("รหัสสินค้า");
    if (displayFields.location) headers.push("ตำแหน่ง");
    if (displayFields.docNo) headers.push("เลขที่เอกสาร");

    const headerLine = (headers.length > 0 ? headers.join("\t") : "บาร์โค้ด\tชื่อสินค้า\tโกดัง\tจำนวน") + "\n";
    const body = filteredItems.map((item) => getItemExpressRowString(item)).join("\n");

    const blob = new Blob([headerLine + body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `express_receive_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrintBarcodes = () => {
    window.print();
  };

  const toggleField = (field: keyof DisplayFields) => {
    setDisplayFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <div className="w-full max-w-full space-y-5 pb-12">
      {/* Top Header Banner (Clean Light Style) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm print:hidden">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 font-bold flex-shrink-0">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2.5">
              <span>นำเข้า Express — รับสินค้า</span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {filteredItems.length} รายการ
              </span>
            </h1>
            <p className="text-slate-500 text-xs mt-0.5">
              กดปุ่ม <strong className="text-emerald-700">📋 คัดลอกทั้งแถว (Tab)</strong> เพื่อนำข้อมูลไปกด <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-slate-800 font-mono font-bold">Ctrl+V</kbd> วางลงในโปรแกรม Express ได้ทันที
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyExpressData}
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
        </div>
      </div>

      {/* Express Tagging & Batch Stats Bar (Clean Light Theme Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:hidden">
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

        {/* Tagged Card */}
        <div
          onClick={() => setTagFilter("TAGGED_ONLY")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            tagFilter === "TAGGED_ONLY"
              ? "bg-indigo-100/70 border-indigo-500 shadow-sm"
              : "bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 shadow-2xs"
          }`}
        >
          <div className="text-xs font-bold text-indigo-700 flex items-center justify-between">
            <span>🏷️ ติดแท็กไว้</span>
            <span className="text-[11px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-mono font-bold">
              {tagStats.taggedCount}
            </span>
          </div>
          <div className="text-2xl font-black text-indigo-900 mt-1 font-mono">{tagStats.taggedCount}</div>
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
          <div className="text-xs font-bold text-amber-800 flex items-center justify-between">
            <span>⏳ รอนำเข้า Express</span>
            <span className="text-[11px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full font-mono font-bold">
              {tagStats.pendingCount}
            </span>
          </div>
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
          <div className="text-xs font-bold text-emerald-800 flex items-center justify-between">
            <span>✅ นำเข้าแล้ว</span>
            <span className="text-[11px] bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-full font-mono font-bold">
              {tagStats.importedCount}
            </span>
          </div>
          <div className="text-2xl font-black text-emerald-900 mt-1 font-mono">{tagStats.importedCount}</div>
        </div>
      </div>

      {/* Filter Controls & Search (Clean Light Box) */}
      <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3.5 shadow-2xs print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Search Box */}
          <div className="sm:col-span-6 relative">
            <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 ค้นหาบาร์โค้ด, SKU, ชื่อสินค้า, แท็ก, โกดัง..."
              className="w-full pl-10 pr-8 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white transition-all font-medium"
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

          {/* Doc Selector */}
          <div className="sm:col-span-3">
            <select
              value={selectedDocId}
              onChange={(e) => setSelectedDocId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white cursor-pointer"
            >
              <option value="ALL">เอกสารทั้งหมด ({docs.length})</option>
              {docs.map((doc) => (
                <option key={doc.document_id} value={doc.document_id}>
                  {doc.document_no} ({doc.target_sheet})
                </option>
              ))}
            </select>
          </div>

          {/* Warehouse Selector */}
          <div className="sm:col-span-3">
            <select
              value={selectedWarehouse}
              onChange={(e) => setSelectedWarehouse(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white cursor-pointer"
            >
              <option value="ALL">ทุกคลังสินค้า ({availableWarehouses.length})</option>
              {availableWarehouses.map((wh) => (
                <option key={wh} value={wh}>
                  โกดัง: {wh}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tag Filters & Multi-Select Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-600 mr-1">ตัวกรองแท็ก:</span>
            <button
              onClick={() => setTagFilter("ALL")}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                tagFilter === "ALL"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              ทั้งหมด ({allItems.length})
            </button>
            <button
              onClick={() => setTagFilter("TAGGED_ONLY")}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                tagFilter === "TAGGED_ONLY"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
              }`}
            >
              🏷️ ติดแท็ก ({tagStats.taggedCount})
            </button>
            <button
              onClick={() => setTagFilter("PENDING")}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                tagFilter === "PENDING"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200"
              }`}
            >
              ⏳ รอนำเข้า ({tagStats.pendingCount})
            </button>
            <button
              onClick={() => setTagFilter("IMPORTED")}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                tagFilter === "IMPORTED"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200"
              }`}
            >
              ✅ นำเข้าแล้ว ({tagStats.importedCount})
            </button>
          </div>

          {/* Multi-Select & Batch Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleSelectAll}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-bold cursor-pointer"
            >
              {selectedItemIds.size === filteredItems.length && filteredItems.length > 0
                ? "ยกเลิกการเลือกทั้งหมด"
                : `เลือกทั้งหมด (${filteredItems.length})`}
            </button>

            {selectedItemIds.size > 0 && (
              <>
                <button
                  onClick={handleCopySelectedRows}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                  title="คัดลอกเฉพาะรายการที่เลือกแบบแยกช่อง Tab"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  <span>📋 คัดลอกที่เลือก ({selectedItemIds.size})</span>
                </button>

                <button
                  onClick={() => setShowTagModal(true)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                >
                  <span>🏷️ ติดแท็ก ({selectedItemIds.size})</span>
                </button>

                <button
                  onClick={() => handleBatchMarkStatus("IMPORTED")}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                >
                  <span>✅ มาร์กนำเข้าแล้ว</span>
                </button>

                <button
                  onClick={handleBatchUntag}
                  className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold cursor-pointer"
                >
                  ลบแท็ก
                </button>
              </>
            )}
          </div>
        </div>

        {/* Display Fields Selection Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <span className="text-xs font-bold text-slate-500 mr-1">ฟิลด์ในแถวที่คัดลอก:</span>

          <button
            type="button"
            onClick={() => toggleField("barcode")}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all ${
              displayFields.barcode ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-slate-50 text-slate-500 border-slate-200"
            }`}
          >
            <span>{displayFields.barcode ? "✓" : "+"} บาร์โค้ด</span>
          </button>

          <button
            type="button"
            onClick={() => toggleField("productName")}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all ${
              displayFields.productName ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-slate-50 text-slate-500 border-slate-200"
            }`}
          >
            <span>{displayFields.productName ? "✓" : "+"} ชื่อสินค้า</span>
          </button>

          <button
            type="button"
            onClick={() => toggleField("warehouse")}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all ${
              displayFields.warehouse ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-slate-50 text-slate-500 border-slate-200"
            }`}
          >
            <span>{displayFields.warehouse ? "✓" : "+"} โกดัง</span>
          </button>

          <button
            type="button"
            onClick={() => toggleField("quantity")}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all ${
              displayFields.quantity ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-slate-50 text-slate-500 border-slate-200"
            }`}
          >
            <span>{displayFields.quantity ? "✓" : "+"} จำนวน</span>
          </button>

          <button
            type="button"
            onClick={() => toggleField("sku")}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all ${
              displayFields.sku ? "bg-indigo-50 text-indigo-800 border-indigo-300" : "bg-slate-50 text-slate-500 border-slate-200"
            }`}
          >
            <span>{displayFields.sku ? "✓" : "+"} SKU</span>
          </button>

          <button
            type="button"
            onClick={() => toggleField("location")}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all ${
              displayFields.location ? "bg-amber-50 text-amber-800 border-amber-300" : "bg-slate-50 text-slate-500 border-slate-200"
            }`}
          >
            <span>{displayFields.location ? "✓" : "+"} ตำแหน่ง</span>
          </button>

          <button
            type="button"
            onClick={() => toggleField("docNo")}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all ${
              displayFields.docNo ? "bg-purple-50 text-purple-800 border-purple-300" : "bg-slate-50 text-slate-500 border-slate-200"
            }`}
          >
            <span>{displayFields.docNo ? "✓" : "+"} เลขเอกสาร</span>
          </button>
        </div>
      </div>

      {/* Main Items Content (Clean Light Card Design) */}
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
          <div className="rounded-2xl p-16 text-center border border-slate-200 bg-white shadow-sm">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-slate-800 mb-1">ไม่พบรายการรับสินค้าที่ตรงกับเงื่อนไข</h3>
            <p className="text-slate-500 text-xs sm:text-sm">ลองเปลี่ยนเงื่อนไขการค้นหาหรือตัวกรองแท็ก</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 print:grid-cols-2 print:gap-3 w-full">
            {filteredItems.map((item, idx) => {
              const barcodeValue = item.barcode || item.sku;
              const isRowCopied = copiedItemId === item.id;
              const isBarcodeCopied = copiedItemSku === barcodeValue;
              const isSelected = selectedItemIds.has(item.id);
              const tagged = taggedItemsMap.get(item.id);

              return (
                <div
                  key={`${item.id}-${idx}`}
                  className={`p-4 rounded-2xl border transition-all shadow-sm space-y-3 relative bg-white print:border-black print:break-inside-avoid ${
                    isSelected
                      ? "border-indigo-500 ring-2 ring-indigo-500/20"
                      : tagged?.status === "IMPORTED"
                      ? "border-emerald-300"
                      : tagged
                      ? "border-indigo-300"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {/* Top Bar: Checkbox & Tag Badge */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectItem(item.id)}
                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                      <span className="text-[11px] font-mono font-bold text-slate-600">
                        {item.document_no}
                      </span>
                    </label>

                    {/* Tag Status / Action Buttons */}
                    <div className="flex items-center gap-1.5">
                      {tagged ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(item.id)}
                            title="คลิกเพื่อสลับสถานะ นำเข้าแล้ว / รอนำเข้า"
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                              tagged.status === "IMPORTED"
                                ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                                : "bg-amber-50 text-amber-800 border-amber-300"
                            }`}
                          >
                            <span>{tagged.status === "IMPORTED" ? "✅ นำเข้าแล้ว" : "⏳ รอนำเข้า"}</span>
                          </button>

                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            🏷️ {tagged.tag}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleToggleTag(item)}
                            title="ปลดแท็กนี้ออก"
                            className="text-xs text-slate-400 hover:text-rose-600 p-0.5 cursor-pointer font-bold"
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleTag(item)}
                          className="px-2.5 py-0.5 rounded-lg bg-slate-100 hover:bg-emerald-600 hover:text-white text-slate-700 border border-slate-200 text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1"
                        >
                          <span>+ ติดแท็ก Express</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Header info */}
                  <div className="space-y-1.5">
                    {displayFields.productName && (
                      <div className="text-sm font-bold text-slate-900 leading-snug break-words">
                        {displayFields.sku && <span className="font-mono text-emerald-700 mr-1.5">[{item.sku}]</span>}
                        {item.product_name}
                      </div>
                    )}

                    {!displayFields.productName && displayFields.sku && (
                      <div className="text-sm font-mono font-bold text-emerald-700">
                        รหัสสินค้า: {item.sku}
                      </div>
                    )}

                    {/* Badges: Warehouse, Quantity, Location, Doc No */}
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      {displayFields.warehouse && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 font-bold border border-indigo-200">
                          🏢 โกดัง: <strong className="text-indigo-950">{item.target_sheet} ({toExpressWhCode(item.target_sheet)})</strong>
                        </span>
                      )}

                      {displayFields.quantity && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 font-mono font-extrabold border border-emerald-200">
                          📦 จำนวน: <strong className="text-emerald-700">{item.quantity} ชิ้น</strong>
                        </span>
                      )}

                      {displayFields.location && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-amber-50 text-amber-800 font-mono font-bold border border-amber-200">
                          📍 {item.location}
                        </span>
                      )}

                      {displayFields.docNo && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-mono text-[11px] border border-slate-200">
                          📄 {item.document_no}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Visual Code 128 Barcode Image (Crisp Box) */}
                  {displayFields.barcode && (
                    <div className="py-2.5 w-full flex flex-col items-center justify-center bg-white p-3 rounded-xl border border-slate-200 shadow-2xs print:border-black">
                      <BarcodeSvg value={barcodeValue} height={65} showText={true} />
                    </div>
                  )}

                  {/* Footer Row: Copy Full Row with Tab & Barcode Copy */}
                  <div className="pt-2.5 border-t border-slate-100 space-y-2 print:hidden">
                    {/* Visual Tab String Preview (Light Theme) */}
                    <div
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between text-[11px] font-mono text-slate-600 overflow-x-auto select-all"
                      title="ตัวอย่างข้อมูลเมื่อกดคัดลอก (คั่นด้วย Tab)"
                    >
                      <span className="truncate">
                        {item.barcode}&nbsp;<span className="text-emerald-700 font-black bg-emerald-100 px-1 rounded text-[10px]">TAB</span>&nbsp;
                        {item.product_name}&nbsp;<span className="text-emerald-700 font-black bg-emerald-100 px-1 rounded text-[10px]">TAB</span>&nbsp;
                        {toExpressWhCode(item.target_sheet)}&nbsp;<span className="text-emerald-700 font-black bg-emerald-100 px-1 rounded text-[10px]">TAB</span>&nbsp;
                        {item.quantity}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopySingleBarcode(barcodeValue)}
                        className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all cursor-pointer"
                        title="คัดลอกเฉพาะเลขบาร์โค้ด"
                      >
                        <span>{isBarcodeCopied ? "✓ คัดลอกเลขแล้ว" : "คัดลอกบาร์โค้ด"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyRow(item)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                          isRowCopied
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "bg-emerald-50 hover:bg-emerald-600 text-emerald-800 hover:text-white border border-emerald-300 hover:border-emerald-600"
                        }`}
                        title="คัดลอกทั้งแถว (บาร์โค้ด [TAB] ชื่อสินค้า [TAB] โกดัง [TAB] จำนวน) เพื่อไปกด Ctrl+V ใน Express"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                        <span>{isRowCopied ? "✓ คัดลอกแถวแล้ว!" : "📋 คัดลอกทั้งแถว (Tab)"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:bg-white"
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
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm cursor-pointer"
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
