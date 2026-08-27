"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";

export interface ProductionMaterialItem {
  rm_sku: string;
  rm_barcode?: string;
  rm_name: string;
  rm_wh: string;
  rm_qty_required: number;
  rm_unit: string;
  waste_percentage?: number;
  note?: string;
}

export interface ProductionOrderItem {
  fg_sku: string;
  fg_barcode: string;
  fg_name: string;
  fg_unit: string;
  quantity: number;
  image?: string;
  target_warehouse_id: string;
  target_warehouse_name: string;
  materials: ProductionMaterialItem[];
}

export interface ProductionOrderRecord {
  id: string;
  order_no: string;
  document_id: string;
  reference_no?: string;
  status: "COMPLETED" | "IN_PROGRESS" | "PENDING" | "CANCELLED";
  items: ProductionOrderItem[];
  total_fg_qty: number;
  total_materials_count: number;
  created_by: string;
  created_by_name: string;
  created_at: string;
  document_date: string;
  note?: string;
}

const currentYearNum = new Date().getFullYear();

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => {
  const d = String(i + 1).padStart(2, "0");
  return { value: d, label: String(i + 1) };
});

const MONTH_OPTIONS = [
  { value: "01", label: "ม.ค." },
  { value: "02", label: "ก.พ." },
  { value: "03", label: "มี.ค." },
  { value: "04", label: "เม.ย." },
  { value: "05", label: "พ.ค." },
  { value: "06", label: "มิ.ย." },
  { value: "07", label: "ก.ค." },
  { value: "08", label: "ส.ค." },
  { value: "09", label: "ก.ย." },
  { value: "10", label: "ต.ค." },
  { value: "11", label: "พ.ย." },
  { value: "12", label: "ธ.ค." },
];

const YEAR_OPTIONS = [
  { value: String(currentYearNum + 1), label: String(currentYearNum + 1 + 543) },
  { value: String(currentYearNum), label: String(currentYearNum + 543) },
  { value: String(currentYearNum - 1), label: String(currentYearNum - 1 + 543) },
  { value: String(currentYearNum - 2), label: String(currentYearNum - 2 + 543) },
  { value: String(currentYearNum - 3), label: String(currentYearNum - 3 + 543) },
];

const getTodayDateParts = () => {
  const d = new Date();
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: String(d.getMonth() + 1).padStart(2, "0"),
    year: String(d.getFullYear()),
  };
};

