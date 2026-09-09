"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { useEscapeKey } from "@/hooks/use-escape-key";

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

export default function ProductionHistoryPage() {
  const { user } = useTabAuth();

  // Data states
  const [orders, setOrders] = useState<ProductionOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // Date Range states (Default to Today)
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
  const [selectedOrder, setSelectedOrder] = useState<ProductionOrderRecord | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  useEscapeKey(!!selectedOrder, () => setSelectedOrder(null));

  const loadIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const statusOptions = useMemo(
    () => [
      { value: "ALL", label: "สถานะทั้งหมด" },
      { value: "COMPLETED", label: "เสร็จสมบูรณ์ (Completed)" },
      { value: "IN_PROGRESS", label: "กำลังผลิต (In Progress)" },
      { value: "PENDING", label: "รอดำเนินการ (Pending)" },
      { value: "CANCELLED", label: "ยกเลิก (Cancelled)" },
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

      const res = await fetch(`/api/production/orders`, {
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

      // 3. Date Range Filter
      if (dateFrom || dateTo) {
        const itemDate = (order.created_at || order.document_date || "").slice(0, 10);
        if (dateFrom && itemDate < dateFrom) return false;
        if (dateTo && itemDate > dateTo) return false;
      }

      return true;
    });
  }, [orders, searchQuery, selectedStatus, dateFrom, dateTo]);

  // Statistics — คำนวณจากข้อมูลที่ผ่านตัวกรอง (เช่นเดียวกับหน้าประวัติรับสินค้า)
  const stats = useMemo(() => {
    const total = filteredOrders.length;
    const totalUnits = filteredOrders.reduce((sum, o) => sum + (Number(o.total_fg_qty) || 0), 0);
    const completed = filteredOrders.filter((o) => o.status === "COMPLETED").length;
    const inProgress = filteredOrders.filter((o) => o.status === "IN_PROGRESS" || o.status === "PENDING").length;
    const cancelled = filteredOrders.filter((o) => o.status === "CANCELLED").length;

    return { total, totalUnits, completed, inProgress, cancelled };
  }, [filteredOrders]);

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
    handleDateRangeChange("TODAY");
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

  // Status Badge Helper
  const renderStatusBadge = (status: ProductionOrderRecord["status"]) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#EAF2EE] text-[#053425] border border-[#C9DFD4] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0F5C3F] shrink-0"></span>
            <span>เสร็จสมบูรณ์</span>
          </span>
        );
      case "IN_PROGRESS":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
            <span>กำลังผลิต</span>
          </span>
        );
      case "PENDING":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
            <span>รอดำเนินการ</span>
          </span>
        );
      case "CANCELLED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
            <span>ยกเลิก</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full max-w-full space-y-4 sm:space-y-5">
      {/* Toast Notification */}
      {copySuccess && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 animate-bounce">
          <svg className="w-4 h-4 text-[#5B8A74]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>คัดลอก {copySuccess} เรียบร้อย</span>
        </div>
      )}

      {/* Page Header */}
      <div className="pb-3 border-b border-[#E8ECEA] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            ประวัติการสั่งผลิต
          </h1>
          <p className="text-sm text-slate-500 font-normal mt-0.5">
            บันทึกและประวัติคำสั่งผลิตสินค้าสำเร็จรูปและการใช้วัตถุดิบ (BOM) ทั้งหมด
          </p>
        </div>

        <div className="flex items-center gap-2">
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

          <Link
            href="/production"
            className="px-3.5 py-2 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white text-sm font-bold flex items-center gap-1.5 transition-all shadow-sm shadow-[#06402B]/30"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span>สั่งผลิตสินค้าใหม่</span>
          </Link>
        </div>
      </div>

      {/* Summary Statistics Cards (4 Columns) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="bg-white rounded-2xl p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-500">คำสั่งผลิตทั้งหมด</span>
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
            <span className="text-sm font-semibold text-slate-500">ยอดผลิตสำเร็จรูป</span>
            <div className="w-6 h-6 rounded-lg bg-[#EAF2EE] flex items-center justify-center text-[#06402B]">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
          <div className="text-2xl font-black text-[#06402B]">{stats.totalUnits.toLocaleString()}</div>
          <div className="text-xs text-slate-400">หน่วยสินค้าสำเร็จรูปรวม</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-500">เสร็จสมบูรณ์</span>
            <div className="w-6 h-6 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div className="text-2xl font-black text-teal-600">{stats.completed.toLocaleString()}</div>
          <div className="text-xs text-slate-400">ตัดสต็อกและเข้าคลังเรียบร้อย</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-500">กำลังดำเนินการ</span>
            <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="text-2xl font-black text-amber-600">{stats.inProgress.toLocaleString()}</div>
          <div className="text-xs text-slate-400">อยู่ระหว่างขั้นตอนการผลิต</div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E8ECEA] shadow-xs space-y-4">
        {/* Search Box */}
        <div>
          <label htmlFor="prod-hist-search" className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-[#06402B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>ค้นหาข้อมูล</span>
          </label>
          <div className="relative">
            <input
              id="prod-hist-search"
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="ค้นหาเลขคำสั่งผลิต, รหัสสินค้า, ชื่อสินค้า, บาร์โค้ด, ผู้สั่งผลิต..."
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
          {/* Status Filter */}
          <div>
            <div className="block text-sm font-bold text-slate-700 mb-1.5">สถานะ</div>
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

        {/* Filter Summary */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#EEF1EF] text-sm text-slate-500">
          <div>
            พบทั้งหมด <span className="font-bold text-slate-800">{filteredOrders.length.toLocaleString()}</span> รายการ
            {filteredOrders.length !== orders.length && (
              <span className="ml-1 text-slate-400">(จากทั้งหมด {orders.length.toLocaleString()} รายการ)</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {(searchQuery || selectedStatus !== "ALL" || selectedDateRange !== "TODAY") && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-sm text-[#06402B] hover:text-[#053425] font-bold hover:underline cursor-pointer"
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Orders Table Container */}
      <div className="bg-white rounded-2xl border border-[#E8ECEA] shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[#EEF1EF] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
            <h2 className="text-base font-extrabold text-slate-900">รายการประวัติการสั่งผลิต</h2>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {filteredOrders.length} รายการ
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-500">กำลังโหลดข้อมูลประวัติการสั่งผลิต...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center space-y-2 text-slate-400">
            <span className="text-4xl">🏭</span>
            <h3 className="text-base font-bold text-slate-700">ไม่พบรายการประวัติการสั่งผลิต</h3>
            <p className="text-sm text-slate-400">ลองเปลี่ยนตัวกรองหรือคำค้นหาด้านบน</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-[#EEF1EF] bg-slate-50/70 text-slate-500 font-bold">
                  <th className="py-3 px-4">เลขที่คำสั่งผลิต</th>
                  <th className="py-3 px-4">สินค้า</th>
                  <th className="py-3 px-4">คลังปลายทาง</th>
                  <th className="py-3 px-4 text-right">จำนวนผลิต</th>
                  <th className="py-3 px-4">ผู้สั่งผลิต</th>
                  <th className="py-3 px-4">วันที่ / เวลา</th>
                  <th className="py-3 px-4 text-center">สถานะ</th>
                  <th className="py-3 px-4 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EF]">
                {paginatedOrders.map((order, idx) => {
                  const firstItem = order.items?.[0];
                  const extraItemsCount = (order.items?.length || 0) - 1;

                  return (
                    <tr
                      key={order.order_no + idx}
                      className="hover:bg-slate-50/70 transition-colors group"
                    >
                      {/* Order No */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(order)}
                          className="font-mono font-bold text-[#053425] hover:text-[#04231A] hover:underline flex items-center gap-1.5 text-left cursor-pointer"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[#0F5C3F] group-hover:scale-125 transition-transform" />
                          {order.order_no}
                        </button>
                      </td>

                      {/* Product Name & SKU */}
                      <td className="py-3.5 px-4 max-w-[260px]">
                        {firstItem ? (
                          <>
                            <div className="font-bold text-slate-900 truncate" title={firstItem.fg_name}>
                              {firstItem.fg_name}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded font-semibold text-slate-700">
                                {firstItem.fg_sku}
                              </span>
                              {extraItemsCount > 0 && (
                                <span className="font-bold text-[#06402B] bg-[#EAF2EE] px-1.5 py-0.5 rounded border border-[#C9DFD4]">
                                  +{extraItemsCount} รายการ
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* Target Warehouse */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-800 text-xs">
                          {firstItem?.target_warehouse_name || "-"}
                        </div>
                      </td>

                      {/* Total FG Qty */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <span className="font-mono font-extrabold text-slate-900 text-sm">
                          {Number(order.total_fg_qty || 0).toLocaleString()}
                        </span>
                        <span className="text-slate-500 font-sans ml-1 text-xs">
                          {firstItem?.fg_unit || "ชิ้น"}
                        </span>
                      </td>

                      {/* Created By */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5" title={order.created_by_name}>
                          <div className="w-5 h-5 rounded-full bg-[#DFEDE6] text-[#052B1F] flex items-center justify-center font-bold text-[11px] shrink-0">
                            {(order.created_by_name || "A").slice(0, 1)}
                          </div>
                          <span className="truncate max-w-[130px] text-slate-700 text-xs font-medium">
                            {order.created_by_name || "ผู้ดูแลระบบ (Admin)"}
                          </span>
                        </div>
                      </td>

                      {/* Date / Time */}
                      <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap text-xs">
                        {formatThaiDateTime(order.created_at)}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {renderStatusBadge(order.status)}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(order)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-[#EAF2EE] hover:text-[#053425] text-slate-600 text-xs font-bold transition-colors cursor-pointer"
                        >
                          ดูข้อมูล
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {!loading && filteredOrders.length > 0 && (
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
              <span>รายการต่อหน้า (ทั้งหมด {filteredOrders.length} รายการ)</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className="px-3 py-1.5 rounded-lg border border-[#E8ECEA] bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
              >
                ← ก่อนหน้า
              </button>

              <span className="px-3 py-1.5 font-bold text-slate-800">
                {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-[#E8ECEA] bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
              >
                ถัดไป →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Order Detail Modal with BOM Breakdown */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl border border-[#E8ECEA] max-h-[90dvh] overflow-y-auto space-y-5 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-[#EEF1EF]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
                  <h3 className="text-lg font-extrabold text-slate-900">
                    รายละเอียดคำสั่งผลิต
                  </h3>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono text-base font-bold text-[#053425]">
                    {selectedOrder.order_no}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedOrder.order_no, "เลขคำสั่งผลิต")}
                    className="text-xs text-slate-500 hover:text-[#053425] underline font-semibold cursor-pointer"
                  >
                    คัดลอก
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {renderStatusBadge(selectedOrder.status)}
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 font-bold transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Order Info Meta Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-2xl border border-[#E8ECEA]/80 text-sm">
              <div>
                <span className="text-slate-500 font-medium">วันที่สร้าง:</span>
                <p className="font-bold text-slate-900 mt-0.5">{formatThaiDateTime(selectedOrder.created_at)}</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">ผู้สั่งผลิต:</span>
                <p className="font-bold text-slate-900 mt-0.5">
                  {selectedOrder.created_by_name || "ผู้ดูแลระบบ (Admin)"}
                </p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">จำนวนรายการ FG:</span>
                <p className="font-bold text-slate-900 mt-0.5">{selectedOrder.items.length} รายการ</p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">จำนวนผลิตรวม:</span>
                <p className="font-extrabold text-[#06402B] mt-0.5">
                  {Number(selectedOrder.total_fg_qty || 0).toLocaleString()} ชิ้น
                </p>
              </div>
              <div>
                <span className="text-slate-500 font-medium">วัตถุดิบที่ใช้:</span>
                <p className="font-bold text-slate-900 mt-0.5">{selectedOrder.total_materials_count} รายการ</p>
              </div>
            </div>

            {/* Finished Goods Table */}
            <div>
              <h4 className="text-sm font-extrabold text-slate-900 mb-2.5">
                สินค้าสำเร็จรูปที่สั่งผลิต ({selectedOrder.items.length} รายการ)
              </h4>
              <div className="border border-[#E8ECEA] rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold border-b border-[#E8ECEA]">
                      <th className="py-2.5 px-3">รหัสสินค้า / บาร์โค้ด</th>
                      <th className="py-2.5 px-3">ชื่อสินค้า</th>
                      <th className="py-2.5 px-3">คลังปลายทาง</th>
                      <th className="py-2.5 px-3 text-right">จำนวน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1EF]">
                    {selectedOrder.items?.map((item, idx) => (
                      <tr key={item.fg_sku + idx} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono">
                          <div className="font-bold text-slate-800">{item.fg_sku}</div>
                          {item.fg_barcode && item.fg_barcode !== "-" && (
                            <div className="text-[11px] text-slate-400">{item.fg_barcode}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{item.fg_name}</td>
                        <td className="py-2.5 px-3 text-slate-600 text-xs">
                          {item.target_warehouse_name || "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {Number(item.quantity || 0).toLocaleString()} {item.fg_unit || "ชิ้น"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bill of Materials (Raw Materials required) */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h4 className="text-sm font-extrabold text-slate-900">
                  รายการตัดสต็อกวัตถุดิบ (Bill of Materials)
                </h4>
                <span className="text-xs text-slate-500 font-semibold">
                  ปลายทางตัดสต็อก: โกดัง 1 (วัตถุดิบ)
                </span>
              </div>
              <div className="border border-[#E8ECEA] rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold border-b border-[#E8ECEA]">
                      <th className="py-2.5 px-3">สำหรับสินค้า</th>
                      <th className="py-2.5 px-3">รหัสวัตถุดิบ (RM)</th>
                      <th className="py-2.5 px-3">ชื่อวัตถุดิบ</th>
                      <th className="py-2.5 px-3">คลังตัดสต็อก</th>
                      <th className="py-2.5 px-3 text-right">จำนวนที่ใช้</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1EF]">
                    {selectedOrder.items?.flatMap((fgItem) =>
                      fgItem.materials?.map((mat, matIdx) => (
                        <tr key={fgItem.fg_sku + mat.rm_sku + matIdx} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-3 font-mono font-semibold text-slate-500">
                            {fgItem.fg_sku}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                            {mat.rm_sku}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800">
                            {mat.rm_name}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 text-xs">
                            {mat.rm_wh === "wh-01" ? "โกดัง 1 (วัตถุดิบ)" : mat.rm_wh}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            {Number(mat.rm_qty_required || 0).toLocaleString()} {mat.rm_unit}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Status Update Controls */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-[#E8ECEA]/80 space-y-2.5">
              <div className="block text-sm font-extrabold text-slate-900">
                เปลี่ยนสถานะคำสั่งผลิต:
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={isUpdatingStatus || selectedOrder.status === "COMPLETED"}
                  onClick={() => handleUpdateStatus(selectedOrder.order_no, "COMPLETED")}
                  className="px-3.5 py-2 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white text-sm font-bold disabled:opacity-40 transition-all cursor-pointer"
                >
                  ✓ ทำเครื่องหมายว่า เสร็จสมบูรณ์
                </button>
                <button
                  type="button"
                  disabled={isUpdatingStatus || selectedOrder.status === "IN_PROGRESS"}
                  onClick={() => handleUpdateStatus(selectedOrder.order_no, "IN_PROGRESS")}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-40 transition-all cursor-pointer"
                >
                  ⚙ กำลังดำเนินการผลิต
                </button>
                <button
                  type="button"
                  disabled={isUpdatingStatus || selectedOrder.status === "CANCELLED"}
                  onClick={() => handleUpdateStatus(selectedOrder.order_no, "CANCELLED")}
                  className="px-3.5 py-2 rounded-xl bg-slate-200 hover:bg-rose-100 hover:text-rose-700 text-slate-800 text-sm font-bold disabled:opacity-40 transition-all cursor-pointer"
                >
                  ✕ ยกเลิกคำสั่งผลิต
                </button>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EEF1EF]">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition-colors cursor-pointer"
              >
                พิมพ์ใบสั่งผลิต
              </button>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
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
