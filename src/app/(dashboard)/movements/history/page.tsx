"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { MovementWithDetails } from "@/types/models";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";
import { useEscapeKey } from "@/hooks/use-escape-key";

const movTypeLabel: Record<string, string> = {
  RECEIVE: "รับเข้า",
  ISSUE: "เบิกออก",
  MOVE_OUT: "ย้ายออก",
  MOVE_IN: "ย้ายเข้า",
  TRANSFER_OUT: "โอนออก",
  TRANSFER_IN: "โอนเข้า",
  ADJUST: "ปรับยอด",
  OPENING: "เปิดยอด",
  REVERSAL: "กลับยอด",
};

const FETCH_LIMIT = 100;
const MAX_FETCH_PAGES = 30;

function formatCreatorName(name?: string, id?: string): string {
  const val = String(name || id || "").trim();
  if (!val || val === "staff" || val === "unknown" || val === "-") return "พนักงานคลัง";
  const lower = val.toLowerCase();
  if (lower === "usr-admin-01" || lower === "admin" || lower.includes("admin")) {
    return "ผู้ดูแลระบบ (Admin)";
  }
  if (/^[0-9a-fA-F-]{16,}$/.test(val) || /^id-[0-9]+/.test(val) || /^usr-/.test(val)) {
    return "พนักงานคลัง";
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
        className="w-full flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-[#E8ECEA] text-slate-800 text-sm font-semibold transition-all cursor-pointer shadow-2xs focus:outline-none focus:border-[#0F5C3F] focus:bg-white"
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
        <div className="absolute left-0 top-full mt-1 w-full min-w-[150px] bg-white border border-[#E8ECEA] rounded-xl shadow-xl z-50 max-h-[160px] overflow-y-auto divide-y divide-[#EEF1EF] py-1">
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
                className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? "bg-[#EAF2EE] text-[#053425] font-bold"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <span className="text-[#06402B] text-sm font-bold ml-1.5 shrink-0">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  // Data states
  const [movements, setMovements] = useState<MovementWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("ALL");
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
  const [selectedRecord, setSelectedRecord] = useState<MovementWithDetails | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  useEscapeKey(!!selectedRecord, () => setSelectedRecord(null));

  // Dropdown options
  const typeOptions = useMemo(
    () => [
      { value: "ALL", label: "ประเภททั้งหมด" },
      ...Object.entries(movTypeLabel).map(([value, label]) => ({ value, label })),
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

  // Fetch movement ledger (loop pages until all rows are loaded)
  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const all: MovementWithDetails[] = [];
      let total = Infinity;
      let page = 1;

      while (all.length < total && page <= MAX_FETCH_PAGES) {
        const res = await fetch(`/api/movements?page=${page}&limit=${FETCH_LIMIT}`, { cache: "no-store" });
        if (!res.ok) break;
        const json = await res.json();
        if (!json.success || !Array.isArray(json.data?.data)) break;
        total = Number(json.data.total ?? 0);
        all.push(...json.data.data);
        if (json.data.data.length < FETCH_LIMIT) break;
        page++;
      }

      all.sort((a, b) => {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.document_no || "").localeCompare(a.document_no || "");
      });

      setMovements(all);
    } catch (e) {
      console.error("[MovementHistory] Load data error:", e);
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
    return movements.filter((m) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesDoc = (m.document_no || "").toLowerCase().includes(q);
        const matchesSku = (m.sku || "").toLowerCase().includes(q);
        const matchesName = (m.product_name || "").toLowerCase().includes(q);
        const matchesLocation = (m.location_code || "").toLowerCase().includes(q);
        const matchesWh = (m.warehouse_name || "").toLowerCase().includes(q);
        const matchesCreator =
          formatCreatorName(m.created_by_name, m.created_by).toLowerCase().includes(q) ||
          (m.created_by_name || "").toLowerCase().includes(q) ||
          (m.created_by || "").toLowerCase().includes(q);

        if (!matchesDoc && !matchesSku && !matchesName && !matchesLocation && !matchesWh && !matchesCreator) {
          return false;
        }
      }

      // 2. Movement Type Filter
      if (selectedType !== "ALL" && m.movement_type !== selectedType) return false;

      // 3. Warehouse Filter
      if (selectedWh !== "ALL") {
        const normSelectedWh = normalizeWarehouseId(selectedWh);
        const normDocWh = normalizeWarehouseId(m.warehouse_id || m.warehouse_name);
        if (normSelectedWh !== normDocWh && !(m.warehouse_name || "").includes(selectedWh)) {
          return false;
        }
      }

      // 4. Date Range Filter
      if (dateFrom || dateTo) {
        const rowDateStr = String(m.created_at || "").slice(0, 10);
        if (dateFrom && rowDateStr < dateFrom) return false;
        if (dateTo && rowDateStr > dateTo) return false;
      }

      return true;
    });
  }, [movements, searchQuery, selectedType, selectedWh, dateFrom, dateTo]);

  // Overall stats
  const stats = useMemo(() => {
    let total = filteredRecords.length;
    let qtyIn = 0;
    let qtyOut = 0;

    for (const m of filteredRecords) {
      const qty = Number(m.qty_change || 0);
      if (qty > 0) qtyIn += qty;
      else if (qty < 0) qtyOut += Math.abs(qty);
    }

    return { total, qtyIn, qtyOut, net: qtyIn - qtyOut };
  }, [filteredRecords]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  const renderTypeBadge = (type: string, qtyChange: number) => {
    const isIn = qtyChange > 0 || type === "RECEIVE" || type === "MOVE_IN" || type === "TRANSFER_IN" || type === "OPENING";
    const label = movTypeLabel[type] ?? type;
    if (type === "ADJUST" || type === "REVERSAL") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-[#E8ECEA] whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
          <span>{label}</span>
        </span>
      );
    }
    if (isIn) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#EAF2EE] text-[#053425] border border-[#C9DFD4] whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0F5C3F] shrink-0" />
          <span>{label}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
        <span>{label}</span>
      </span>
    );
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
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 animate-bounce">
          <svg className="w-4 h-4 text-[#5B8A74]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>คัดลอก {copySuccess} เรียบร้อย</span>
        </div>
      )}

      {/* Top Action Row */}
      <div className="flex items-center justify-end gap-2 pb-1">
        <button
          type="button"
          onClick={() => loadData(true)}
          disabled={isRefreshing}
          className="px-3 py-2 rounded-xl bg-white border border-[#E8ECEA] text-slate-700 hover:bg-slate-50 text-sm font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
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
      </div>

      {/* Summary Statistics Cards (4 Columns) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="bg-white rounded-2xl p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-500">รายการทั้งหมด</span>
            <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">{stats.total.toLocaleString()}</div>
          <div className="text-xs text-slate-400">รายการทั้งหมดตามตัวกรอง</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-500">จำนวนรับเข้า</span>
            <div className="w-6 h-6 rounded-lg bg-[#EAF2EE] flex items-center justify-center text-[#06402B]">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m0-16l-4 4m4-4l4 4M4 20h16" />
              </svg>
            </div>
          </div>
          <div className="text-2xl font-black text-[#06402B]">+{stats.qtyIn.toLocaleString()}</div>
          <div className="text-xs text-slate-400">ชิ้นที่เข้าคลังตามตัวกรอง</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-500">จำนวนเบิกออก</span>
            <div className="w-6 h-6 rounded-lg bg-rose-50 flex items-center justify-center text-rose-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 20V4m0 16l-4-4m4 4l4-4M4 4h16" />
              </svg>
            </div>
          </div>
          <div className="text-2xl font-black text-rose-600">−{stats.qtyOut.toLocaleString()}</div>
          <div className="text-xs text-slate-400">ชิ้นที่ออกจากคลังตามตัวกรอง</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-500">ยอดเปลี่ยนแปลงสุทธิ</span>
            <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l18 8-18 8 4-8-4-8z" />
              </svg>
            </div>
          </div>
          <div className={`text-2xl font-black ${stats.net >= 0 ? "text-[#06402B]" : "text-rose-600"}`}>
            {stats.net >= 0 ? "+" : "−"}{Math.abs(stats.net).toLocaleString()}
          </div>
          <div className="text-xs text-slate-400">รับเข้า − เบิกออก</div>
        </div>
      </div>

      {/* Search & Filters Card */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E8ECEA] shadow-xs space-y-4">
        {/* Search Box */}
        <div>
          <label htmlFor="mov-hist-search" className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-[#06402B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>ค้นหาข้อมูล</span>
          </label>
          <div className="relative">
            <input
              id="mov-hist-search"
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="ค้นหาเลขเอกสาร (RCV/ISS/TRF-...), รหัสสินค้า, ชื่อสินค้า, ตำแหน่ง, ผู้ทำรายการ..."
              className="w-full pl-10 pr-8 py-2.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-slate-800 placeholder-slate-400 text-sm font-medium focus:outline-none focus:border-[#0F5C3F] focus:bg-white focus:ring-2 focus:ring-[#0F5C3F]/20 transition-all shadow-2xs"
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
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200/60 cursor-pointer"
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
          {/* Movement Type Dropdown */}
          <div>
            <div className="block text-sm font-bold text-slate-700 mb-1.5">ประเภทการเคลื่อนไหว</div>
            <ScrollableSelect
              value={selectedType}
              options={typeOptions}
              onChange={(val) => {
                setSelectedType(val);
                setCurrentPage(1);
              }}
              title="ประเภทการเคลื่อนไหว"
            />
          </div>

          {/* Warehouse Dropdown */}
          <div>
            <div className="block text-sm font-bold text-slate-700 mb-1.5">โกดัง</div>
            <ScrollableSelect
              value={selectedWh}
              options={warehouseOptions}
              onChange={(val) => {
                setSelectedWh(val);
                setCurrentPage(1);
              }}
              title="โกดัง"
            />
          </div>

          {/* Date Range Preset */}
          <div>
            <div className="block text-sm font-bold text-slate-700 mb-1.5">ช่วงเวลา</div>
            <ScrollableSelect
              value={selectedDateRange}
              options={dateRangeOptions}
              onChange={handleDateRangeChange}
              title="ช่วงเวลา"
            />
          </div>
        </div>

        {/* Row 3: Filter Summary */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#EEF1EF] text-sm text-slate-500">
          <div>
            พบทั้งหมด <span className="font-bold text-slate-800">{filteredRecords.length.toLocaleString()}</span> รายการ
            {filteredRecords.length !== movements.length && (
              <span className="ml-1 text-slate-400">(จากทั้งหมด {movements.length.toLocaleString()} รายการ)</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {(searchQuery || selectedType !== "ALL" || selectedWh !== "ALL" || selectedDateRange !== "TODAY") && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedType("ALL");
                  setSelectedWh("ALL");
                  handleDateRangeChange("TODAY");
                }}
                className="text-sm text-[#06402B] hover:text-[#053425] font-bold hover:underline cursor-pointer"
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Records Table Card */}
      <div className="bg-white rounded-2xl border border-[#E8ECEA] shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[#EEF1EF] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
            <h2 className="text-base font-extrabold text-slate-900">รายการประวัติการเคลื่อนไหว</h2>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {filteredRecords.length} รายการ
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-500">กำลังโหลดข้อมูลประวัติการเคลื่อนไหว...</p>
          </div>
        ) : paginatedRecords.length === 0 ? (
          <div className="p-12 text-center space-y-2 text-slate-400">
            <span className="text-4xl">🔄</span>
            <h3 className="text-base font-bold text-slate-700">ไม่พบรายการประวัติการเคลื่อนไหว</h3>
            <p className="text-sm text-slate-400">ลองเปลี่ยนตัวกรองหรือคำค้นหาด้านบน</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[880px]">
              <thead>
                <tr className="border-b border-[#EEF1EF] bg-slate-50/70 text-slate-500 font-bold">
                  <th className="py-3 px-4">เลขที่เอกสาร</th>
                  <th className="py-3 px-4">ประเภท</th>
                  <th className="py-3 px-4">สินค้า</th>
                  <th className="py-3 px-4">โกดัง & ตำแหน่ง</th>
                  <th className="py-3 px-4 text-right">จำนวน</th>
                  <th className="py-3 px-4">ผู้ทำรายการ</th>
                  <th className="py-3 px-4">วันที่ / เวลา</th>
                  <th className="py-3 px-4 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EF]">
                {paginatedRecords.map((item) => (
                  <tr key={item.movement_id} className="hover:bg-slate-50/70 transition-colors group">
                    {/* Document No */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedRecord(item)}
                        className="font-mono font-bold text-[#053425] hover:text-[#04231A] hover:underline flex items-center gap-1.5 text-left cursor-pointer"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#0F5C3F] group-hover:scale-125 transition-transform" />
                        {item.document_no}
                      </button>
                    </td>

                    {/* Movement Type */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {renderTypeBadge(item.movement_type, Number(item.qty_change || 0))}
                    </td>

                    {/* Product Name & SKU */}
                    <td className="py-3.5 px-4 max-w-[240px]">
                      <div className="font-bold text-slate-900 truncate" title={item.product_name}>
                        {item.product_name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                        <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded font-semibold text-slate-700">
                          {item.sku}
                        </span>
                      </div>
                    </td>

                    {/* Warehouse & Location */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-bold text-slate-800 text-xs">{item.warehouse_name}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5 flex items-center gap-1">
                        <span>ตำแหน่ง:</span>
                        <span className="font-semibold text-slate-700">{item.location_code || "-"}</span>
                      </div>
                    </td>

                    {/* Qty */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <span
                        className={`font-mono font-extrabold text-sm ${
                          Number(item.qty_change) > 0 ? "text-[#06402B]" : "text-rose-600"
                        }`}
                      >
                        {Number(item.qty_change) > 0 ? "+" : "−"}
                        {Math.abs(Number(item.qty_change || 0)).toLocaleString()}
                      </span>
                    </td>

                    {/* Created By */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {(() => {
                        const displayName = formatCreatorName(item.created_by_name, item.created_by);
                        return (
                          <div className="flex items-center gap-1.5" title={displayName}>
                            <div className="w-5 h-5 rounded-full bg-[#DFEDE6] text-[#052B1F] flex items-center justify-center font-bold text-[11px] shrink-0">
                              {displayName.slice(0, 1) || "U"}
                            </div>
                            <span className="truncate max-w-[130px] text-slate-700 text-xs font-medium">
                              {displayName}
                            </span>
                          </div>
                        );
                      })()}
                    </td>

                    {/* Date / Time */}
                    <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap text-xs">
                      {formatThaiDateTime(item.created_at)}
                    </td>

                    {/* Action */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedRecord(item)}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-[#EAF2EE] hover:text-[#053425] text-slate-600 text-xs font-bold transition-colors cursor-pointer"
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
          <div className="p-4 border-t border-[#EEF1EF] flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-600">
            <div className="flex items-center gap-2">
              <span>แสดง</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 rounded-lg border border-[#E8ECEA] bg-slate-50 font-semibold focus:outline-none focus:border-[#0F5C3F]"
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
                className="px-3 py-1.5 rounded-lg border border-[#E8ECEA] bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
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
                className="px-3 py-1.5 rounded-lg border border-[#E8ECEA] bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
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
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-[#E8ECEA] max-h-[90dvh] overflow-y-auto space-y-5 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-[#EEF1EF]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
                  <h3 className="text-lg font-extrabold text-slate-900">
                    รายละเอียดการเคลื่อนไหวสินค้า
                  </h3>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono text-base font-bold text-[#053425]">
                    {selectedRecord.document_no}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedRecord.document_no, "เลขเอกสาร")}
                    className="text-xs text-slate-500 hover:text-[#053425] underline font-semibold cursor-pointer"
                  >
                    คัดลอก
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {renderTypeBadge(selectedRecord.movement_type, Number(selectedRecord.qty_change || 0))}
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 font-bold transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Movement Info Meta Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-2xl border border-[#E8ECEA]/80 text-sm">
              <div>
                <span className="text-slate-500 font-medium">ประเภท:</span>
                <p className="font-bold text-slate-900 mt-0.5">
                  {movTypeLabel[selectedRecord.movement_type] ?? selectedRecord.movement_type}
                </p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">โกดัง:</span>
                <p className="font-bold text-slate-900 mt-0.5">{selectedRecord.warehouse_name}</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">ตำแหน่ง:</span>
                <p className="font-bold text-slate-900 mt-0.5 font-mono">{selectedRecord.location_code || "-"}</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">รหัสสินค้า:</span>
                <p className="font-bold text-slate-900 mt-0.5 font-mono">{selectedRecord.sku}</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">ผู้ทำรายการ:</span>
                <p className="font-bold text-slate-900 mt-0.5">
                  {formatCreatorName(selectedRecord.created_by_name, selectedRecord.created_by)}
                </p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">วันที่ / เวลา:</span>
                <p className="font-bold text-slate-900 mt-0.5">{formatThaiDateTime(selectedRecord.created_at)}</p>
              </div>
            </div>

            {/* Product & Qty Summary */}
            <div>
              <h4 className="text-sm font-extrabold text-slate-900 mb-2.5">ข้อมูลสินค้า</h4>
              <div className="border border-[#E8ECEA] rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold border-b border-[#E8ECEA]">
                      <th className="py-2.5 px-3">รหัสสินค้า</th>
                      <th className="py-2.5 px-3">ชื่อสินค้า</th>
                      <th className="py-2.5 px-3 text-right">จำนวนเปลี่ยนแปลง</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1EF]">
                    <tr className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{selectedRecord.sku}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-800">{selectedRecord.product_name}</td>
                      <td className="py-2.5 px-3 text-right">
                        <span
                          className={`font-mono font-extrabold ${
                            Number(selectedRecord.qty_change) > 0 ? "text-[#06402B]" : "text-rose-600"
                          }`}
                        >
                          {Number(selectedRecord.qty_change) > 0 ? "+" : "−"}
                          {Math.abs(Number(selectedRecord.qty_change || 0)).toLocaleString()} ชิ้น
                        </span>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {Number(selectedRecord.qty_change) > 0 ? "เข้าคลัง" : "ออกจากคลัง"}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EEF1EF]">
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold transition-colors cursor-pointer"
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
