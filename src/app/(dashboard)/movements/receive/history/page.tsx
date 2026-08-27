"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { getWarehouseName, normalizeWarehouseId } from "@/lib/warehouse-utils";

export interface ReceiveItemDetail {
  sku: string;
  location_code: string;
  barcode: string;
  product_name: string;
  qty: number;
  base_unit: string;
  warehouse_name: string;
  supplier: string;
}

export interface ReceiveHistoryRecord {
  id: string;
  document_no: string;
  reference_no: string;
  warehouse_id: string;
  warehouse_name: string;
  document_date: string;
  status: "COMPLETED" | "WAITING_APPROVAL" | "CANCELLED" | "PENDING";
  raw_status?: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  total_items: number;
  total_qty: number;
  primary_product_name: string;
  primary_sku: string;
  primary_barcode: string;
  primary_supplier: string;
  primary_location: string;
  items: ReceiveItemDetail[];
  note?: string;
}

export function formatCreatorName(name?: string, id?: string): string {
  const val = String(name || id || "").trim();
  if (!val || val === "staff" || val === "unknown" || val === "-") return "พนักงานรับสินค้า";
  const lower = val.toLowerCase();
  if (lower === "usr-admin-01" || lower === "admin" || lower.includes("admin")) {
    return "ผู้ดูแลระบบ (Admin)";
  }
  if (/^[0-9a-fA-F-]{16,}$/.test(val) || /^id-[0-9]+/.test(val) || /^usr-/.test(val)) {
    return "พนักงานรับสินค้า";
  }
  return val;
}