// Custom Dropdown showing ~4 items at a time with smooth scroll
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
        className="w-full flex items-center justify-between gap-1 px-2.5 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-900 text-xs font-bold transition-all cursor-pointer shadow-2xs focus:outline-hidden focus:border-emerald-500 focus:bg-white"
      >
        <span className="truncate">{currentOption ? currentOption.label : value}</span>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-full min-w-[72px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-[144px] overflow-y-auto divide-y divide-slate-100 py-0.5">
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
                className={`w-full text-left px-2.5 py-2 text-xs font-bold transition-colors cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? "bg-emerald-50 text-emerald-700 font-black"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && <span className="text-emerald-600 text-[11px]">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ProductionHistoryPage() {
  const { user } = useTabAuth();

  // Data states
  const [orders, setOrders] = useState<ProductionOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // Date Dropdown states (Default to Today)
  const [selectedDay, setSelectedDay] = useState<string>(() => getTodayDateParts().day);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getTodayDateParts().month);
  const [selectedYear, setSelectedYear] = useState<string>(() => getTodayDateParts().year);

  const selectedDate = useMemo(() => {
    if (!selectedYear || !selectedMonth || !selectedDay) return "";
    return `${selectedYear}-${selectedMonth}-${selectedDay}`;
  }, [selectedYear, selectedMonth, selectedDay]);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Detail Modal state
  const [selectedOrder, setSelectedOrder] = useState<ProductionOrderRecord | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const loadIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch production orders
  const loadData = useCallback(async (showRefreshing = false) => {
    const currentLoadId = ++loadIdRef.current;
    if (showRefreshing) setIsRefreshing(true);

    try {
      const storedToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("stockify_tab_token") || localStorage.getItem("stockify_tab_token")
          : null;

      const headers: Record<string, string> = {};
      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      const res = await fetch(`/api/production/orders?_t=${Date.now()}`, {
        headers,
        cache: "no-store",
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          if (currentLoadId === loadIdRef.current) {
            setOrders(json.data);
          }
        }
      }
    } catch (err) {
      console.warn("[ProductionHistory] Fetch error:", err);
    } finally {
      if (currentLoadId === loadIdRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();

    const handleUpdate = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => loadData(), 500);
    };

    window.addEventListener("stockify-production-created", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      window.removeEventListener("stockify-production-created", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [loadData]);

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    if (!text || text === "-") return;
    navigator.clipboard.writeText(text);
    setCopySuccess(label);
    setTimeout(() => setCopySuccess(null), 2000);
  };

  // Update Status action
  const handleUpdateStatus = async (orderNo: string, newStatus: ProductionOrderRecord["status"]) => {
    setIsUpdatingStatus(true);
    try {
      const storedToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("stockify_tab_token") || localStorage.getItem("stockify_tab_token")
          : null;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      const res = await fetch("/api/production/orders", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ order_no: orderNo, status: newStatus }),
      });

      if (res.ok) {
        setOrders((prev) =>
          prev.map((o) => (o.order_no === orderNo ? { ...o, status: newStatus } : o))
        );
        if (selectedOrder && selectedOrder.order_no === orderNo) {
          setSelectedOrder((prev) => (prev ? { ...prev, status: newStatus } : null));
        }
      }
    } catch (e) {
      console.error("Failed to update status:", e);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Filtered orders
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchOrderNo = order.order_no?.toLowerCase().includes(q);
        const matchCreator = order.created_by_name?.toLowerCase().includes(q);
        const matchItems = order.items?.some(
          (item) =>
            item.fg_sku?.toLowerCase().includes(q) ||
            item.fg_name?.toLowerCase().includes(q) ||
            item.fg_barcode?.includes(q) ||
            item.materials?.some(
              (m) =>
                m.rm_sku?.toLowerCase().includes(q) ||
                m.rm_name?.toLowerCase().includes(q)
            )
        );

        if (!matchOrderNo && !matchCreator && !matchItems) {
          return false;
        }
      }

      // 2. Status Filter
      if (selectedStatus !== "ALL") {
        if (order.status !== selectedStatus) return false;
      }

      // 3. Single Date Filter
      if (selectedDate) {
        const itemDate = (order.created_at || order.document_date || "").slice(0, 10);
        if (itemDate !== selectedDate) return false;
      }

      return true;
    });
  }, [orders, searchQuery, selectedStatus, selectedDate]);

  // Statistics
  const stats = useMemo(() => {
    const total = orders.length;
    const totalUnits = orders.reduce((sum, o) => sum + (Number(o.total_fg_qty) || 0), 0);
    const completed = orders.filter((o) => o.status === "COMPLETED").length;
    const inProgress = orders.filter((o) => o.status === "IN_PROGRESS" || o.status === "PENDING").length;
    const cancelled = orders.filter((o) => o.status === "CANCELLED").length;

    return { total, totalUnits, completed, inProgress, cancelled };
  }, [orders]);

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / pageSize) || 1;
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredOrders.slice(start, start + pageSize);
  }, [filteredOrders, currentPage, pageSize]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    setSearchQuery("");
    setSelectedStatus("ALL");
    const t = getTodayDateParts();
    setSelectedDay(t.day);
    setSelectedMonth(t.month);
    setSelectedYear(t.year);
    setCurrentPage(1);
  };

  // Export CSV
  const handleExportCSV = () => {
    if (filteredOrders.length === 0) {
      alert("ไม่มีข้อมูลสำหรับส่งออก");
      return;
    }

    const headers = [
      "ลำดับ",
      "เลขที่คำสั่งผลิต",
      "วันที่สั่งผลิต",
      "รายการสินค้าสำเร็จรูป",
      "จำนวนผลิตรวม",
      "คลังปลายทาง",
      "ผู้สั่งผลิต",
      "สถานะ",
    ];

    const rows = filteredOrders.map((order, index) => {
      const fgList = order.items
        .map((i) => `${i.fg_sku} (${i.fg_name}) x ${i.quantity} ${i.fg_unit}`)
        .join("; ");

      return [
        index + 1,
        `"${order.order_no}"`,
        `"${new Date(order.created_at).toLocaleString("th-TH")}"`,
        `"${fgList.replace(/"/g, '""')}"`,
        order.total_fg_qty,
        `"โกดัง 2 (สินค้าสำเร็จรูป)"`,
        `"${order.created_by_name || "Admin"}"`,
        `"${
          order.status === "COMPLETED"
            ? "ผลิตเสร็จสมบูรณ์"
            : order.status === "IN_PROGRESS"
            ? "กำลังดำเนินการผลิต"
            : order.status === "CANCELLED"
            ? "ยกเลิกคำสั่งผลิต"
            : "รอดำเนินการ"
        }"`,
      ];
    });

    const csvContent =
      "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `production_history_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Status Badge Helper
  const renderStatusBadge = (status: ProductionOrderRecord["status"]) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
            <span>เสร็จสมบูรณ์</span>
          </span>
        );
      case "IN_PROGRESS":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping shrink-0"></span>
            <span>กำลังผลิต</span>
          </span>
        );
      case "PENDING":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
            <span>รอดำเนินการ</span>
          </span>
        );
      case "CANCELLED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0"></span>
            <span>ยกเลิก</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full max-w-full space-y-6 pb-20">
      {/* Toast Notification */}
      {copySuccess && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-black flex items-center gap-2.5 animate-bounce border border-slate-700">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>คัดลอก {copySuccess} เรียบร้อยแล้ว</span>
        </div>
      )}

      {/* Page Header */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center font-bold text-xl shadow-2xs shrink-0">
            📜
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              ประวัติการสั่งผลิต
            </h1>
            <p className="text-xs sm:text-sm font-medium text-slate-500 mt-0.5">
              บันทึกและประวัติคำสั่งผลิตสินค้าสำเร็จรูปและการใช้วัตถุดิบ (BOM) ทั้งหมด
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center shrink-0">
          <Link
            href="/production"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-xs shadow-emerald-600/20 transition-all cursor-pointer active:scale-95 whitespace-nowrap"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span>สั่งผลิตสินค้าใหม่</span>
          </Link>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-bold text-slate-600">คำสั่งผลิตทั้งหมด</span>
            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 text-base">
              📋
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900">{stats.total.toLocaleString()}</div>
          <div className="text-xs text-slate-400 font-semibold">รายการคำสั่งผลิตทั้งหมด</div>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-bold text-slate-600">ยอดผลิตสำเร็จรูป</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-700 text-base">
              📦
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-indigo-600">{stats.totalUnits.toLocaleString()}</div>
          <div className="text-xs text-slate-400 font-semibold">หน่วยสินค้าสำเร็จรูปรวม</div>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-bold text-slate-600">เสร็จสมบูรณ์</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700 text-base">
              ✅
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-600">{stats.completed.toLocaleString()}</div>
          <div className="text-xs text-slate-400 font-semibold">ตัดสต็อกและเข้าคลังเรียบร้อย</div>
        </div>

        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-bold text-slate-600">กำลังดำเนินการ</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center text-amber-700 text-base">
              ⏳
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-600">{stats.inProgress.toLocaleString()}</div>
          <div className="text-xs text-slate-400 font-semibold">อยู่ระหว่างขั้นตอนการผลิต</div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-end gap-3.5">
          {/* Main Search Input */}
          <div className="flex-[2_1_260px] min-w-[240px]">
            <label className="block text-xs font-black text-slate-700 mb-1.5">ค้นหาข้อมูล</label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="เลขคำสั่งผลิต, รหัสสินค้า, ชื่อสินค้า, บาร์โค้ด, ผู้สั่งผลิต..."
                className="w-full pl-11 pr-10 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm font-bold focus:outline-hidden focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-2xs"
              />
              <svg
                className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer font-bold"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Status Filter */}
          <div className="flex-[1_1_160px] min-w-[140px]">
            <label className="block text-xs font-black text-slate-700 mb-1.5">สถานะ</label>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 text-sm font-bold focus:outline-hidden focus:border-emerald-500 focus:bg-white transition-all cursor-pointer shadow-2xs"
            >
              <option value="ALL">ทุกสถานะ</option>
              <option value="COMPLETED">เสร็จสมบูรณ์</option>
              <option value="IN_PROGRESS">กำลังผลิต</option>
              <option value="PENDING">รอดำเนินการ</option>
              <option value="CANCELLED">ยกเลิก</option>
            </select>
          </div>

          {/* วันที่ (Day / Month / Year Dropdowns) */}
          <div className="flex-[1.5_1_220px] min-w-[210px]">
            <label className="block text-xs font-black text-slate-700 mb-1.5 flex items-center justify-between">
              <span>วันที่</span>
              <button
                type="button"
                onClick={() => {
                  const t = getTodayDateParts();
                  setSelectedDay(t.day);
                  setSelectedMonth(t.month);
                  setSelectedYear(t.year);
                  setCurrentPage(1);
                }}
                className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 cursor-pointer"
                title="ตั้งเป็นวันนี้"
              >
                วันนี้
              </button>
            </label>
            <div className="flex items-center gap-1.5">
              {/* Day */}
              <ScrollableSelect
                value={selectedDay}
                options={DAY_OPTIONS}
                onChange={(val) => {
                  setSelectedDay(val);
                  setCurrentPage(1);
                }}
                title="เลือกวัน"
              />

              {/* Month */}
              <ScrollableSelect
                value={selectedMonth}
                options={MONTH_OPTIONS}
                onChange={(val) => {
                  setSelectedMonth(val);
                  setCurrentPage(1);
                }}
                title="เลือกเดือน"
              />

              {/* Year */}
              <ScrollableSelect
                value={selectedYear}
                options={YEAR_OPTIONS}
                onChange={(val) => {
                  setSelectedYear(val);
                  setCurrentPage(1);
                }}
                title="เลือกปี"
              />
            </div>
          </div>

          {/* Reset Filters */}
          {(searchQuery || selectedStatus !== "ALL") && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-4 py-2.5 rounded-xl text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-bold transition-all cursor-pointer shadow-2xs"
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </div>

      {/* Orders Table Container */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-28 text-center">
            <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-slate-600 mt-4 font-black">กำลังโหลดข้อมูลประวัติการสั่งผลิต...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-24 text-center space-y-4">
            <span className="text-5xl block">📦</span>
            <p className="text-base font-black text-slate-800">ไม่พบข้อมูลคำสั่งผลิต</p>
            <p className="text-sm text-slate-500">ลองปรับเปลี่ยนคำค้นหา หรือกดสั่งผลิตสินค้าใหม่</p>
            <Link
              href="/production"
              className="inline-block mt-2 px-5 py-2.5 rounded-2xl bg-emerald-600 text-white text-sm font-black shadow-md hover:bg-emerald-700 transition-all"
            >
              ไปยังหน้าสั่งผลิต
            </Link>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100/90 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
                    <th className="py-3 px-4 text-center w-12">#</th>
                    <th className="py-3 px-4 text-center w-20">รูปภาพ</th>
                    <th className="py-3 px-4 text-center">รหัสสินค้า</th>
                    <th className="py-3 px-4 text-left">ชื่อสินค้า</th>
                    <th className="py-3 px-4 text-center">จำนวนผลิต</th>
                    <th className="py-3 px-4 text-center">สถานะ</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 text-sm font-semibold text-slate-800">
                  {paginatedOrders.map((order, idx) => {
                    const rowNumber = (currentPage - 1) * pageSize + idx + 1;
                    const firstItem = order.items?.[0];
                    const extraItemsCount = (order.items?.length || 0) - 1;

                    return (
                      <tr
                        key={order.order_no + idx}
                        className="hover:bg-slate-50/90 transition-colors group cursor-pointer"
                        onClick={() => setSelectedOrder(order)}
                      >
                        {/* Index */}
                        <td className="py-3 px-4 text-center text-slate-400 font-mono font-bold text-xs">
                          {rowNumber}
                        </td>

                        {/* รูป (Product Image - Compact & Centered) */}
                        <td className="py-3 px-4 text-center">
                          {firstItem ? (
                            <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center p-1 mx-auto shadow-2xs group-hover:scale-105 transition-transform">
                              <img
                                src={firstItem.image || `/products/${firstItem.fg_sku}.jpg`}
                                alt={firstItem.fg_name}
                                className="w-full h-full object-contain"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = "none";
                                }}
                              />
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">-</span>
                          )}
                        </td>

                        {/* รหัสสินค้า (Product Code / SKU) */}
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {firstItem ? (
                            <div>
                              <span className="font-mono font-bold text-sm text-slate-900">
                                {firstItem.fg_sku}
                              </span>
                              {extraItemsCount > 0 && (
                                <span className="font-semibold text-[11px] text-slate-500 block mt-0.5">
                                  +{extraItemsCount} รายการ
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">-</span>
                          )}
                        </td>

                        {/* ชื่อสินค้า (Product Name) */}
                        <td className="py-3 px-4 text-left">
                          {firstItem ? (
                            <span className="font-bold text-sm text-slate-800 block max-w-sm sm:max-w-md truncate" title={firstItem.fg_name}>
                              {firstItem.fg_name}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">-</span>
                          )}
                        </td>

                        {/* จำนวนผลิต (Quantity Produced) */}
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <span className="font-mono font-bold text-sm text-slate-900">
                            {order.total_fg_qty.toLocaleString()}
                          </span>
                          <span className="text-xs font-semibold text-slate-600 ml-1">
                            {firstItem?.fg_unit || "ชิ้น"}
                          </span>
                        </td>

                        {/* สถานะ (Status) */}
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {renderStatusBadge(order.status)}
                        </td>

                        {/* Action (จัดการ) */}
                        <td className="py-3 px-4 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setSelectedOrder(order)}
                            className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 whitespace-nowrap"
                          >
                            <span className="whitespace-nowrap">ดูสูตร</span>
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="px-6 py-5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/70">
              <div className="text-sm text-slate-600 font-bold">
                แสดง {Math.min((currentPage - 1) * pageSize + 1, filteredOrders.length)} ถึง{" "}
                {Math.min(currentPage * pageSize, filteredOrders.length)} จากทั้งหมด{" "}
                <strong className="text-slate-900 font-black">{filteredOrders.length}</strong> รายการ
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => handlePageChange(currentPage - 1)}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-800 font-black text-xs sm:text-sm hover:bg-slate-100 disabled:opacity-40 cursor-pointer shadow-2xs"
                >
                  ◀ ก่อนหน้า
                </button>

                <div className="flex items-center gap-1.5">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(
                      (p) =>
                        p === 1 ||
                        p === totalPages ||
                        (p >= currentPage - 1 && p <= currentPage + 1)
                    )
                    .map((p, index, array) => {
                      const prev = array[index - 1];
                      return (
                        <React.Fragment key={p}>
                          {prev && p - prev > 1 && (
                            <span className="px-1 text-slate-400 text-sm font-bold">...</span>
                          )}
                          <button
                            type="button"
                            onClick={() => handlePageChange(p)}
                            className={`w-9 h-9 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
                              currentPage === p
                                ? "bg-emerald-600 text-white shadow-sm"
                                : "bg-white border border-slate-200 text-slate-800 hover:bg-slate-100"
                            }`}
                          >
                            {p}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => handlePageChange(currentPage + 1)}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-800 font-black text-xs sm:text-sm hover:bg-slate-100 disabled:opacity-40 cursor-pointer shadow-2xs"
                >
                  ถัดไป ▶
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Order Detail Modal with BOM Breakdown */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90dvh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-7 py-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xl shadow-xs">
                  🏭
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-lg sm:text-xl font-black text-slate-900">
                      คำสั่งผลิต: {selectedOrder.order_no}
                    </h3>
                    {renderStatusBadge(selectedOrder.status)}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500 font-bold pt-0.5">
                    วันที่สร้าง: {new Date(selectedOrder.created_at).toLocaleString("th-TH")} · ผู้สั่ง:{" "}
                    {selectedOrder.created_by_name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center font-bold text-sm transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-7 space-y-6">
              {/* Finished Goods Summary */}
              <div className="space-y-3.5">
                <h4 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <span>📦 สินค้าสำเร็จรูปที่สั่งผลิต (Finished Goods)</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {selectedOrder.items?.map((item, idx) => (
                    <div
                      key={item.fg_sku + idx}
                      className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center gap-3.5 shadow-2xs"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center p-1.5 shrink-0">
                        <img
                          src={item.image || `/products/${item.fg_sku}.jpg`}
                          alt={item.fg_name}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-xs text-emerald-800">
                            {item.fg_sku}
                          </span>
                          <span className="text-xs text-slate-400 font-mono font-bold">
                            #{item.fg_barcode}
                          </span>
                        </div>
                        <h5 className="text-sm font-black text-slate-900 truncate mt-1">
                          {item.fg_name}
                        </h5>
                        <p className="text-xs font-bold text-slate-600 mt-0.5">
                          จำนวน: <strong className="text-emerald-700 font-mono font-black text-sm">{item.quantity}</strong> {item.fg_unit} ➔ โกดัง 2
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bill of Materials (Raw Materials required) */}
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <span>🧪 รายการตัดสต็อกวัตถุดิบ (Bill of Materials)</span>
                  </h4>
                  <span className="text-xs text-slate-500 font-bold">
                    ปลายทางตัดสต็อก: โกดัง 1 (วัตถุดิบ)
                  </span>
                </div>

                <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-slate-100/90 border-b border-slate-200 text-xs font-black text-slate-700 uppercase">
                        <th className="py-3 px-4">สำหรับสินค้า</th>
                        <th className="py-3 px-4">รหัสวัตถุดิบ (RM)</th>
                        <th className="py-3 px-4">ชื่อวัตถุดิบ</th>
                        <th className="py-3 px-4 text-center">คลังตัดสต็อก</th>
                        <th className="py-3 px-4 text-right">จำนวนที่ใช้</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold">
                      {selectedOrder.items?.flatMap((fgItem) =>
                        fgItem.materials?.map((mat, matIdx) => (
                          <tr key={fgItem.fg_sku + mat.rm_sku + matIdx} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-mono font-bold text-slate-500 text-xs">
                              {fgItem.fg_sku}
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-slate-800 text-sm">
                              {mat.rm_sku}
                            </td>
                            <td className="py-3 px-4 font-black text-slate-900 text-sm">
                              {mat.rm_name}
                            </td>
                            <td className="py-3 px-4 text-center font-bold text-slate-800 text-sm">
                              {mat.rm_wh === "wh-01" ? "โกดัง 1 (วัตถุดิบ)" : mat.rm_wh}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-black text-slate-900 text-base">
                              {mat.rm_qty_required.toLocaleString()} {mat.rm_unit}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Status Update Controls */}
              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                <label className="block text-xs sm:text-sm font-black text-slate-800">
                  เปลี่ยนสถานะคำสั่งผลิต:
                </label>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    type="button"
                    disabled={isUpdatingStatus || selectedOrder.status === "COMPLETED"}
                    onClick={() => handleUpdateStatus(selectedOrder.order_no, "COMPLETED")}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm disabled:opacity-40 transition-all cursor-pointer shadow-xs"
                  >
                    ✓ ทำเครื่องหมายว่า เสร็จสมบูรณ์
                  </button>
                  <button
                    type="button"
                    disabled={isUpdatingStatus || selectedOrder.status === "IN_PROGRESS"}
                    onClick={() => handleUpdateStatus(selectedOrder.order_no, "IN_PROGRESS")}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs sm:text-sm disabled:opacity-40 transition-all cursor-pointer shadow-xs"
                  >
                    ⚙ กำลังดำเนินการผลิต
                  </button>
                  <button
                    type="button"
                    disabled={isUpdatingStatus || selectedOrder.status === "CANCELLED"}
                    onClick={() => handleUpdateStatus(selectedOrder.order_no, "CANCELLED")}
                    className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-rose-100 hover:text-rose-700 text-slate-800 font-black text-xs sm:text-sm disabled:opacity-40 transition-all cursor-pointer"
                  >
                    ✕ ยกเลิกคำสั่งผลิต
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-7 py-5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-black text-xs sm:text-sm transition-all flex items-center gap-2 cursor-pointer shadow-2xs"
              >
                <svg className="w-4 h-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                <span>พิมพ์ใบสั่งผลิต</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs sm:text-sm transition-all cursor-pointer shadow-xs"
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
