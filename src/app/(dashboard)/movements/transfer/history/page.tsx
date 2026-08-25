"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { getWarehouseName, normalizeWarehouseId } from "@/lib/warehouse-utils";
import {
  getTransferNotifications,
  getDisplayProductName,
  isTransferCompleted,
  parseTransferMetadata,
  purgeInvalidNotifications,
} from "@/lib/transfer-notification-utils";
import type { Product, Warehouse } from "@/types/models";

export interface TransferHistoryRecord {
  id: string;
  doc_no: string;
  reference_no: string;
  barcode: string;
  sku: string;
  product_id: string;
  product_name: string;
  from_warehouse_id: string;
  from_warehouse_name: string;
  to_warehouse_id: string;
  to_warehouse_name: string;
  qty: number;
  base_unit: string;
  created_by_name: string;
  created_by: string;
  moved_by: string;
  assigned_to_name: string;
  assigned_to_user_id: string;
  status: "PENDING" | "ACKNOWLEDGED" | "WAITING_APPROVAL" | "COMPLETED" | "CANCELLED" | "REJECTED";
  created_at: string;
  document_date: string;
  from_location_id?: string;
  to_location_id?: string;
  source_allocations?: Array<{ location_id: string; location_name?: string; qty: number }>;
  note?: string;
  original_note?: string;
}

