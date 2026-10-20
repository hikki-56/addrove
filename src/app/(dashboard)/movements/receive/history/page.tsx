"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { getWarehouseName, normalizeWarehouseId } from "@/lib/warehouse-utils";
import { useEscapeKey } from "@/hooks/use-escape-key";
import CompactSelect from "@/components/ui/CompactSelect";

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

function formatCreatorName(name?: string, id?: string): string {
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

  useEscapeKey(!!selectedRecord, () => setSelectedRecord(null));
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
      const res = await fetch(`/api/movements/receive/history`, { cache: "no-store" });
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
          <span className="m3-label m3-label-success whitespace-nowrap">
            <span>อนุมัติแล้ว</span>
          </span>
        );
      case "WAITING_APPROVAL":
      case "PENDING":
        return (
          <span className="m3-label m3-label-warning whitespace-nowrap">
            <span>รออนุมัติ</span>
          </span>
        );
      case "CANCELLED":
        return (
          <span className="m3-label m3-label-error whitespace-nowrap">
            <span>ยกเลิก</span>
          </span>
        );
      default:
        return (
          <span className="m3-label m3-label-default whitespace-nowrap">
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
        <div className="fixed bottom-6 right-6 z-50 bg-m3-grey-800 text-white px-4 py-2.5 rounded-xl shadow-m3-dropdown text-sm font-semibold flex items-center gap-2 animate-bounce">
          <svg className="w-4 h-4 text-m3-primary-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          className="m3-btn m3-btn-outline gap-1.5 cursor-pointer"
        >
          <svg
            className={`w-3.5 h-3.5 text-m3-grey-600 ${isRefreshing ? "animate-spin" : ""}`}
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
          className="m3-btn m3-btn-dark gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          <span>รับสินค้าเข้าใหม่</span>
        </Link>
      </div>

      {/* Summary Statistics Cards (4 Columns) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="m3-card p-4 sm:p-5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-m3-grey-600">รายการรับเข้าทั้งหมด</span>
            <div className="size-10 rounded-xl bg-[rgba(0,184,217,0.12)] flex items-center justify-center text-m3-info">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
          <div className="font-m3-disp text-2xl font-bold text-m3-grey-800">{stats.total.toLocaleString()}</div>
          <div className="text-xs text-m3-grey-500">รายการทั้งหมดตามตัวกรอง</div>
        </div>

        <div className="m3-card p-4 sm:p-5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-m3-grey-600">จำนวนชิ้นรวม</span>
            <div className="size-10 rounded-xl bg-[rgba(0,167,111,0.08)] flex items-center justify-center text-m3-primary-dark">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
          <div className="font-m3-disp text-2xl font-bold text-m3-primary-dark">{stats.totalUnits.toLocaleString()}</div>
          <div className="text-xs text-m3-grey-500">ชิ้นสินค้าที่รับเข้า</div>
        </div>

        <div className="m3-card p-4 sm:p-5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-m3-grey-600">อนุมัติแล้ว</span>
            <div className="size-10 rounded-xl bg-[rgba(0,167,111,0.08)] flex items-center justify-center text-m3-primary-dark">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div className="font-m3-disp text-2xl font-bold text-m3-primary-dark">{stats.completed.toLocaleString()}</div>
          <div className="text-xs text-m3-grey-500">เพิ่มเข้าสต็อกเรียบร้อย</div>
        </div>

        <div className="m3-card p-4 sm:p-5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-m3-grey-600">รออนุมัติ</span>
            <div className="size-10 rounded-xl bg-[rgba(255,171,0,0.08)] flex items-center justify-center text-m3-warning-dark">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="font-m3-disp text-2xl font-bold text-m3-warning-dark">{stats.waitingApproval.toLocaleString()}</div>
          <div className="text-xs text-m3-grey-500">
            {stats.waitingApproval > 0 ? (
              <Link href="/approvals" className="text-m3-warning-dark font-bold hover:underline">
                ไปหน้าอนุมัติ →
              </Link>
            ) : (
              "ไม่มีรายการค้าง"
            )}
          </div>
        </div>
      </div>

      {/* Search & Filters Card */}
      <div className="m3-card p-4 sm:p-5 space-y-4">
        {/* Search Box */}
        <div>
          <label htmlFor="rcv-hist-search" className="block text-sm font-bold text-m3-grey-700 mb-1.5 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-m3-primary-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>ค้นหาข้อมูล</span>
          </label>
          <div className="relative">
            <input
              id="rcv-hist-search"
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="ค้นหาเลขเอกสาร (RCV-...), บาร์โค้ด, รหัสสินค้า, ชื่อสินค้า, ผู้จำหน่าย, ผู้ตรวจรับ..."
              className="w-full pl-10 pr-8 py-2.5 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-m3-grey-800 placeholder-m3-grey-500 text-sm font-medium focus:outline-none focus:border-m3-grey-800 focus:bg-white focus:ring-2 focus:ring-m3-primary/20 transition-all shadow-2xs"
            />
            <svg
              className="w-4 h-4 text-m3-grey-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
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
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-m3-grey-500 hover:text-m3-grey-600 p-1 rounded-full hover:bg-m3-grey-300/60"
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
            <div className="block text-sm font-bold text-m3-grey-700 mb-1.5">สถานะ</div>
            <CompactSelect
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
            <div className="block text-sm font-bold text-m3-grey-700 mb-1.5">โกดังรับเข้า</div>
            <CompactSelect
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
            <div className="block text-sm font-bold text-m3-grey-700 mb-1.5">ช่วงเวลา</div>
            <CompactSelect
              value={selectedDateRange}
              options={dateRangeOptions}
              onChange={handleDateRangeChange}
              title="ช่วงเวลา"
            />
          </div>
        </div>

        {/* Row 3: Filter Summary & Page Size */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[rgba(145,158,171,0.2)] text-sm text-m3-grey-600">
          <div>
            พบทั้งหมด <span className="font-bold text-m3-grey-800">{filteredRecords.length.toLocaleString()}</span> รายการ
            {filteredRecords.length !== records.length && (
              <span className="ml-1 text-m3-grey-500">(จากทั้งหมด {records.length.toLocaleString()} รายการ)</span>
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
                className="text-sm text-m3-primary-dark hover:text-m3-primary-darker font-bold hover:underline cursor-pointer"
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Records Table Card */}
      <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[rgba(145,158,171,0.2)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-m3-primary" />
            <h2 className="text-base font-extrabold text-m3-grey-800">รายการประวัติการรับสินค้า</h2>
            <span className="text-xs font-bold text-m3-grey-600 bg-m3-grey-200 px-2 py-0.5 rounded-full">
              {filteredRecords.length} รายการ
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-m3-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm font-semibold text-m3-grey-600">กำลังโหลดข้อมูลประวัติรับสินค้า...</p>
          </div>
        ) : paginatedRecords.length === 0 ? (
          <div className="p-12 text-center space-y-2 text-m3-grey-500">
            <span className="text-4xl">📥</span>
            <h3 className="text-base font-bold text-m3-grey-700">ไม่พบรายการประวัติการรับสินค้า</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] min-w-[800px]">
              <thead>
                <tr className="border-b border-[rgba(145,158,171,0.2)] bg-m3-grey-100/70 text-m3-grey-600 font-bold">
                  <th className="py-3 px-2.5">เลขที่เอกสาร</th>
                  <th className="py-3 px-2.5">สินค้า</th>
                  <th className="py-3 px-2.5">โกดังรับเข้า & ตำแหน่ง</th>
                  <th className="py-3 px-2.5 text-right">จำนวน</th>
                  <th className="py-3 px-2.5">ผู้จำหน่าย</th>
                  <th className="py-3 px-2.5">ผู้ทำรายการ</th>
                  <th className="py-3 px-2.5">วันที่ / เวลา</th>
                  <th className="py-3 px-2.5 text-center">สถานะ</th>
                  <th className="py-3 px-2.5 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(145,158,171,0.2)]">
                {paginatedRecords.map((item) => (
                  <tr key={item.id} className="hover:bg-m3-grey-100/70 transition-colors group">
                    {/* Document No */}
                    <td className="py-3 px-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedRecord(item)}
                        className="tabular-nums font-bold text-m3-primary-darker hover:text-m3-primary-darker hover:underline flex items-center gap-1.5 text-left cursor-pointer"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-m3-primary group-hover:scale-125 transition-transform" />
                        {item.document_no}
                      </button>
                    </td>

                    {/* Product Name & SKU */}
                    <td className="py-3 px-2.5 max-w-[240px]">
                      <div className="font-bold text-m3-grey-800 truncate" title={item.primary_product_name}>
                        {item.primary_product_name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-m3-grey-600">
                        <span className="tabular-nums bg-m3-grey-200 px-1.5 py-0.5 rounded font-semibold text-m3-grey-700">
                          {item.primary_sku}
                        </span>
                        {item.total_items > 1 && (
                          <span className="font-bold text-m3-primary-dark bg-[rgba(0,167,111,0.08)] px-1.5 py-0.5 rounded border border-[rgba(0,167,111,0.24)]">
                            +{item.total_items - 1} รายการ
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Target Warehouse & Shelf */}
                    <td className="py-3 px-2.5 whitespace-nowrap">
                      <div className="font-bold text-m3-grey-800 text-xs">{item.warehouse_name}</div>
                      <div className="text-xs text-m3-grey-600 tabular-nums mt-0.5 flex items-center gap-1">
                        <span>ตำแหน่ง:</span>
                        <span className="font-semibold text-m3-grey-700">{item.primary_location}</span>
                      </div>
                    </td>

                    {/* Qty & Unit */}
                    <td className="py-3 px-2.5 text-right whitespace-nowrap">
                      <span className="tabular-nums font-extrabold text-m3-grey-800 text-sm">
                        {Number(item.total_qty).toLocaleString()}
                      </span>
                      <span className="text-m3-grey-600 font-sans ml-1 text-xs">ชิ้น</span>
                    </td>

                    {/* Supplier */}
                    <td className="py-3 px-2.5 whitespace-nowrap max-w-[140px]">
                      <span className="truncate block text-m3-grey-600 text-xs" title={item.primary_supplier}>
                        {item.primary_supplier || "-"}
                      </span>
                    </td>

                    {/* Created By */}
                    <td className="py-3 px-2.5 whitespace-nowrap">
                      {(() => {
                        const displayName = formatCreatorName(item.created_by_name, item.created_by);
                        return (
                          <div className="flex items-center gap-1.5" title={displayName}>
                            <div className="w-5 h-5 rounded-full bg-[rgba(0,167,111,0.16)] text-m3-primary-darker flex items-center justify-center font-bold text-xs shrink-0">
                              {displayName.slice(0, 1) || "U"}
                            </div>
                            <span className="truncate max-w-[130px] text-m3-grey-700 text-xs font-medium">
                              {displayName}
                            </span>
                          </div>
                        );
                      })()}
                    </td>

                    {/* Date / Time */}
                    <td className="py-3 px-2.5 text-m3-grey-600 whitespace-nowrap text-xs">
                      {formatThaiDateTime(item.created_at)}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-2.5 text-center whitespace-nowrap">
                      {renderStatusBadge(item.status)}
                    </td>

                    {/* Action */}
                    <td className="py-3 px-2.5 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedRecord(item)}
                        className="px-2.5 py-1 rounded-lg bg-m3-grey-200 hover:bg-[rgba(0,167,111,0.08)] hover:text-m3-primary-darker text-m3-grey-600 text-xs font-bold transition-colors cursor-pointer"
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
          <div className="p-4 border-t border-[rgba(145,158,171,0.2)] flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-m3-grey-600">
            <div className="flex items-center gap-2">
              <span>แสดง</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 rounded-lg border border-[rgba(145,158,171,0.2)] bg-m3-grey-100 font-semibold focus:outline-none focus:border-m3-grey-800"
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
                className="px-3 py-1.5 rounded-lg border border-[rgba(145,158,171,0.2)] bg-white hover:bg-m3-grey-100 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
              >
                ← ก่อนหน้า
              </button>

              <span className="px-3 py-1.5 font-bold text-m3-grey-800">
                {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg border border-[rgba(145,158,171,0.2)] bg-white hover:bg-m3-grey-100 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
              >
                ถัดไป →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-m3-grey-800/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-m3-dropdown border border-[rgba(145,158,171,0.2)] max-h-[90dvh] overflow-y-auto space-y-5 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-[rgba(145,158,171,0.2)]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-m3-primary" />
                  <h3 className="text-lg font-extrabold text-m3-grey-800">
                    รายละเอียดเอกสารรับสินค้า
                  </h3>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="tabular-nums text-base font-bold text-m3-primary-darker">
                    {selectedRecord.document_no}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedRecord.document_no, "เลขเอกสาร")}
                    className="text-xs text-m3-grey-600 hover:text-m3-primary-darker underline font-semibold cursor-pointer"
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
                  className="w-8 h-8 rounded-full bg-m3-grey-200 hover:bg-m3-grey-300 flex items-center justify-center text-m3-grey-600 font-bold transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Document Info Meta Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-m3-grey-100 p-4 rounded-xl border border-[rgba(145,158,171,0.2)] text-sm">
              <div>
                <span className="text-m3-grey-600 font-medium">โกดังรับเข้า:</span>
                <p className="font-bold text-m3-grey-800 mt-0.5">{selectedRecord.warehouse_name}</p>
              </div>
              <div>
                <span className="text-m3-grey-600 font-medium">วันที่เอกสาร:</span>
                <p className="font-bold text-m3-grey-800 mt-0.5">{selectedRecord.document_date}</p>
              </div>
              <div>
                <span className="text-m3-grey-600 font-medium">ผู้ทำรายการ:</span>
                <p className="font-bold text-m3-grey-800 mt-0.5">
                  {formatCreatorName(selectedRecord.created_by_name, selectedRecord.created_by)}
                </p>
              </div>
              <div>
                <span className="text-m3-grey-600 font-medium">เวลารับเข้า:</span>
                <p className="font-bold text-m3-grey-800 mt-0.5">{formatThaiDateTime(selectedRecord.created_at)}</p>
              </div>
              <div>
                <span className="text-m3-grey-600 font-medium">จำนวนรายการ:</span>
                <p className="font-bold text-m3-grey-800 mt-0.5">{selectedRecord.items.length} รายการ</p>
              </div>
              <div>
                <span className="text-m3-grey-600 font-medium">จำนวนชิ้นรวม:</span>
                <p className="font-extrabold text-m3-primary-dark mt-0.5">
                  {Number(selectedRecord.total_qty).toLocaleString()} ชิ้น
                </p>
              </div>
            </div>

            {/* Line Items Table inside modal */}
            <div>
              <h4 className="text-sm font-extrabold text-m3-grey-800 mb-2.5">
                รายการสินค้าในเอกสาร ({selectedRecord.items.length} รายการ)
              </h4>
              <div className="border border-[rgba(145,158,171,0.2)] rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-m3-grey-200 text-m3-grey-600 font-bold border-b border-[rgba(145,158,171,0.2)]">
                      <th className="py-2.5 px-3">รหัสสินค้า / บาร์โค้ด</th>
                      <th className="py-2.5 px-3">ชื่อสินค้า</th>
                      <th className="py-2.5 px-3">ตำแหน่งชั้น</th>
                      <th className="py-2.5 px-3">ผู้จำหน่าย</th>
                      <th className="py-2.5 px-3 text-right">จำนวน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(145,158,171,0.2)]">
                    {selectedRecord.items.map((it, idx) => (
                      <tr key={idx} className="hover:bg-m3-grey-100/70">
                        <td className="py-2.5 px-3 tabular-nums">
                          <div className="font-bold text-m3-grey-800">{it.sku}</div>
                          {it.barcode && it.barcode !== "-" && it.barcode !== it.sku && (
                            <div className="text-xs text-m3-grey-500">{it.barcode}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-m3-grey-800">
                          {it.product_name}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums text-m3-grey-700">
                          {it.location_code}
                        </td>
                        <td className="py-2.5 px-3 text-m3-grey-600">
                          {it.supplier || "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-m3-grey-800">
                          {Number(it.qty).toLocaleString()} {it.base_unit || "ชิ้น"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedRecord.note && (
              <div className="p-3 bg-[rgba(255,171,0,0.08)] rounded-xl border border-[rgba(255,171,0,0.24)] text-sm text-m3-warning-dark">
                <span className="font-bold">หมายเหตุ:</span> {selectedRecord.note}
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[rgba(145,158,171,0.2)]">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 rounded-xl bg-m3-grey-200 hover:bg-m3-grey-300 text-m3-grey-700 text-sm font-bold transition-colors cursor-pointer"
              >
                พิมพ์เอกสาร
              </button>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="px-5 py-2 rounded-xl bg-m3-grey-800 hover:bg-m3-grey-800 text-white text-sm font-bold transition-colors cursor-pointer"
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
