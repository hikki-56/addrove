"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import { useRouter } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import { getWarehouseName } from "@/lib/warehouse-utils";
import ExpressImportWorkspaceHeader, {
  type ExpressDatePreset,
  type ExpressStatusFilter,
} from "../_components/ExpressImportWorkspaceHeader";
import ExpressToast, { type ExpressToastState } from "../_components/ExpressToast";
import {
  getAllTaggedExpressItems,
  tagExpressItem,
  batchTagExpressItems,
  updateExpressItemStatus,
  type TaggedExpressItem,
  type ExpressSyncStatus,
} from "@/lib/express-tag-utils";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

// เพิ่ม meta ของคอลัมน์สำหรับคลาส Tailwind ของ <th>/<td> (แนวทางตามเอกสาร TanStack Table)
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    th?: string;
    td?: string;
  }
}

type TagFilterType = ExpressStatusFilter;

type DatePreset = ExpressDatePreset;

const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// จำนวนแถวต่อหน้าของตาราง — ข้อมูลเต็มยังอยู่ใน filteredItems แบ่งแสดงฝั่งหน้าเว็บเท่านั้น
const PAGE_SIZE = 10;

// ลูกศรบอกสถานะการเรียงบนหัวคอลัมน์ (ดีไซน์เดียวกับหน้า issue)
function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
  const base = "w-3.5 h-3.5 shrink-0";
  if (dir === "asc") {
    return (
      <svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    );
  }
  if (dir === "desc") {
    return (
      <svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14M19 12l-7 7-7-7" />
      </svg>
    );
  }
  return (
    <svg className={`${base} opacity-40`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
    </svg>
  );
}