// Custom Scrollable Dropdown (shows ~4 items at a time with smooth scroll)
function ScrollableSelect({
  value,
  options,
  onChange,
  title,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
  title?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentOption = options.find((o) => o.value === value);

  return (
    <div className="relative flex-1 min-w-0" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={title}
        className="w-full flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200 text-slate-800 text-xs font-semibold transition-all cursor-pointer shadow-2xs focus:outline-none focus:border-indigo-500 focus:bg-white"
      >
        <span className="truncate">{currentOption ? currentOption.label : value}</span>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-full min-w-[150px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-[148px] overflow-y-auto divide-y divide-slate-100 py-1">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? "bg-indigo-50 text-indigo-700 font-bold"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <span className="text-indigo-600 text-xs font-bold ml-1.5 shrink-0">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TransferHistoryPage() {
  const { user } = useTabAuth();

  // Data states
  const [records, setRecords] = useState<TransferHistoryRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter states (Default date range: วันนั้นๆ / TODAY)
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedFromWh, setSelectedFromWh] = useState<string>("ALL");
  const [selectedToWh, setSelectedToWh] = useState<string>("ALL");
  const [selectedDateRange, setSelectedDateRange] = useState<string>("TODAY");
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Dropdown options
  const statusOptions = useMemo(
    () => [
      { value: "ALL", label: "สถานะทั้งหมด" },
      { value: "COMPLETED", label: "สำเร็จแล้ว (Completed)" },
      { value: "WAITING_APPROVAL", label: "รออนุมัติ (Waiting Approval)" },
      { value: "PENDING", label: "รอดำเนินการ (Pending)" },
      { value: "CANCELLED", label: "ยกเลิก / ปฏิเสธ (Cancelled)" },
    ],
    []
  );

  const fromWarehouseOptions = useMemo(
    () => [
      { value: "ALL", label: "โกดังต้นทางทั้งหมด" },
      { value: "wh-01", label: "โกดัง1" },
      { value: "wh-02", label: "โกดัง2" },
      { value: "wh-03", label: "โกดัง3" },
      { value: "wh-04", label: "โกดัง4" },
      { value: "wh-05", label: "โกดัง5" },
      { value: "wh-06", label: "สำนักงานใหญ่" },
    ],
    []
  );

  const toWarehouseOptions = useMemo(
    () => [
      { value: "ALL", label: "โกดังปลายทางทั้งหมด" },
      { value: "wh-01", label: "โกดัง1" },
      { value: "wh-02", label: "โกดัง2" },
      { value: "wh-03", label: "โกดัง3" },
      { value: "wh-04", label: "โกดัง4" },
      { value: "wh-05", label: "โกดัง5" },
      { value: "wh-06", label: "สำนักงานใหญ่" },
    ],
    []
  );

  const dateRangeOptions = useMemo(
    () => [
      { value: "ALL", label: "ช่วงเวลาทั้งหมด" },
      { value: "TODAY", label: "วันนี้" },
      { value: "YESTERDAY", label: "เมื่อวานนี้" },
      { value: "LAST_7_DAYS", label: "7 วันล่าสุด" },
      { value: "LAST_30_DAYS", label: "30 วันล่าสุด" },
      { value: "THIS_MONTH", label: "เดือนนี้" },
      { value: "LAST_MONTH", label: "เดือนที่แล้ว" },
    ],
    []
  );

  const handleDateRangeChange = (preset: string) => {
    setSelectedDateRange(preset);
    setCurrentPage(1);

    const now = new Date();
    const toYMD = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    if (preset === "TODAY") {
      const todayStr = toYMD(now);
      setDateFrom(todayStr);
      setDateTo(todayStr);
    } else if (preset === "YESTERDAY") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yStr = toYMD(y);
      setDateFrom(yStr);
      setDateTo(yStr);
    } else if (preset === "LAST_7_DAYS") {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      setDateFrom(toYMD(start));
      setDateTo(toYMD(now));
    } else if (preset === "LAST_30_DAYS") {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      setDateFrom(toYMD(start));
      setDateTo(toYMD(now));
    } else if (preset === "THIS_MONTH") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setDateFrom(toYMD(start));
      setDateTo(toYMD(end));
    } else if (preset === "LAST_MONTH") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      setDateFrom(toYMD(start));
      setDateTo(toYMD(end));
    } else {
      setDateFrom("");
      setDateTo("");
    }
  };

  // Detail Modal state
  const [selectedRecord, setSelectedRecord] = useState<TransferHistoryRecord | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  // Refs for debouncing and stale-load protection
  const loadIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch all transfer records, products, and warehouses
  const loadData = useCallback(async (showRefreshing = false) => {
    const currentLoadId = ++loadIdRef.current;
    if (showRefreshing) setIsRefreshing(true);
    try {
      purgeInvalidNotifications();

      // 1. Fetch products & warehouses for data enrichment
      const [prodsRes, whsRes] = await Promise.allSettled([
        fetch("/api/products").then((r) => (r.ok ? r.json() : { data: [] })),
        fetch("/api/warehouses").then((r) => (r.ok ? r.json() : { data: [] })),
      ]);

      const loadedProducts: Product[] =
        prodsRes.status === "fulfilled" && Array.isArray(prodsRes.value.data)
          ? prodsRes.value.data
          : [];
      const loadedWarehouses: Warehouse[] =
        whsRes.status === "fulfilled" && Array.isArray(whsRes.value.data)
          ? whsRes.value.data
          : [];

      setProducts(loadedProducts);
      setWarehouses(loadedWarehouses);

      // Create quick lookup maps for fast enrichment
      const prodMapBySku = new Map<string, Product>();
      const prodMapById = new Map<string, Product>();
      const prodMapByBarcode = new Map<string, Product>();

      for (const p of loadedProducts) {
        if (p.sku) prodMapBySku.set(p.sku.trim().toLowerCase(), p);
        if (p.product_id) prodMapById.set(p.product_id.trim().toLowerCase(), p);
        if (p.barcode) prodMapByBarcode.set(p.barcode.trim().toLowerCase(), p);
      }

      // 2. Fetch server transfer documents
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

      const headers: Record<string, string> = {};
      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      let serverDocs: any[] = [];
      try {
        const res = await fetch(`/api/movements/transfer?_t=${Date.now()}`, { headers, cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            serverDocs = json.data;
          }
        }
      } catch (err) {
        console.warn("[TransferHistory] Server fetch error:", err);
      }

      // 3. Get local notifications for optimistic and recent transfers
      const localNotifs = getTransferNotifications();

      // 4. Map & Enrich all records
      const recordMap = new Map<string, TransferHistoryRecord>();

      // A. Process server documents
      for (const doc of serverDocs) {
        if (!doc) continue;
        const docId = String(doc.document_id || doc.document_no || "").trim();
        if (!docId) continue;

        const meta = parseTransferMetadata(doc.note);

        const rawProdId = String(meta.product_id || doc.product_id || "").trim();
        const rawSku = String(meta.sku || doc.sku || (rawProdId.startsWith("prod-") ? rawProdId.replace(/^prod-/, "") : ""));
        const rawBarcode = String(meta.barcode || doc.barcode || "");

        // Product fallback enrichment
        const matchedProduct =
          (rawSku ? prodMapBySku.get(rawSku.toLowerCase()) : undefined) ||
          (rawProdId ? prodMapById.get(rawProdId.toLowerCase()) : undefined) ||
          (rawBarcode ? prodMapByBarcode.get(rawBarcode.toLowerCase()) : undefined);

        const sku = rawSku || matchedProduct?.sku || (rawProdId && !rawProdId.startsWith("trf") ? rawProdId : "-");
        const barcode = rawBarcode || matchedProduct?.barcode || "-";
        const productName =
          String(meta.product_name || doc.product_name || matchedProduct?.product_name || (sku !== "-" ? `สินค้า ${sku}` : "รายการเบิกสินค้า")).trim();
        const baseUnit = String(meta.base_unit || doc.base_unit || matchedProduct?.base_unit || "ชิ้น").trim();

        const fromWhId = normalizeWarehouseId(meta.from_warehouse_id || doc.from_warehouse_id || "wh-01");
        const toWhId = normalizeWarehouseId(meta.to_warehouse_id || doc.to_warehouse_id || "wh-02");
        const fromWhName = getWarehouseName(fromWhId);
        const toWhName = getWarehouseName(toWhId);

        const qty = Number(meta.qty !== undefined && meta.qty !== null ? meta.qty : (doc.qty || 1));
        const rawMovedBy = String(
          meta.moved_by ||
          meta.assigned_to_name ||
          doc.assigned_to_name ||
          doc.moved_by ||
          ""
        ).trim();

        const movedBy =
          rawMovedBy && rawMovedBy !== "null" && rawMovedBy !== "undefined" && rawMovedBy !== "-"
            ? rawMovedBy
            : "-";

        const createdBy = String(meta.created_by || doc.created_by || "").trim();
        const rawCreatedByName = String(
          meta.created_by_name ||
          doc.created_by_name ||
          (createdBy && !createdBy.toLowerCase().includes("admin") && !createdBy.startsWith("usr-") ? createdBy : "") ||
          ""
        ).trim();
        const createdByName = rawCreatedByName || "ผู้ดูแลระบบ (Admin)";
        const rawStatus = String(doc.status || meta.status || "PENDING").trim().toUpperCase();
        let status: TransferHistoryRecord["status"] = "PENDING";

        if (
          rawStatus === "CANCELLED" ||
          rawStatus === "CANCEL" ||
          rawStatus === "CANCELED" ||
          rawStatus === "REJECTED" ||
          rawStatus === "VOID" ||
          rawStatus === "ยกเลิก" ||
          rawStatus === "ปฏิเสธ" ||
          meta.current_step_text?.includes("ยกเลิก")
        ) {
          status = "CANCELLED";
        } else if (
          rawStatus === "COMPLETED" ||
          rawStatus === "APPROVED" ||
          rawStatus === "DONE" ||
          rawStatus === "SUCCESS" ||
          rawStatus === "สำเร็จ" ||
          isTransferCompleted(docId) ||
          isTransferCompleted(doc.document_no)
        ) {
          status = "COMPLETED";
        } else if (
          rawStatus === "WAITING_APPROVAL" ||
          rawStatus === "WAITING" ||
          rawStatus === "รออนุมัติ"
        ) {
          status = "WAITING_APPROVAL";
        } else {
          status = "PENDING";
        }

        const item: TransferHistoryRecord = {
          id: docId,
          doc_no: doc.document_no || docId,
          reference_no: doc.reference_no || meta.reference_no || "-",
          barcode: barcode !== "-" && barcode.trim() ? barcode.trim() : (sku !== "-" ? sku : "-"),
          sku: sku,
          product_id: rawProdId || matchedProduct?.product_id || "",
          product_name: getDisplayProductName({ product_name: productName, note: doc.note, sku }),
          from_warehouse_id: fromWhId,
          from_warehouse_name: fromWhName,
          to_warehouse_id: toWhId,
          to_warehouse_name: toWhName,
          qty: qty,
          base_unit: baseUnit,
          created_by: createdBy || "admin",
          created_by_name: createdByName,
          moved_by: movedBy,
          assigned_to_name: String(meta.assigned_to_name || doc.assigned_to_name || movedBy).trim(),
          assigned_to_user_id: String(meta.assigned_to_user_id || doc.assigned_to_user_id || "").trim(),
          status: status,
          created_at: String(doc.created_at || new Date().toISOString()),
          document_date: doc.document_date || meta.document_date || String(doc.created_at || "").slice(0, 10),
          from_location_id: meta.from_location_id || undefined,
          to_location_id: meta.to_location_id || undefined,
          source_allocations: meta.source_allocations || undefined,
          note: doc.note,
          original_note:
            meta.original_note && !meta.original_note.includes("{") && !meta.original_note.includes('"""') && !meta.original_note.includes("from_warehouse_id")
              ? meta.original_note
              : typeof doc.note === "string" && !doc.note.trim().startsWith("{") && !doc.note.includes('"""') && !doc.note.includes("from_warehouse_id")
              ? doc.note.trim()
              : undefined,
        };

        recordMap.set(docId.toLowerCase(), item);
        if (doc.document_no) {
          recordMap.set(doc.document_no.toLowerCase(), item);
        }
      }

      // B. Merge local storage transfer notifications (ONLY for un-synced/optimistic items)
      for (const notif of localNotifs) {
        if (!notif || !notif.id) continue;
        const key = notif.id.toLowerCase();
        const docNoKey = notif.doc_no ? notif.doc_no.toLowerCase() : "";
        const existing = recordMap.get(key) || (docNoKey ? recordMap.get(docNoKey) : undefined);


        // Server record already exists -> Never let stale/dummy localStorage overwrite valid server data
        if (existing) {
          if (notif.status === "COMPLETED" && existing.status !== "COMPLETED") {
            existing.status = "COMPLETED";
          }
          if (notif.moved_by && notif.moved_by !== "-" && notif.moved_by !== "พนักงาน" && (!existing.moved_by || existing.moved_by === "-")) {
            existing.moved_by = notif.moved_by;
          }
          // Merge product info จาก localStorage เมื่อ server record มีข้อมูลไม่ครบ
          // (เกิดขึ้นเมื่อ note metadata parse ไม่ได้ หรือ document ถูกสร้างโดยไม่มี product info ใน note)
          const isPlaceholderName =
            !existing.product_name ||
            existing.product_name === "รายการเบิกสินค้า" ||
            existing.product_name === "รายการย้ายสินค้า";
          if (
            notif.product_name &&
            notif.product_name !== "รายการย้ายสินค้า" &&
            notif.product_name !== "รายการเบิกสินค้า" &&
            isPlaceholderName
          ) {
            existing.product_name = notif.product_name;
          }
          if (notif.sku && notif.sku !== "-" && (!existing.sku || existing.sku === "-")) {
            existing.sku = notif.sku;
          }
          if (notif.barcode && notif.barcode !== "-" && (!existing.barcode || existing.barcode === "-" || existing.barcode === existing.sku)) {
            existing.barcode = notif.barcode;
          }
          if (notif.qty && notif.qty > 0 && (!existing.qty || existing.qty <= 0)) {
            existing.qty = notif.qty;
          }
          if (notif.assigned_to_name && notif.assigned_to_name !== "-" && (!existing.assigned_to_name || existing.assigned_to_name === "-")) {
            existing.assigned_to_name = notif.assigned_to_name;
          }
          continue;
        }


        const rawProdId = notif.product_id || "";
        const rawSku = notif.sku || (rawProdId.startsWith("prod-") ? rawProdId.replace(/^prod-/, "") : "");
        const rawBarcode = notif.barcode || "";

        const matchedProduct =
          (rawSku ? prodMapBySku.get(rawSku.toLowerCase()) : undefined) ||
          (rawProdId ? prodMapById.get(rawProdId.toLowerCase()) : undefined) ||
          (rawBarcode ? prodMapByBarcode.get(rawBarcode.toLowerCase()) : undefined);

        const sku = notif.sku || matchedProduct?.sku || "-";
        const barcode =
          notif.barcode && notif.barcode.trim() !== "-"
            ? notif.barcode.trim()
            : matchedProduct?.barcode || "-";
        const productName =
          notif.product_name ||
          matchedProduct?.product_name ||
          (sku !== "-" ? `สินค้า ${sku}` : "รายการเบิกสินค้า");
        const baseUnit = matchedProduct?.base_unit || "ชิ้น";

        const fromWhId = normalizeWarehouseId(notif.from_warehouse_id || "wh-01");
        const toWhId = normalizeWarehouseId(notif.to_warehouse_id || "wh-02");
        const fromWhName = notif.from_warehouse_name || getWarehouseName(fromWhId);
        const toWhName = notif.to_warehouse_name || getWarehouseName(toWhId);

        let status = notif.status || "PENDING";
        if (isTransferCompleted(notif.id) || (notif.doc_no && isTransferCompleted(notif.doc_no))) {
          status = "COMPLETED";
        }

        const merged: TransferHistoryRecord = {
          id: notif.id,
          doc_no: notif.doc_no || notif.id,
          reference_no: "-",
          barcode: barcode !== "-" && barcode.trim() ? barcode.trim() : (sku !== "-" ? sku : "-"),
          sku: sku,
          product_id: rawProdId || matchedProduct?.product_id || "",
          product_name: getDisplayProductName({ product_name: productName, note: notif.note, sku }),
          from_warehouse_id: fromWhId,
          from_warehouse_name: fromWhName,
          to_warehouse_id: toWhId,
          to_warehouse_name: toWhName,
          qty: Number(notif.qty) || 1,
          base_unit: baseUnit,
          created_by: notif.created_by || "admin",
          created_by_name: notif.created_by_name || "ผู้ดูแลระบบ (Admin)",
          moved_by: notif.moved_by || "-",
          assigned_to_name: notif.assigned_to_name || notif.moved_by || "",
          assigned_to_user_id: notif.assigned_to_user_id || "",
          status: status,
          created_at: notif.created_at || new Date().toISOString(),
          document_date: String(notif.created_at || "").slice(0, 10),
          from_location_id: notif.from_location_id,
          to_location_id: notif.to_location_id,
          source_allocations: notif.source_allocations,
          note: notif.note,
        };

        recordMap.set(key, merged);
      }

      // 5. Unique records list sorted by newest first
      const uniqueRecords = Array.from(
        new Map(Array.from(recordMap.values()).map((r) => [r.id.toLowerCase(), r])).values()
      );

      uniqueRecords.sort((a, b) => {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.doc_no || "").localeCompare(a.doc_no || "");
      });

      // Guard: ถ้า load นี้ไม่ใช่ load ล่าสุดแล้ว (มี load ใหม่กว่ารันอยู่) → ทิ้งผลลัพธ์
      if (currentLoadId !== loadIdRef.current) return;

      // Guard: อย่า overwrite ข้อมูลดีด้วยผลลัพธ์ว่างจาก API failure ชั่วคราว
      setRecords((prev) => {
        if (uniqueRecords.length === 0 && prev.length > 0) {
          return prev;
        }
        return uniqueRecords;
      });
    } catch (e) {
      console.error("[TransferHistory] Load data error:", e);
    } finally {
      if (currentLoadId === loadIdRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();

    // Debounced handler — ป้องกัน event listeners ยิง loadData ซ้ำรัวๆ
    const handleUpdate = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => loadData(), 800);
    };
    window.addEventListener("stockify-transfer-updated", handleUpdate);
    window.addEventListener("stockify-transfer-created", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    // Broadcast channel
    let syncChannel: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        syncChannel = new BroadcastChannel("stockify_transfer_sync");
        syncChannel.onmessage = handleUpdate;
      } catch {}
    }

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      window.removeEventListener("stockify-transfer-updated", handleUpdate);
      window.removeEventListener("stockify-transfer-created", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
      syncChannel?.close();
    };
  }, [loadData]);

  // Copy to clipboard helper
  const handleCopy = (text: string, label: string) => {
    if (!text || text === "-") return;
    navigator.clipboard.writeText(text);
    setCopySuccess(label);
    setTimeout(() => setCopySuccess(null), 2000);
  };

  // Filtered & Searched Data
  const filteredRecords = useMemo(() => {
    return records.filter((item) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchDocNo = item.doc_no?.toLowerCase().includes(q);
        const matchRefNo = item.reference_no?.toLowerCase().includes(q);
        const matchBarcode = item.barcode?.toLowerCase().includes(q);
        const matchSku = item.sku?.toLowerCase().includes(q);
        const matchProdName = item.product_name?.toLowerCase().includes(q);
        const matchCreatedBy = item.created_by_name?.toLowerCase().includes(q);
        const matchMovedBy = item.moved_by?.toLowerCase().includes(q) || item.assigned_to_name?.toLowerCase().includes(q);
        const matchFromWh = item.from_warehouse_name?.toLowerCase().includes(q);
        const matchToWh = item.to_warehouse_name?.toLowerCase().includes(q);

        if (!matchDocNo && !matchRefNo && !matchBarcode && !matchSku && !matchProdName && !matchCreatedBy && !matchMovedBy && !matchFromWh && !matchToWh) {
          return false;
        }
      }

      // 2. Status Filter
      if (selectedStatus !== "ALL") {
        if (selectedStatus === "COMPLETED" && item.status !== "COMPLETED") return false;
        if (selectedStatus === "WAITING_APPROVAL" && item.status !== "WAITING_APPROVAL") return false;
        if (selectedStatus === "PENDING" && item.status !== "PENDING" && item.status !== "ACKNOWLEDGED") return false;
        if (selectedStatus === "CANCELLED" && item.status !== "CANCELLED" && item.status !== "REJECTED") return false;
      }

      // 3. Source Warehouse Filter
      if (selectedFromWh !== "ALL" && item.from_warehouse_id !== selectedFromWh) {
        return false;
      }

      // 4. Destination Warehouse Filter
      if (selectedToWh !== "ALL" && item.to_warehouse_id !== selectedToWh) {
        return false;
      }

      // 5. Date Range Filter
      if (dateFrom) {
        const itemDate = (item.created_at || item.document_date || "").slice(0, 10);
        if (itemDate < dateFrom) return false;
      }
      if (dateTo) {
        const itemDate = (item.created_at || item.document_date || "").slice(0, 10);
        if (itemDate > dateTo) return false;
      }

      return true;
    });
  }, [records, searchQuery, selectedStatus, selectedFromWh, selectedToWh, dateFrom, dateTo]);

  // Statistics summaries
  const stats = useMemo(() => {
    const total = records.length;
    const totalUnits = records.reduce((acc, r) => acc + (Number(r.qty) || 0), 0);
    const completed = records.filter((r) => r.status === "COMPLETED").length;
    const waitingApproval = records.filter((r) => r.status === "WAITING_APPROVAL").length;
    const pending = records.filter((r) => r.status === "PENDING" || r.status === "ACKNOWLEDGED").length;
    const cancelled = records.filter((r) => r.status === "CANCELLED" || r.status === "REJECTED").length;

    return { total, totalUnits, completed, waitingApproval, pending, cancelled };
  }, [records]);

  // Pagination logic
  const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1;
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Reset all filters (Reset date to TODAY)
  const handleResetFilters = () => {
    const todayStr = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    setSearchQuery("");
    setSelectedStatus("ALL");
    setSelectedFromWh("ALL");
    setSelectedToWh("ALL");
    setSelectedDateRange("TODAY");
    setDateFrom(todayStr);
    setDateTo(todayStr);
    setCurrentPage(1);
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (filteredRecords.length === 0) {
      alert("ไม่มีข้อมูลสำหรับส่งออก");
      return;
    }

    const headers = [
      "ลำดับ",
      "เลขที่เอกสาร",
      "บาร์โค้ด",
      "รหัสสินค้า",
      "ชื่อสินค้า",
      "โกดังต้นทาง",
      "โกดังปลายทาง",
      "จำนวน",
      "หน่วย",
      "คนสร้าง",
      "คนเบิก",
      "สถานะ",
      "วันที่สร้าง",
    ];

    const rows = filteredRecords.map((item, index) => [
      index + 1,
      `"${item.doc_no || "-"}"`,
      `"\t${item.barcode || "-"}"`,
      `"${item.sku || "-"}"`,
      `"${(item.product_name || "-").replace(/"/g, '""')}"`,
      `"${item.from_warehouse_name || "-"}"`,
      `"${item.to_warehouse_name || "-"}"`,
      item.qty || 0,
      `"${item.base_unit || "ชิ้น"}"`,
      `"${item.created_by_name || "-"}"`,
      `"${item.moved_by || item.assigned_to_name || "-"}"`,
      `"${
        item.status === "COMPLETED"
          ? "เบิกสำเร็จ"
          : item.status === "WAITING_APPROVAL"
          ? "รออนุมัติ"
          : item.status === "CANCELLED"
          ? "ยกเลิก"
          : item.status === "REJECTED"
          ? "ปฏิเสธ"
          : "รอดำเนินการ"
      }"`,
      `"${new Date(item.created_at).toLocaleString("th-TH")}"`,
    ]);

    const csvContent =
      "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `transfer_history_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Status Badge Component
  const renderStatusBadge = (status: TransferHistoryRecord["status"]) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
            <span>เบิกสำเร็จ</span>
          </span>
        );
      case "WAITING_APPROVAL":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-300 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
            <span>รออนุมัติ</span>
          </span>
        );
      case "CANCELLED":
      case "REJECTED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
            <span>ยกเลิก</span>
          </span>
        );
      case "PENDING":
      case "ACKNOWLEDGED":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
            <span>รอดำเนินการ</span>
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-full space-y-4 sm:space-y-5">
      {/* Toast Copy Success Notification */}
      {copySuccess && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 animate-bounce">
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>คัดลอก {copySuccess} เรียบร้อย</span>
        </div>
      )}

      {/* Page Header */}
      <div className="pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
            ประวัติเบิกสินค้า
          </h1>
          <p className="text-xs text-slate-500 font-normal mt-0.5">
            บันทึกและประวัติรายการเบิก-โอนย้ายสินค้าทั้งหมดในระบบ
          </p>
        </div>
      </div>

      {/* Summary Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">รายการเบิกทั้งหมด</span>
            <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-slate-900">{stats.total.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">รายการทั้งหมดในระบบ</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">จำนวนชิ้นรวม</span>
            <div className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-indigo-600">{stats.totalUnits.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">หน่วยสินค้ารวมทั้งหมด</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">เบิกสำเร็จแล้ว</span>
            <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-emerald-600">{stats.completed.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">ตัดสต็อกและส่งมอบแล้ว</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">รออนุมัติ / กำลังเบิก</span>
            <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-amber-600">
            {(stats.waitingApproval + stats.pending).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400">
            {stats.waitingApproval > 0 ? `รออนุมัติ ${stats.waitingApproval} รายการ` : "รอดำเนินการ"}
          </div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-4">
        {/* Row 1: Search Box (Full Width) */}
        <div className="relative">
          <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>ค้นหาข้อมูล</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="ค้นหาเลขเอกสาร (TRF-...), บาร์โค้ด, รหัสสินค้า, ชื่อสินค้า, พนักงานผู้เบิก..."
              className="w-full pl-10 pr-8 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 text-xs font-medium focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-2xs"
            />
            <svg
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200/60"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Dropdowns & Date Range (4 Columns Grid) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
          {/* Status Dropdown */}
          <div className="lg:col-span-3">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">สถานะ</label>
            <ScrollableSelect
              value={selectedStatus}
              options={statusOptions}
              onChange={(val) => {
                setSelectedStatus(val);
                setCurrentPage(1);
              }}
              title="สถานะ"
            />
          </div>

          {/* From Warehouse Dropdown */}
          <div className="lg:col-span-3">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">โกดังต้นทาง</label>
            <ScrollableSelect
              value={selectedFromWh}
              options={fromWarehouseOptions}
              onChange={(val) => {
                setSelectedFromWh(val);
                setCurrentPage(1);
              }}
              title="โกดังต้นทาง"
            />
          </div>

          {/* To Warehouse Dropdown */}
          <div className="lg:col-span-3">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">โกดังปลายทาง</label>
            <ScrollableSelect
              value={selectedToWh}
              options={toWarehouseOptions}
              onChange={(val) => {
                setSelectedToWh(val);
                setCurrentPage(1);
              }}
              title="โกดังปลายทาง"
            />
          </div>

          {/* Date Range Dropdown */}
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-700">ช่วงวันที่</label>
              {(searchQuery || selectedStatus !== "ALL" || selectedFromWh !== "ALL" || selectedToWh !== "ALL" || selectedDateRange !== "TODAY") && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>
            <ScrollableSelect
              value={selectedDateRange}
              options={dateRangeOptions}
              onChange={handleDateRangeChange}
              title="ช่วงวันที่"
            />
          </div>
        </div>

        {/* Row 3: Filter Summary & Page Size */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 text-xs text-slate-500">
          <div>
            พบทั้งหมด <span className="font-bold text-slate-800">{filteredRecords.length.toLocaleString()}</span> รายการ
            {filteredRecords.length !== records.length && (
              <span className="ml-1 text-slate-400">(จากทั้งหมด {records.length.toLocaleString()} รายการ)</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span>แสดงแถวละ:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 py-0.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-9 h-9 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-semibold text-slate-600">กำลังโหลดข้อมูลประวัติการเบิกสินค้า...</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-14 px-4 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto text-slate-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="space-y-0.5 max-w-sm mx-auto">
              <h3 className="text-sm font-bold text-slate-800">ไม่พบรายการประวัติการเบิกสินค้า</h3>
              <p className="text-xs text-slate-500">
                {searchQuery || selectedStatus !== "ALL" || selectedFromWh !== "ALL" || selectedToWh !== "ALL" || dateFrom || dateTo
                  ? "ลองปรับเปลี่ยนคำค้นหาหรือตัวกรองใหม่อีกครั้ง"
                  : "ยังไม่มีประวัติการทำรายการเบิกในระบบ สามารถเริ่มสร้างใบเบิกได้ที่หน้าเบิกสินค้า"}
              </p>
            </div>
            {(searchQuery || selectedStatus !== "ALL" || selectedFromWh !== "ALL" || selectedToWh !== "ALL" || dateFrom || dateTo) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all cursor-pointer"
              >
                <span>ล้างตัวกรองทั้งหมด</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-wider">
                  <th className="py-3 px-3 text-center w-12 whitespace-nowrap">ลำดับ</th>
                  <th className="py-3 px-3.5 whitespace-nowrap min-w-[220px]">ชื่อสินค้า</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">จำนวน</th>
                  <th className="py-3 px-3 whitespace-nowrap">คนสร้าง</th>
                  <th className="py-3 px-3 whitespace-nowrap">คนเบิก</th>
                  <th className="py-3 px-3 text-center whitespace-nowrap">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {paginatedRecords.map((item, index) => {
                  const globalIndex = (currentPage - 1) * pageSize + index + 1;

                  return (
                    <tr
                      key={item.id || item.doc_no || index}
                      onClick={() => setSelectedRecord(item)}
                      className="hover:bg-slate-50/90 transition-colors cursor-pointer group"
                    >
                      {/* 1. ลำดับ */}
                      <td className="py-3 px-3 text-center text-slate-400 font-semibold font-mono text-xs">
                        {globalIndex}
                      </td>

                      {/* 2. ชื่อสินค้า */}
                      <td className="py-3 px-3.5 min-w-[200px]">
                        <div className="font-bold text-slate-900 text-xs leading-snug group-hover:text-indigo-600 transition-colors" title={item.product_name}>
                          {item.product_name || "-"}
                        </div>
                      </td>

                      {/* 3. จำนวน */}
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <span className="font-mono font-black text-slate-900 text-sm">
                          {Number(item.qty || 0).toLocaleString()}
                        </span>
                        <span className="text-slate-500 font-normal text-xs ml-1">
                          {item.base_unit || "ชิ้น"}
                        </span>
                      </td>

                      {/* 4. คนสร้าง */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-slate-700 font-medium text-xs">
                          <div className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                            {item.created_by_name?.charAt(0) || "A"}
                          </div>
                          <span className="truncate max-w-[130px]" title={item.created_by_name}>
                            {item.created_by_name || "ผู้ดูแลระบบ (Admin)"}
                          </span>
                        </div>
                      </td>

                      {/* 5. คนเบิก */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {item.moved_by && item.moved_by !== "-" && item.moved_by !== "พนักงาน" ? (
                          <div className="flex items-center gap-1.5 text-slate-800 font-semibold text-xs">
                            <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                              {item.moved_by.charAt(0)}
                            </div>
                            <span className="truncate max-w-[140px]" title={item.moved_by}>
                              {item.moved_by}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-normal text-xs">-</span>
                        )}
                      </td>

                      {/* 6. สถานะ */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {renderStatusBadge(item.status)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer with Pagination */}
        {!loading && filteredRecords.length > 0 && (
          <div className="px-3.5 py-2.5 border-t border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs">
            <div className="text-slate-500 font-medium">
              แสดง <span className="font-bold text-slate-800">{(currentPage - 1) * pageSize + 1}</span> -{" "}
              <span className="font-bold text-slate-800">{Math.min(currentPage * pageSize, filteredRecords.length)}</span> จาก{" "}
              <span className="font-bold text-slate-800">{filteredRecords.length.toLocaleString()}</span> รายการ
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handlePageChange(1)}
                disabled={currentPage === 1}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer"
                title="หน้าแรก"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer"
              >
                ก่อนหน้า
              </button>

              <span className="px-2.5 py-0.5 font-bold text-slate-800 bg-white border border-slate-200 rounded-lg text-[11px] shadow-2xs">
                หน้า {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer"
              >
                ถัดไป
              </button>
              <button
                type="button"
                onClick={() => handlePageChange(totalPages)}
                disabled={currentPage >= totalPages}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer"
                title="หน้าสุดท้าย"
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedRecord(null)}
        >
          <div
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden space-y-0 relative max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 shadow-xs">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-black text-slate-900">
                      รายละเอียดใบเบิกสินค้า
                    </h2>
                    {renderStatusBadge(selectedRecord.status)}
                  </div>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    เลขที่เอกสาร: <span className="font-bold text-indigo-700">{selectedRecord.doc_no}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center transition-all cursor-pointer shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs sm:text-sm">
              {/* Product Information Card */}
              <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200/80 space-y-2.5">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  ข้อมูลสินค้าที่เบิก
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="font-extrabold text-slate-900 text-base">
                      {selectedRecord.product_name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-600">
                      <span className="bg-white px-2 py-0.5 rounded border border-slate-200 font-bold">
                        รหัส: {selectedRecord.sku || "-"}
                      </span>
                      {selectedRecord.barcode && selectedRecord.barcode !== "-" && (
                        <span className="bg-white px-2 py-0.5 rounded border border-slate-200">
                          บาร์โค้ด: {selectedRecord.barcode}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-2xs">
                    <div className="text-[10px] text-slate-500 font-medium">จำนวนที่เบิก</div>
                    <div className="text-xl font-black text-indigo-600 font-mono">
                      {selectedRecord.qty.toLocaleString()}{" "}
                      <span className="text-xs font-normal text-slate-600">{selectedRecord.base_unit}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Warehouse Route Card */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-2.5">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  เส้นทางการโอนย้าย
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div className="p-3 rounded-xl bg-rose-50/80 border border-rose-200/80 space-y-1">
                    <div className="text-[10px] font-bold text-rose-600 uppercase">โกดังต้นทาง (เบิกออก)</div>
                    <div className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5">
                      <span>{selectedRecord.from_warehouse_name}</span>
                      <span className="text-[11px] text-rose-700 font-mono font-bold">
                        ({selectedRecord.from_warehouse_id})
                      </span>
                    </div>
                    {selectedRecord.from_location_id && (
                      <div className="text-[11px] text-slate-600 font-mono">
                        ตำแหน่ง: {selectedRecord.from_location_id}
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200/80 space-y-1">
                    <div className="text-[10px] font-bold text-emerald-600 uppercase">โกดังปลายทาง (นำเข้า)</div>
                    <div className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5">
                      <span>{selectedRecord.to_warehouse_name}</span>
                      <span className="text-[11px] text-emerald-700 font-mono font-bold">
                        ({selectedRecord.to_warehouse_id})
                      </span>
                    </div>
                    {selectedRecord.to_location_id && (
                      <div className="text-[11px] text-slate-600 font-mono">
                        ตำแหน่ง: {selectedRecord.to_location_id}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Personnel Involved */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  ผู้รับผิดชอบและวันที่ดำเนินการ
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 font-medium">ผู้สร้างใบเบิก</span>
                    <p className="font-bold text-slate-800 text-xs sm:text-sm">
                      {selectedRecord.created_by_name || "Admin"}
                    </p>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 font-medium">พนักงานผู้ไปเบิกสินค้า</span>
                    <p className="font-bold text-slate-800 text-xs sm:text-sm">
                      {selectedRecord.moved_by && selectedRecord.moved_by !== "-" && selectedRecord.moved_by !== "พนักงาน"
                        ? selectedRecord.moved_by
                        : "รอพนักงานไปเบิก"}
                    </p>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 font-medium">วันที่และเวลาบันทึก</span>
                    <p className="font-medium text-slate-700 text-xs sm:text-sm">
                      {new Date(selectedRecord.created_at).toLocaleString("th-TH")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Note / Remarks if present */}
              {selectedRecord.original_note && (
                <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200 text-xs space-y-1">
                  <div className="font-bold text-slate-700">หมายเหตุเพิ่มเติม:</div>
                  <p className="text-slate-600 leading-relaxed">{selectedRecord.original_note}</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => handleCopy(selectedRecord.doc_no, `เลขที่ ${selectedRecord.doc_no}`)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
              >
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>คัดลอกเลขเอกสาร</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
