"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import type { LoginLog, UserRole } from "@/types/models";

interface CleanLoginLog {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: string;
  login_method: "QR_CODE" | "PASSWORD";
  login_at: string;
  ip_address?: string;
  user_agent?: string;
}

const roleLabel: Record<string, string> = {
  ADMIN: "ผู้ดูแลระบบ (Admin)",
  MANAGER: "ผู้จัดการคลัง (Manager)",
  APPROVER: "ผู้อนุมัติ (Approver)",
  WAREHOUSE_STAFF: "พนักงานคลัง (Staff)",
  STAFF: "พนักงานคลัง (Staff)",
  VIEWER: "ผู้ดูข้อมูล (Viewer)",
};

const roleBadgeColor: Record<string, string> = {
  ADMIN: "bg-indigo-50 text-indigo-700 border-indigo-200",
  MANAGER: "bg-purple-50 text-purple-700 border-purple-200",
  APPROVER: "bg-amber-50 text-amber-800 border-amber-300",
  WAREHOUSE_STAFF: "bg-emerald-50 text-emerald-700 border-emerald-200",
  STAFF: "bg-emerald-50 text-emerald-700 border-emerald-200",
  VIEWER: "bg-slate-100 text-slate-700 border-slate-200",
};

const avatarColor: Record<string, string> = {
  ADMIN: "bg-indigo-600 text-white",
  MANAGER: "bg-purple-600 text-white",
  APPROVER: "bg-amber-600 text-white",
  WAREHOUSE_STAFF: "bg-emerald-600 text-white",
  STAFF: "bg-emerald-600 text-white",
  VIEWER: "bg-slate-600 text-white",
};

function formatThaiDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function getRelativeTime(isoString: string): string {
  try {
    const now = new Date().getTime();
    const past = new Date(isoString).getTime();
    const diffSec = Math.floor((now - past) / 1000);

    if (diffSec < 60) return "เมื่อสักครู่";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} นาทีที่แล้ว`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ชั่วโมงที่แล้ว`;
    return `${Math.floor(diffSec / 86400)} วันที่แล้ว`;
  } catch {
    return "";
  }
}