export default function ExpressReceivePage() {
  const router = useRouter();
  const { user, status } = useTabAuth();

  useEffect(() => {
    if (status !== "loading" && user && user.role !== "ADMIN") {
      router.replace("/dashboard");
    }
  }, [status, user, router]);

  const [apiItems, setApiItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // true = รอบดึงข้อมูลล่าสุดล้มเหลว (เครือข่าย/เซิร์ฟเวอร์) — โชว์แบนเนอร์พร้อมปุ่มลองใหม่ ไม่ปล่อยให้กลายเป็น empty state หลอก
  const [fetchError, setFetchError] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string>("ALL");
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  // ค่าเริ่มต้นโชว์เฉพาารายการของวันนี้ — ข้อมูลเก่าต้องกด "ทั้งหมด" เอง (แนวเดียวกับหน้า issue)
  const [datePreset, setDatePreset] = useState<DatePreset>("TODAY");
  const [tagFilter, setTagFilter] = useState<TagFilterType>("ALL");
  const [copiedItemSku, setCopiedItemSku] = useState<string | null>(null);
  const [toast, setToast] = useState<ExpressToastState | null>(null);
  // แบ่งหน้าตาราง + เรียงคอลัมน์ (TanStack Table เหมือนหน้า issue)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [sorting, setSorting] = useState<SortingState>([]);

  // เปลี่ยนตัวกรอง/คำค้นหาเมื่อไหร่ กลับไปหน้า 1 เสมอ
  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedWarehouse, datePreset, tagFilter]);

  // Tagging State
  const [taggedItemsMap, setTaggedItemsMap] = useState<Map<string, TaggedExpressItem>>(new Map());

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
      const [recRes, statusRes] = await Promise.all([
        fetch(`/api/express-import/receive`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/express-import/status?type=RECEIVE`, { cache: "no-store" }).catch(() => null),
      ]);

      const recJson = recRes ? await recRes.json().catch(() => null) : null;
      const statusJson = statusRes ? await statusRes.json().catch(() => null) : null;

      // ดึงรายการหลักไม่สำเร็จ (เครือข่าย/เซิร์ฟเวอร์) — โชว์แบนเนอร์ให้ผู้ใช้รู้จริง ไม่ปล่อยให้กลายเป็น empty state หลอก
      setFetchError(recRes === null || recJson?.success !== true);

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
          const docExpressStatus: ExpressSyncStatus = srv?.status || (item.status as ExpressSyncStatus) || "PENDING";

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
      setFetchError(true);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [refreshTaggedMap]);

  // hook ส่ง initial=true เฉพาะครั้งแรก — ครั้งแรกโชว์ loading, รอบ polling ต้อง refresh เงียบ ๆ
  // wrapper ต้อง memoize เพราะ hook ใช้ callback เป็น dependency ของ effect
  const pollingFetch = useCallback((initial?: boolean) => {
    void fetchDocs(!initial);
  }, [fetchDocs]);
  usePollingWhenVisible(pollingFetch, 6000);

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

  // กรองตามช่วงเวลาลัด — คำนวณจาก preset ที่เลือก เทียบเป็นสตริง ISO (YYYY-MM-DD)
  const presetRange = useMemo(() => {
    const now = new Date();
    const today = toIsoDate(now);
    switch (datePreset) {
      case "TODAY":
        return { from: today, to: today };
      case "YESTERDAY": {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        const iso = toIsoDate(y);
        return { from: iso, to: iso };
      }
      case "LAST_7_DAYS": {
        const s = new Date(now);
        s.setDate(s.getDate() - 6);
        return { from: toIsoDate(s), to: today };
      }
      case "THIS_MONTH": {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        return { from: toIsoDate(s), to: today };
      }
      default:
        return { from: "", to: "" };
    }
  }, [datePreset]);

  const isInDateRange = useCallback(
    (rawDate: string): boolean => {
      if (!presetRange.from && !presetRange.to) return true;
      const parts = parseDateParts(rawDate);
      if (!parts) return false;
      const iso = `${parts.year}-${parts.month}-${parts.day}`;
      if (presetRange.from && iso < presetRange.from) return false;
      if (presetRange.to && iso > presetRange.to) return false;
      return true;
    },
    [presetRange]
  );

  const availableWarehouses = useMemo(() => {
    const set = new Set<string>();
    apiItems.forEach((i) => {
      if (i.warehouse_name) set.add(i.warehouse_name);
    });
    return Array.from(set);
  }, [apiItems]);

  const warehouseOptions = useMemo(() => [
    { value: "ALL", label: `ทุกคลังสินค้า (${availableWarehouses.length})` },
    ...availableWarehouses.map((wh) => ({
      value: wh,
      label: `โกดัง: ${getWarehouseDisplayName(wh)}`,
    })),
  ], [availableWarehouses]);

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

  // Filter items by search query, Tag filter, & date preset
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

      // Date preset check
      if (!isInDateRange(item.document_date)) return false;

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
  }, [allItems, searchQuery, tagFilter, taggedItemsMap, isInDateRange]);

  // แบ่งหน้า — currentPage กันค่าเกินกรณี polling ทำให้จำนวนแถวหดระหว่างอยู่หน้าท้าย
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  // เลขหน้าแสดงสูงสุด 5 ปุ่ม ครอบหน้าปัจจุบันไว้กลางเสมอ
  const pageWindow = useMemo(() => {
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [currentPage, totalPages]);

  // คลาสปุ่มเลขหน้า — หน้าปัจจุบันพื้นเขียวตัวขาว
  const pageBtnClass = (active: boolean): string =>
    `min-h-[44px] min-w-[44px] px-3.5 rounded-xl text-base font-bold border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2 ${
      active
        ? "bg-[#06402B] border-[#06402B] text-white shadow-sm shadow-[#06402B]/25"
        : "border-[#E8ECEA] bg-white text-slate-700 hover:border-[#5B8A74] hover:text-[#053425]"
    }`;

  // Tagging Stats
  const tagStats = useMemo(() => {
    let taggedCount = 0;
    let pendingCount = 0;
    let importedCount = 0;

    const baseItems = allItems.filter((item) => isInDateRange(item.document_date));

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
  }, [allItems, taggedItemsMap, isInDateRange]);

  // Helper to sync status to Google Sheets and DB in background
  const syncStatusToSheet = useCallback(async (items: Array<{ document_no: string; sku?: string; status: ExpressSyncStatus; type: "RECEIVE" }>) => {
    try {
      const res = await fetch("/api/express-import/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        throw new Error(`status sync HTTP ${res.status}`);
      }
      const firstItem = items[0];
      const statusLabel = firstItem?.status === "IMPORTED" ? "นำเข้าแล้ว" : "รอนำเข้า";
      const docDesc = items.length === 1 && firstItem?.document_no
        ? `เลขที่ ${firstItem.document_no}`
        : `${items.length} รายการ`;
      setToast({
        message: `บันทึกสถานะ "${statusLabel}" (${docDesc}) เข้า Google Sheets เรียบร้อย`,
        tone: "success",
      });
    } catch (e) {
      console.warn("[ExpressReceivePage] Background status sync to sheet failed:", e);
      setToast({
        message: "ไม่สามารถบันทึกสถานะเข้า Google Sheets ได้ ระบบจะลองใหม่อัตโนมัติ",
        tone: "error",
      });
    }
  }, []);

  // Handle single item status update
  const handleSetStatus = useCallback(
    (item: (typeof allItems)[0], status: ExpressSyncStatus) => {
      const existing = taggedItemsMap.get(item.id);
      if (!existing) {
        tagExpressItem({
          id: item.id,
          type: "RECEIVE",
          tag: "นำเข้าสินค้าเข้าExpress",
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
    },
    [taggedItemsMap, refreshTaggedMap, syncStatusToSheet]
  );

  // Copy single barcode value
  const handleCopySingleBarcode = useCallback((barcode: string) => {
    navigator.clipboard.writeText(barcode);
    setCopiedItemSku(barcode);
    setTimeout(() => setCopiedItemSku(null), 2000);
  }, []);

  // ล้างตัวกรองทุกตัวในคลิกเดียว (ใช้ใน empty state)
  const handleClearAllFilters = () => {
    setSearchQuery("");
    setDatePreset("ALL");
    setSelectedWarehouse("ALL");
    setTagFilter("ALL");
  };

  // ── TanStack Table v8 (headless) — logic แบ่งหน้า/จัดการแถว, หน้าตาเป็น Tailwind เดิมทั้งหมด ──
  type ReceiveItem = (typeof allItems)[number];

  const columns = useMemo<ColumnDef<ReceiveItem, any>[]>(
    () => [
      {
        id: "no",
        header: "ลำดับ",
        enableSorting: false,
        meta: { th: "text-center w-16 text-base sm:text-[17px] font-bold text-slate-900", td: "text-center" },
        // ลำดับที่มองเห็น = ตำแหน่งในลิสต์ที่เรียงแล้ว (นับต่อเนื่องข้ามหน้า)
        cell: ({ row, table }) => {
          const { pageIndex, pageSize } = table.getState().pagination;
          const visibleIndex = table.getPaginationRowModel().rows.findIndex((r) => r.id === row.id);
          return <span className="disp text-base sm:text-[17px] font-bold num text-slate-700">{pageIndex * pageSize + visibleIndex + 1}</span>;
        },
      },
      {
        accessorKey: "document_no",
        header: "เลขที่เอกสาร",
        meta: { th: "text-left text-base sm:text-[17px] font-bold text-slate-900", td: "whitespace-nowrap" },
        cell: ({ row }) => {
          const item = row.original;
          return (
            <>
              <div className="font-mono font-bold text-slate-900 text-[17px] sm:text-lg">{item.document_no}</div>
              {item.document_date && item.document_date !== "-" && (
                <div className="text-base font-medium text-slate-600 font-mono mt-1">{item.document_date.slice(0, 10)}</div>
              )}
            </>
          );
        },
      },
      {
        id: "barcode",
        header: "บาร์โค้ด",
        enableSorting: false,
        meta: { th: "text-center text-base sm:text-[17px] font-bold text-slate-900", td: "text-center" },
        cell: ({ row }) => {
          const item = row.original;
          const barcodeValue = item.barcode || item.sku;
          const isBarcodeCopied = copiedItemSku === barcodeValue;
          return (
            <div className="flex flex-col items-center justify-center gap-1.5 py-1">
              <div className="bg-white px-3 py-2 rounded-xl border border-[#D5DDD9] shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <BarcodeSvg value={barcodeValue} height={48} width={1.5} fontSize={14} showText={true} />
              </div>
              <button
                type="button"
                onClick={() => handleCopySingleBarcode(barcodeValue)}
                aria-label={`คัดลอกเลขบาร์โค้ด ${barcodeValue}`}
                className="text-base font-bold text-[#344054] hover:text-[#053425] px-3 py-1.5 min-h-[36px] rounded-lg hover:bg-black/[.05] transition-colors cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2 print:hidden"
                title="คัดลอกเฉพาะเลขบาร์โค้ด"
              >
                {isBarcodeCopied ? (
                  <span className="text-[#053425] font-bold inline-flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.5l5 5L19.5 7" />
                    </svg>
                    คัดลอกแล้ว
                  </span>
                ) : (
                  <>
                    <svg className="w-4 h-4 text-[#475467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>คัดลอกเลข</span>
                  </>
                )}
              </button>
            </div>
          );
        },
      },
      {
        accessorKey: "sku",
        header: "รหัสสินค้า",
        meta: { th: "text-left text-base sm:text-[17px] font-bold text-slate-900", td: "font-mono font-bold text-slate-900 text-base sm:text-lg" },
        cell: ({ getValue }) => getValue<string>() || "-",
      },
      {
        accessorKey: "product_name",
        header: "ชื่อสินค้า",
        meta: { th: "min-w-[260px] text-left text-base sm:text-[17px] font-bold text-slate-900", td: "min-w-[260px] whitespace-nowrap" },
        cell: ({ row }) => (
          <div className="text-slate-900 font-bold text-[18px] sm:text-[19px] leading-snug" title={row.original.product_name}>
            {row.original.product_name}
          </div>
        ),
      },
      {
        id: "warehouse",
        header: "คลังสินค้า",
        meta: { th: "text-center text-base sm:text-[17px] font-bold text-slate-900", td: "text-center whitespace-nowrap" },
        cell: ({ row }) => (
          <div className="inline-flex items-center gap-1.5 text-slate-800 text-base sm:text-[17px] font-semibold">
            <span>{getWarehouseDisplayName(row.original.target_sheet)}</span>
          </div>
        ),
      },
      {
        accessorKey: "location",
        header: "ตำแหน่ง",
        meta: { th: "text-center text-base sm:text-[17px] font-bold text-slate-900", td: "text-center" },
        cell: ({ getValue }) => {
          const val = getValue<string>();
          const hasVal = val && val !== "-";
          return (
            <span className={`font-mono font-bold text-base sm:text-[17px] ${hasVal ? "text-slate-900 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200/70" : "text-slate-400"}`}>
              {hasVal ? val : "-"}
            </span>
          );
        },
      },
      {
        accessorKey: "quantity",
        header: "จำนวน",
        meta: { th: "text-right text-base sm:text-[17px] font-bold text-slate-900", td: "text-right whitespace-nowrap" },
        cell: ({ getValue }) => (
          <>
            <span className="disp font-black num text-slate-900 text-[24px] sm:text-[26px]">{Number(getValue()).toLocaleString()}</span>
            <span className="font-bold text-slate-600 text-base sm:text-[17px] ml-1.5">ชิ้น</span>
          </>
        ),
      },
      {
        id: "status",
        header: "สถานะ Express",
        enableSorting: false,
        meta: { th: "text-center text-base sm:text-[17px] font-bold text-slate-900 print:hidden", td: "text-center print:hidden" },
        cell: ({ row }) => {
          const item = row.original;
          const tagged = taggedItemsMap.get(item.id);
          const effectiveStatus: ExpressSyncStatus = tagged?.status || item.express_status || "PENDING";
          const isImported = effectiveStatus === "IMPORTED";
          return (
            <select
              value={effectiveStatus}
              onChange={(e) => handleSetStatus(item, e.target.value as ExpressSyncStatus)}
              aria-label={`สถานะ Express ของเอกสาร ${item.document_no} สินค้า ${item.product_name}`}
              className={`px-4 min-h-[46px] rounded-full text-base sm:text-[17px] font-bold border transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2 ${
                isImported
                  ? "bg-[#DFEDE6] text-[#052B1F] border-[#8FB3A3] hover:bg-[#C9DFD4]/60"
                  : "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200/60"
              }`}
            >
              <option value="PENDING">รอนำเข้า</option>
              <option value="IMPORTED">นำเข้าแล้ว</option>
            </select>
          );
        },
      },
    ],
    [taggedItemsMap, copiedItemSku, handleSetStatus, handleCopySingleBarcode]
  );

  const table = useReactTable({
    data: filteredItems,
    columns,
    state: {
      pagination: { pageIndex: currentPage - 1, pageSize },
      sorting,
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater({ pageIndex: currentPage - 1, pageSize }) : updater;
      setPage(next.pageIndex + 1);
      setPageSize(next.pageSize);
    },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(1); // เรียงใหม่เมื่อไหร่กลับไปหน้า 1
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // คุมการกลับหน้า 1 เองผ่าน useEffect ตัวกรอง (กัน polling เปลี่ยนข้อมูลแล้วหน้ากระโดด)
    autoResetPageIndex: false,
  });

  return (
    <div className="w-full max-w-full space-y-4 sm:space-y-5 pb-12">
      <ExpressToast toast={toast} onClose={() => setToast(null)} />
      <ExpressImportWorkspaceHeader
        mode="receive"
        loading={loading}
        totalCount={tagStats.total}
        pendingCount={tagStats.pendingCount}
        importedCount={tagStats.importedCount}
        visibleCount={filteredItems.length}
        statusFilter={tagFilter}
        onStatusFilterChange={setTagFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        selectedWarehouse={selectedWarehouse}
        onWarehouseChange={setSelectedWarehouse}
        warehouseOptions={warehouseOptions}
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        hasActiveFilters={Boolean(searchQuery.trim()) || selectedWarehouse !== "ALL" || datePreset !== "TODAY" || tagFilter !== "ALL"}
        onClearFilters={handleClearAllFilters}
      />

      {/* เนื้อหาหลัก */}
      <div className="space-y-4">
        {/* หัวกระดาษเมื่อพิมพ์ */}
        <div className="hidden print:block text-center mb-6 pb-3 border-b-2 border-black">
          <h1 className="text-xl font-bold text-black">ใบสแกนบาร์โค้ดรับสินค้า — Express ERP</h1>
          <p className="text-sm text-slate-600 mt-1">
            วันที่พิมพ์: {new Date().toLocaleDateString("th-TH")} | รวม {filteredItems.length} รายการ
          </p>
        </div>

        {/* แบนเนอร์ข้อผิดพลาด — รอบดึงข้อมูลล่าสุดล้มเหลว (ซ่อนระหว่างโหลดซ้ำ และหายเองเมื่อรอบถัดไปสำเร็จ) */}
        {fetchError && !loading && (
          <div
            role="alert"
            className="bg-white rounded-[20px] border border-[#F3C4BA] px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 print:hidden"
          >
            <div className="flex items-center gap-2.5 text-[#9B1C1C]">
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4M12 17h.01" />
              </svg>
              <p className="text-base font-bold">โหลดข้อมูลไม่สำเร็จ — ตรวจการเชื่อมต่อแล้วลองใหม่</p>
            </div>
            <button
              type="button"
              onClick={() => pollingFetch(true)}
              className="min-h-[44px] px-4 rounded-xl border border-[#E8B7AC] bg-white text-[#9B1C1C] text-base font-bold hover:bg-[#FDF3F1] transition-colors cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" />
              </svg>
              ลองใหม่
            </button>
          </div>
        )}

        {loading ? (
          <div
            className="bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)] overflow-hidden"
            aria-busy="true"
            aria-label="กำลังโหลดรายการรับสินค้า"
          >
            <div className="bg-slate-50 border-b border-[#E8ECEA] px-4 py-3.5 flex items-center gap-4">
              <div className="skeleton h-4 w-8 shrink-0" />
              <div className="skeleton h-4 w-28 hidden sm:block" />
              <div className="skeleton h-4 w-20 mx-auto hidden md:block" />
              <div className="skeleton h-4 w-24 hidden lg:block" />
              <div className="skeleton h-4 w-20 ml-auto" />
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 py-[21px] border-b border-[#EEF1EF] last:border-b-0 flex items-center gap-4">
                <div className="skeleton h-4 w-8 shrink-0" />
                <div className="skeleton h-4 w-36 hidden sm:block" />
                <div className="skeleton h-10 w-24 shrink-0" />
                <div className="skeleton h-4 flex-1 min-w-[80px] max-w-[240px]" />
                <div className="skeleton h-7 w-28 ml-auto shrink-0 hidden sm:block" />
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          allItems.length === 0 ? (
            /* ไม่มีข้อมูลจากระบบเลย — แยกกรณีคลังที่กรองไว้ (มีทางออก) กับไม่มีข้อมูลจริง */
            <div className="bg-white rounded-[20px] border border-[#E8ECEA] p-10 sm:p-16 text-center">
              <div className="w-14 h-14 rounded-full bg-black/[.04] flex items-center justify-center mx-auto mb-3 text-slate-400">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3.5 7.5L12 12l8.5-4.5M12 12v9" />
                </svg>
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-slate-800">ยังไม่มีรายการรับสินค้า</h3>
              {selectedWarehouse !== "ALL" ? (
                <>
                  <p className="text-base text-slate-500 mt-1.5">ไม่พบรายการในคลังที่เลือก — ลองดูทุกคลังสินค้า</p>
                  <button
                    type="button"
                    onClick={handleClearAllFilters}
                    className="min-h-[46px] px-6 mt-4 rounded-xl border border-[#D5DDD9] bg-white text-base font-bold text-slate-700 hover:bg-black/[.03] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
                  >
                    ล้างตัวกรอง
                  </button>
                </>
              ) : (
                <p className="text-base text-slate-500 mt-1.5">รายการจะแสดงที่นี่เมื่อมีการบันทึกรับสินค้าในระบบ</p>
              )}
            </div>
          ) : tagFilter === "PENDING" && !searchQuery.trim() ? (
            /* กรอง "รอนำเข้า" แล้วว่าง = นำเข้าครบแล้ว */
            <div className="bg-white rounded-[20px] border border-[#E8ECEA] p-10 sm:p-16 text-center">
              <div className="w-14 h-14 rounded-full bg-[#EAF2EE] border border-[#C9DFD4] flex items-center justify-center mx-auto mb-3 text-[#053425]">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.5l5 5L19.5 7" />
                </svg>
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-slate-800">นำเข้าครบแล้ว</h3>
              <p className="text-base text-slate-500 mt-1.5 mb-4">ทุกรายการในช่วงเวลานี้นำเข้า Express เรียบร้อย</p>
              <button
                type="button"
                onClick={() => setTagFilter("ALL")}
                className="min-h-[46px] px-6 rounded-xl border border-[#D5DDD9] bg-white text-base font-bold text-slate-700 hover:bg-black/[.03] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
              >
                ดูทั้งหมด
              </button>
            </div>
          ) : (
            /* ค้นหา/กรองแล้วไม่เจอ */
            <div className="bg-white rounded-[20px] border border-[#E8ECEA] p-10 sm:p-16 text-center">
              <div className="w-14 h-14 rounded-full bg-black/[.04] flex items-center justify-center mx-auto mb-3 text-slate-400">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-slate-800 mb-4">
                {searchQuery.trim() ? `ไม่พบ "${searchQuery.trim()}"` : "ไม่พบรายการที่ตรงกับตัวกรอง"}
              </h3>
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="min-h-[46px] px-6 rounded-xl border border-[#D5DDD9] bg-white text-base font-bold text-slate-700 hover:bg-black/[.03] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
              >
                ล้างตัวกรอง
              </button>
            </div>
          )
        ) : (
          /* ตารางรายการรับสินค้า */
          <div className="bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)] overflow-hidden print:rounded-none print:shadow-none print:border-black">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow
                      key={headerGroup.id}
                      className="bg-slate-50 hover:bg-slate-50 border-b border-[#E8ECEA] print:bg-white"
                    >
                      {headerGroup.headers.map((header) => (
                        <TableHead
                          key={header.id}
                          className={(header.column.columnDef.meta as { th?: string } | undefined)?.th ?? ""}
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 transition-colors hover:text-slate-900 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425]"
                              title="คลิกเพื่อเรียงข้อมูล"
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              <SortIcon dir={header.column.getIsSorted()} />
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody className="text-base">
                  {table.getRowModel().rows.map((row) => {
                    const item = row.original;
                    const tagged = taggedItemsMap.get(item.id);
                    const effectiveStatus: ExpressSyncStatus = tagged?.status || item.express_status || "PENDING";
                    const isImported = effectiveStatus === "IMPORTED";

                    return (
                      <TableRow
                        key={row.id}
                        className={
                          isImported
                            ? "bg-[#EAF2EE] border-[#C9DFD4] hover:bg-[#DFEDE6]/70"
                            : undefined
                        }
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell
                            key={cell.id}
                            className={(cell.column.columnDef.meta as { td?: string } | undefined)?.td ?? ""}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* แบ่งหน้า — แสดงเมื่อมีมากกว่า 1 หน้า */}
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[#EEF1EF] print:hidden">
                <p className="text-base font-semibold text-slate-700">
                  แสดง {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredItems.length)} จาก{" "}
                  {filteredItems.length.toLocaleString()} รายการ
                </p>
                <nav className="flex flex-wrap items-center gap-1.5" aria-label="แบ่งหน้ารายการ">
                  <label className="flex items-center gap-2 text-base font-semibold text-slate-700 mr-2">
                    แถว/หน้า
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      className="min-h-[44px] px-3 rounded-xl text-base font-bold border border-[#E8ECEA] bg-white text-slate-800 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#053425]"
                    >
                      {[10, 20, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="min-h-[44px] px-4 rounded-xl text-base font-bold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-[#E8ECEA] bg-white text-slate-700 hover:border-[#5B8A74] hover:text-[#053425] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
                  >
                    ‹ ก่อนหน้า
                  </button>
                  {pageWindow[0] > 1 && (
                    <>
                      <button type="button" onClick={() => setPage(1)} className={pageBtnClass(false)}>1</button>
                      {pageWindow[0] > 2 && <span className="px-1 text-slate-400" aria-hidden="true">…</span>}
                    </>
                  )}
                  {pageWindow.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      aria-current={p === currentPage ? "page" : undefined}
                      className={pageBtnClass(p === currentPage)}
                    >
                      {p}
                    </button>
                  ))}
                  {pageWindow[pageWindow.length - 1] < totalPages && (
                    <>
                      {pageWindow[pageWindow.length - 1] < totalPages - 1 && (
                        <span className="px-1 text-slate-400" aria-hidden="true">…</span>
                      )}
                      <button type="button" onClick={() => setPage(totalPages)} className={pageBtnClass(false)}>
                        {totalPages}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="min-h-[44px] px-4 rounded-xl text-base font-bold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-[#E8ECEA] bg-white text-slate-700 hover:border-[#5B8A74] hover:text-[#053425] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
                  >
                    ถัดไป ›
                  </button>
                </nav>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