// Custom Scrollable Dropdown
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
        className="w-full flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200 text-slate-800 text-xs font-semibold transition-all cursor-pointer shadow-2xs focus:outline-none focus:border-emerald-500 focus:bg-white"
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
        <div className="absolute left-0 top-full mt-1 w-full min-w-[150px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-[160px] overflow-y-auto divide-y divide-slate-100 py-1">
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
                    ? "bg-emerald-50 text-emerald-700 font-bold"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <span className="text-emerald-600 text-xs font-bold ml-1.5 shrink-0">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ReceiveHistoryPage() {
  const { user } = useTabAuth();

  // Data states
  const [records, setRecords] = useState<ReceiveHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedWh, setSelectedWh] = useState<string>("ALL");
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

  // Detail Modal state
  const [selectedRecord, setSelectedRecord] = useState<ReceiveHistoryRecord | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  // Dropdown options
  const statusOptions = useMemo(
    () => [
      { value: "ALL", label: "สถานะทั้งหมด" },
      { value: "COMPLETED", label: "อนุมัติแล้ว / สำเร็จ (Approved)" },
      { value: "WAITING_APPROVAL", label: "รออนุมัติ (Pending Approval)" },
      { value: "CANCELLED", label: "ยกเลิก / ไม่อนุมัติ (Cancelled)" },
    ],
    []
  );

  const warehouseOptions = useMemo(
    () => [
      { value: "ALL", label: "โกดังทั้งหมด" },
      { value: "wh-01", label: "โกดัง 1" },
      { value: "wh-02", label: "โกดัง 2" },
      { value: "wh-03", label: "โกดัง 3" },
      { value: "wh-04", label: "โกดัง 4" },
      { value: "wh-05", label: "โกดัง 5" },
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

  // Fetch receive history records
  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const res = await fetch(`/api/movements/receive/history?_t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setRecords(json.data);
        }
      }
    } catch (e) {
      console.error("[ReceiveHistory] Load data error:", e);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    if (!text || text === "-") return;
    navigator.clipboard.writeText(text);
    setCopySuccess(label);
    setTimeout(() => setCopySuccess(null), 2500);
  };

  // Filter records
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesDoc = r.document_no.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
        const matchesSku = r.primary_sku.toLowerCase().includes(q) || r.items.some((it) => it.sku.toLowerCase().includes(q));
        const matchesName = r.primary_product_name.toLowerCase().includes(q) || r.items.some((it) => it.product_name.toLowerCase().includes(q));
        const matchesBarcode = r.primary_barcode.toLowerCase().includes(q) || r.items.some((it) => it.barcode.toLowerCase().includes(q));
        const matchesSupplier = r.primary_supplier.toLowerCase().includes(q) || r.items.some((it) => it.supplier.toLowerCase().includes(q));
        const matchesCreator =
          formatCreatorName(r.created_by_name, r.created_by).toLowerCase().includes(q) ||
          r.created_by_name.toLowerCase().includes(q) ||
          r.created_by.toLowerCase().includes(q);
        const matchesWh = r.warehouse_name.toLowerCase().includes(q);

        if (!matchesDoc && !matchesSku && !matchesName && !matchesBarcode && !matchesSupplier && !matchesCreator && !matchesWh) {
          return false;
        }
      }

      // 2. Status Filter
      if (selectedStatus !== "ALL") {
        if (selectedStatus === "COMPLETED" && r.status !== "COMPLETED") return false;
        if (selectedStatus === "WAITING_APPROVAL" && r.status !== "WAITING_APPROVAL" && r.status !== "PENDING") return false;
        if (selectedStatus === "CANCELLED" && r.status !== "CANCELLED") return false;
      }

      // 3. Warehouse Filter
      if (selectedWh !== "ALL") {
        const normSelectedWh = normalizeWarehouseId(selectedWh);
        const normDocWh = normalizeWarehouseId(r.warehouse_id || r.warehouse_name);
        if (normSelectedWh !== normDocWh && !r.warehouse_name.includes(selectedWh)) {
          return false;
        }
      }

      // 4. Date Range Filter
      if (dateFrom || dateTo) {
        const docDateStr = r.document_date || String(r.created_at || "").slice(0, 10);
        if (dateFrom && docDateStr < dateFrom) return false;
        if (dateTo && docDateStr > dateTo) return false;
      }

      return true;
    });
  }, [records, searchQuery, selectedStatus, selectedWh, dateFrom, dateTo]);

  // Overall stats
  const stats = useMemo(() => {
    let total = filteredRecords.length;
    let totalUnits = 0;
    let completed = 0;
    let waitingApproval = 0;
    let cancelled = 0;

    for (const r of filteredRecords) {
      totalUnits += Number(r.total_qty || 0);
      if (r.status === "COMPLETED") completed++;
      else if (r.status === "WAITING_APPROVAL" || r.status === "PENDING") waitingApproval++;
      else if (r.status === "CANCELLED") cancelled++;
    }

    return { total, totalUnits, completed, waitingApproval, cancelled };
  }, [filteredRecords]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span>อนุมัติแล้ว</span>
          </span>
        );
      case "WAITING_APPROVAL":
      case "PENDING":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-300 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
            <span>รออนุมัติ</span>
          </span>
        );
      case "CANCELLED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
            <span>ยกเลิก</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
            <span>{status}</span>
          </span>
        );
    }
  };

  const formatThaiDateTime = (dateStr?: string) => {
    if (!dateStr) return "-";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
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
      <div className="pb-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
            ประวัติรับสินค้าเข้าโกดัง
          </h1>
          <p className="text-xs text-slate-500 font-normal mt-0.5">
            บันทึกและประวัติรายการรับสินค้าเข้าคลังทั้งหมดในระบบ
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
          >
            <svg
              className={`w-3.5 h-3.5 text-slate-500 ${isRefreshing ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{isRefreshing ? "กำลังรีเฟรช..." : "รีเฟรช"}</span>
          </button>

          <Link
            href="/movements/receive"
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm shadow-emerald-600/30"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span>รับสินค้าเข้าใหม่</span>
          </Link>
        </div>
      </div>

      {/* Summary Statistics Cards (4 Columns) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">รายการรับเข้าทั้งหมด</span>
            <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-slate-900">{stats.total.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">รายการทั้งหมดตามตัวกรอง</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">จำนวนชิ้นรวม</span>
            <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-emerald-600">{stats.totalUnits.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">ชิ้นสินค้าที่รับเข้า</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">อนุมัติแล้ว</span>
            <div className="w-6 h-6 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-teal-600">{stats.completed.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">เพิ่มเข้าสต็อกเรียบร้อย</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">รออนุมัติ</span>
            <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-amber-600">{stats.waitingApproval.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">
            {stats.waitingApproval > 0 ? (
              <Link href="/approvals" className="text-amber-700 font-bold hover:underline">
                ไปหน้าอนุมัติ →
              </Link>
            ) : (
              "ไม่มีรายการค้าง"
            )}
          </div>
        </div>
      </div>

      {/* Search & Filters Card */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-4">
        {/* Search Box */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              placeholder="ค้นหาเลขเอกสาร (RCV-...), บาร์โค้ด, รหัสสินค้า, ชื่อสินค้า, ผู้จำหน่าย, ผู้ตรวจรับ..."
              className="w-full pl-10 pr-8 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 text-xs font-medium focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-2xs"
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

        {/* Dropdown Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          {/* Status Dropdown */}
          <div>
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

          {/* Warehouse Dropdown */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">โกดังรับเข้า</label>
            <ScrollableSelect
              value={selectedWh}
              options={warehouseOptions}
              onChange={(val) => {
                setSelectedWh(val);
                setCurrentPage(1);
              }}
              title="โกดังรับเข้า"
            />
          </div>

          {/* Date Range Preset */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">ช่วงเวลา</label>
            <ScrollableSelect
              value={selectedDateRange}
              options={dateRangeOptions}
              onChange={handleDateRangeChange}
              title="ช่วงเวลา"
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

          <div className="flex items-center gap-3">
            {(searchQuery || selectedStatus !== "ALL" || selectedWh !== "ALL" || selectedDateRange !== "TODAY") && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedStatus("ALL");
                  setSelectedWh("ALL");
                  handleDateRangeChange("TODAY");
                }}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-bold hover:underline cursor-pointer"
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Records Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <h2 className="text-sm font-extrabold text-slate-900">รายการประวัติการรับสินค้า</h2>
            <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {filteredRecords.length} รายการ
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500">กำลังโหลดข้อมูลประวัติรับสินค้า...</p>
          </div>
        ) : paginatedRecords.length === 0 ? (
          <div className="p-12 text-center space-y-2 text-slate-400">
            <span className="text-4xl">📥</span>
            <h3 className="text-sm font-bold text-slate-700">ไม่พบรายการประวัติการรับสินค้า</h3>
            <p className="text-xs text-slate-400">ลองเปลี่ยนตัวกรองหรือคำค้นหาด้านบน</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[800px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-bold">
                  <th className="py-3 px-4">เลขที่เอกสาร</th>
                  <th className="py-3 px-4">สินค้า</th>
                  <th className="py-3 px-4">โกดังรับเข้า & ตำแหน่ง</th>
                  <th className="py-3 px-4 text-right">จำนวน</th>
                  <th className="py-3 px-4">ผู้จำหน่าย</th>
                  <th className="py-3 px-4">ผู้ทำรายการ</th>
                  <th className="py-3 px-4">วันที่ / เวลา</th>
                  <th className="py-3 px-4 text-center">สถานะ</th>
                  <th className="py-3 px-4 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRecords.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors group">
                    {/* Document No */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedRecord(item)}
                        className="font-mono font-bold text-emerald-700 hover:text-emerald-900 hover:underline flex items-center gap-1.5 text-left cursor-pointer"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 group-hover:scale-125 transition-transform" />
                        {item.document_no}
                      </button>
                    </td>

                    {/* Product Name & SKU */}
                    <td className="py-3.5 px-4 max-w-[240px]">
                      <div className="font-bold text-slate-900 truncate" title={item.primary_product_name}>
                        {item.primary_product_name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                        <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded font-semibold text-slate-700">
                          {item.primary_sku}
                        </span>
                        {item.total_items > 1 && (
                          <span className="font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            +{item.total_items - 1} รายการ
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Target Warehouse & Shelf */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-bold text-slate-800 text-[11px]">{item.warehouse_name}</div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-1">
                        <span>ตำแหน่ง:</span>
                        <span className="font-semibold text-slate-700">{item.primary_location}</span>
                      </div>
                    </td>

                    {/* Qty & Unit */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <span className="font-mono font-extrabold text-slate-900 text-xs">
                        {Number(item.total_qty).toLocaleString()}
                      </span>
                      <span className="text-slate-500 font-sans ml-1 text-[11px]">ชิ้น</span>
                    </td>

                    {/* Supplier */}
                    <td className="py-3.5 px-4 whitespace-nowrap max-w-[140px]">
                      <span className="truncate block text-slate-600 text-[11px]" title={item.primary_supplier}>
                        {item.primary_supplier || "-"}
                      </span>
                    </td>

                    {/* Created By */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {(() => {
                        const displayName = formatCreatorName(item.created_by_name, item.created_by);
                        return (
                          <div className="flex items-center gap-1.5" title={displayName}>
                            <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-[10px] shrink-0">
                              {displayName.slice(0, 1) || "U"}
                            </div>
                            <span className="truncate max-w-[130px] text-slate-700 text-[11px] font-medium">
                              {displayName}
                            </span>
                          </div>
                        );
                      })()}
                    </td>

                    {/* Date / Time */}
                    <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap text-[11px]">
                      {formatThaiDateTime(item.created_at)}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      {renderStatusBadge(item.status)}
                    </td>

                    {/* Action */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedRecord(item)}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 text-[11px] font-bold transition-colors cursor-pointer"
                      >
                        ดูข้อมูล
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {!loading && filteredRecords.length > 0 && (
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span>แสดง</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 font-semibold focus:outline-none focus:border-emerald-500"
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>รายการต่อหน้า (ทั้งหมด {filteredRecords.length} รายการ)</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
              >
                ← ก่อนหน้า
              </button>

              <span className="px-3 py-1.5 font-bold text-slate-800">
                {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
              >
                ถัดไป →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90dvh] overflow-y-auto space-y-5 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <h3 className="text-base font-extrabold text-slate-900">
                    รายละเอียดเอกสารรับสินค้า
                  </h3>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono text-sm font-bold text-emerald-700">
                    {selectedRecord.document_no}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedRecord.document_no, "เลขเอกสาร")}
                    className="text-[11px] text-slate-500 hover:text-emerald-700 underline font-semibold cursor-pointer"
                  >
                    คัดลอก
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {renderStatusBadge(selectedRecord.status)}
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 font-bold transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Document Info Meta Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200/80 text-xs">
              <div>
                <span className="text-slate-500 font-medium">โกดังรับเข้า:</span>
                <p className="font-bold text-slate-900 mt-0.5">{selectedRecord.warehouse_name}</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">วันที่เอกสาร:</span>
                <p className="font-bold text-slate-900 mt-0.5">{selectedRecord.document_date}</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">ผู้ทำรายการ:</span>
                <p className="font-bold text-slate-900 mt-0.5">
                  {formatCreatorName(selectedRecord.created_by_name, selectedRecord.created_by)}
                </p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">เวลารับเข้า:</span>
                <p className="font-bold text-slate-900 mt-0.5">{formatThaiDateTime(selectedRecord.created_at)}</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">จำนวนรายการ:</span>
                <p className="font-bold text-slate-900 mt-0.5">{selectedRecord.items.length} รายการ</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">จำนวนชิ้นรวม:</span>
                <p className="font-extrabold text-emerald-600 mt-0.5">
                  {Number(selectedRecord.total_qty).toLocaleString()} ชิ้น
                </p>
              </div>
            </div>

            {/* Line Items Table inside modal */}
            <div>
              <h4 className="text-xs font-extrabold text-slate-900 mb-2.5">
                รายการสินค้าในเอกสาร ({selectedRecord.items.length} รายการ)
              </h4>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                      <th className="py-2.5 px-3">รหัสสินค้า / บาร์โค้ด</th>
                      <th className="py-2.5 px-3">ชื่อสินค้า</th>
                      <th className="py-2.5 px-3">ตำแหน่งชั้น</th>
                      <th className="py-2.5 px-3">ผู้จำหน่าย</th>
                      <th className="py-2.5 px-3 text-right">จำนวน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedRecord.items.map((it, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono">
                          <div className="font-bold text-slate-800">{it.sku}</div>
                          {it.barcode && it.barcode !== "-" && it.barcode !== it.sku && (
                            <div className="text-[10px] text-slate-400">{it.barcode}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          {it.product_name}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-700">
                          {it.location_code}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {it.supplier || "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {Number(it.qty).toLocaleString()} {it.base_unit || "ชิ้น"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedRecord.note && (
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
                <span className="font-bold">หมายเหตุ:</span> {selectedRecord.note}
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                พิมพ์เอกสาร
              </button>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