function parseUserAgent(ua?: string): { browser: string; os: string } {
  if (!ua) return { browser: "เบราว์เซอร์", os: "อุปกรณ์ทั่วไป" };
  const s = ua.toLowerCase();

  let browser = "เบราว์เซอร์";
  if (s.includes("edg/")) browser = "Edge";
  else if (s.includes("chrome") && !s.includes("chromium")) browser = "Chrome";
  else if (s.includes("safari") && !s.includes("chrome")) browser = "Safari";
  else if (s.includes("firefox")) browser = "Firefox";

  let os = "อุปกรณ์ทั่วไป";
  if (s.includes("windows")) os = "Windows";
  else if (s.includes("macintosh") || s.includes("mac os")) os = "macOS";
  else if (s.includes("iphone") || s.includes("ipad")) os = "iOS";
  else if (s.includes("android")) os = "Android";
  else if (s.includes("linux")) os = "Linux";

  return { browser, os };
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

export default function LoginNotificationsPage() {
  const [logs, setLogs] = useState<CleanLoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("ALL");
  const [selectedMethod, setSelectedMethod] = useState<string>("ALL");
  const [selectedDateRange, setSelectedDateRange] = useState<string>("TODAY");
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  // Pagination
  const [pageSize, setPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const fetchLogs = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch(`/api/login-logs?_t=${Date.now()}`);
      const json = await res.json();
      if (json.success && json.data) {
        setLogs(json.data.logs || []);
      }
    } catch (e) {
      console.error("[LoginLogs error]", e);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const roleOptions = useMemo(
    () => [
      { value: "ALL", label: "บทบาททั้งหมด" },
      { value: "ADMIN", label: "ผู้ดูแลระบบ (Admin)" },
      { value: "WAREHOUSE_STAFF", label: "พนักงานคลัง (Staff)" },
      { value: "VIEWER", label: "ผู้ดูข้อมูล (Viewer)" },
    ],
    []
  );

  const methodOptions = useMemo(
    () => [
      { value: "ALL", label: "ทุกวิธีการเข้าใช้งาน" },
      { value: "PASSWORD", label: "🔑 เข้าด้วยรหัสผ่าน (Password)" },
      { value: "QR_CODE", label: "📱 สแกน QR Code" },
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

  // Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // 1. Search
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesName = (log.user_name || "").toLowerCase().includes(q);
        const matchesEmail = (log.user_email || "").toLowerCase().includes(q);
        const matchesRole = (log.user_role || "").toLowerCase().includes(q);
        const matchesIp = (log.ip_address || "").toLowerCase().includes(q);
        const matchesUa = (log.user_agent || "").toLowerCase().includes(q);

        if (!matchesName && !matchesEmail && !matchesRole && !matchesIp && !matchesUa) {
          return false;
        }
      }

      // 2. Role Filter
      if (selectedRole !== "ALL") {
        const normRole = (log.user_role || "").toUpperCase();
        if (selectedRole === "WAREHOUSE_STAFF" && (normRole === "STAFF" || normRole === "WAREHOUSE_STAFF")) {
          // matches staff
        } else if (normRole !== selectedRole) {
          return false;
        }
      }

      // 3. Method Filter
      if (selectedMethod !== "ALL") {
        if (log.login_method !== selectedMethod) return false;
      }

      // 4. Date Range Filter
      if (dateFrom || dateTo) {
        const logDateStr = String(log.login_at || "").slice(0, 10);
        if (dateFrom && logDateStr < dateFrom) return false;
        if (dateTo && logDateStr > dateTo) return false;
      }

      return true;
    });
  }, [logs, search, selectedRole, selectedMethod, dateFrom, dateTo]);

  // Summary stats
  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    let total = logs.length;
    let todayCount = 0;
    let adminCount = 0;
    let staffCount = 0;

    for (const l of logs) {
      if (String(l.login_at || "").slice(0, 10) === todayStr) {
        todayCount++;
      }
      const r = (l.user_role || "").toUpperCase();
      if (r === "ADMIN") adminCount++;
      else if (r === "WAREHOUSE_STAFF" || r === "STAFF") staffCount++;
    }

    return { total, todayCount, adminCount, staffCount };
  }, [logs]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLogs.slice(start, start + pageSize);
  }, [filteredLogs, currentPage, pageSize]);

  return (
    <div className="w-full max-w-full space-y-4 sm:space-y-5">
      {/* Page Header */}
      <div className="pb-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
              ประวัติการเข้าสู่ระบบ
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>เรียลไทม์</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 font-normal mt-0.5">
            บันทึกประวัติการเข้าใช้งานระบบและรายชื่อผู้ใช้งานทั้งหมด
          </p>
        </div>

        <button
          type="button"
          onClick={() => fetchLogs(true)}
          disabled={isRefreshing}
          className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer self-start sm:self-auto"
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
        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">เข้าสู่ระบบทั้งหมด</span>
            <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-slate-900">{stats.total.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">ครั้งทั้งหมดในระบบ</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">เข้าใช้งานวันนี้</span>
            <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-emerald-600">{stats.todayCount.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">ครั้งในวันนี้</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">ผู้ดูแลระบบ (Admin)</span>
            <div className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-indigo-600">{stats.adminCount.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">ครั้งที่ Admin เข้าระบบ</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">พนักงานคลัง (Staff)</span>
            <div className="w-6 h-6 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-teal-600">{stats.staffCount.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">ครั้งที่พนักงานเข้าระบบ</div>
        </div>
      </div>

      {/* Search & Filters Card */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-4">
        {/* Search Box */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>ค้นหาผู้ใช้งาน</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="ค้นหาชื่อผู้ใช้งาน, อีเมล, บทบาท, IP Address, หรือ อุปกรณ์..."
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
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
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
          {/* Role Dropdown */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">บทบาท</label>
            <ScrollableSelect
              value={selectedRole}
              options={roleOptions}
              onChange={(val) => {
                setSelectedRole(val);
                setCurrentPage(1);
              }}
              title="บทบาท"
            />
          </div>

          {/* Login Method Dropdown */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">วิธีการเข้าใช้งาน</label>
            <ScrollableSelect
              value={selectedMethod}
              options={methodOptions}
              onChange={(val) => {
                setSelectedMethod(val);
                setCurrentPage(1);
              }}
              title="วิธีการเข้าใช้งาน"
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

        {/* Filter Summary & Reset Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 text-xs text-slate-500">
          <div>
            พบทั้งหมด <span className="font-bold text-slate-800">{filteredLogs.length.toLocaleString()}</span> รายการ
            {filteredLogs.length !== logs.length && (
              <span className="ml-1 text-slate-400">(จากประวัติทั้งหมด {logs.length.toLocaleString()} ครั้ง)</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {(search || selectedRole !== "ALL" || selectedMethod !== "ALL" || selectedDateRange !== "TODAY") && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setSelectedRole("ALL");
                  setSelectedMethod("ALL");
                  handleDateRangeChange("TODAY");
                }}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-bold hover:underline cursor-pointer"
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Login Logs Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <h2 className="text-sm font-extrabold text-slate-900">รายชื่อผู้เข้าสู่ระบบ</h2>
            <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {filteredLogs.length} รายการ
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-500">กำลังโหลดประวัติการเข้าสู่ระบบ...</p>
          </div>
        ) : paginatedLogs.length === 0 ? (
          <div className="p-12 text-center space-y-2 text-slate-400">
            <span className="text-4xl">👤</span>
            <h3 className="text-sm font-bold text-slate-700">ไม่พบประวัติการเข้าสู่ระบบ</h3>
            <p className="text-xs text-slate-400">ลองเปลี่ยนตัวกรองหรือคำค้นหาด้านบน</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[750px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-bold">
                  <th className="py-3.5 px-4">ผู้ใช้งาน</th>
                  <th className="py-3.5 px-4">บทบาท</th>
                  <th className="py-3.5 px-4">เวลาเข้าสู่ระบบ</th>
                  <th className="py-3.5 px-4">วิธีการเข้าใช้งาน</th>
                  <th className="py-3.5 px-4">IP Address</th>
                  <th className="py-3.5 px-4">อุปกรณ์ / เบราว์เซอร์</th>
                  <th className="py-3.5 px-4 text-center">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedLogs.map((log) => {
                  const roleKey = (log.user_role || "WAREHOUSE_STAFF").toUpperCase();
                  const roleTxt = roleLabel[roleKey] || log.user_role;
                  const roleBadge = roleBadgeColor[roleKey] || "bg-slate-100 text-slate-700 border-slate-200";
                  const avatarBg = avatarColor[roleKey] || "bg-slate-600 text-white";
                  const { browser, os } = parseUserAgent(log.user_agent);

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors group">
                      {/* User Info */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 shadow-xs ${avatarBg}`}>
                            {log.user_name?.slice(0, 1) || "U"}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 text-xs">
                              {log.user_name || "ไม่ทราบผู้ใช้งาน"}
                            </div>
                            {log.user_email && (
                              <div className="text-[11px] text-slate-400 font-medium">
                                {log.user_email}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Role Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${roleBadge}`}>
                          {roleTxt}
                        </span>
                      </td>

                      {/* Login Time */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-800 text-xs">
                          {formatThaiDate(log.login_at)}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {getRelativeTime(log.login_at)}
                        </div>
                      </td>

                      {/* Login Method */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {log.login_method === "QR_CODE" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 text-[11px] font-bold">
                            <span>📱</span>
                            <span>สแกน QR Code</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold">
                            <span>🔑</span>
                            <span>รหัสผ่าน</span>
                          </span>
                        )}
                      </td>

                      {/* IP Address */}
                      <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[11px] text-slate-600">
                        <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200/80">
                          {log.ip_address || "127.0.0.1"}
                        </span>
                      </td>

                      {/* Device & Browser */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-xs text-slate-700 font-semibold">
                          <span>{browser}</span>
                          <span className="text-slate-300">•</span>
                          <span className="text-slate-500 font-normal">{os}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span>เข้าสู่ระบบสำเร็จ</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {!loading && filteredLogs.length > 0 && (
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span>แสดง</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 font-semibold focus:outline-none focus:border-indigo-500"
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>รายการต่อหน้า (ทั้งหมด {filteredLogs.length} รายการ)</span>
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
    </div>
  );
}
