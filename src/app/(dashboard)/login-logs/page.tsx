"use client";

import { useEffect, useState } from "react";
import type { LoginLog, UserRole } from "@/types/models";
import type { EmployeeProductAddition } from "@/lib/services/login-log.service";

interface LoginLogWithDetails extends LoginLog {
  added_products_count: number;
  added_products: EmployeeProductAddition[];
}

interface StatsData {
  total_logins: number;
  staff_logins: number;
  total_products_added: number;
}

const roleLabel: Record<UserRole, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการคลัง",
  APPROVER: "ผู้อนุมัติ",
  WAREHOUSE_STAFF: "พนักงานคลัง",
  STAFF: "เจ้าหน้าที่",
  VIEWER: "ผู้ดูข้อมูล",
};

const roleColor: Record<UserRole, string> = {
  ADMIN: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  MANAGER: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  APPROVER: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  WAREHOUSE_STAFF: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  STAFF: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  VIEWER: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

function formatThaiDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString("th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric",
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

export default function LoginNotificationsPage() {
  const [logs, setLogs] = useState<LoginLogWithDetails[]>([]);
  const [stats, setStats] = useState<StatsData>({
    total_logins: 0,
    staff_logins: 0,
    total_products_added: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Toggle filter: Only show sessions with imported products by default
  const [onlyImported, setOnlyImported] = useState<boolean>(true);

  const today = new Date();
  const [selectedDay, setSelectedDay] = useState<string>(String(today.getDate()));
  const [selectedMonth, setSelectedMonth] = useState<string>(String(today.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState<string>(String(today.getFullYear()));

  // Pagination states: default 5 items per page
  const [itemsPerPage, setItemsPerPage] = useState<string>("5");
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [selectedLog, setSelectedLog] = useState<LoginLogWithDetails | null>(null);

  const fetchLogs = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const res = await fetch("/api/login-logs");
      const json = await res.json();
      if (json.success && json.data) {
        setLogs(json.data.logs || []);
        setStats(
          json.data.stats || {
            total_logins: 0,
            staff_logins: 0,
            total_products_added: 0,
          }
        );
      }
    } catch (e) {
      console.error("[LoginNotificationsPage error]", e);
    } finally {
      if (!isSilent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedDay, selectedMonth, selectedYear, itemsPerPage, onlyImported]);

  const filteredLogs = logs.filter((log) => {
    // If onlyImported is true, filter only logs with added_products
    if (onlyImported && log.added_products_count === 0) {
      return false;
    }

    const matchSearch =
      !search ||
      log.user_name.toLowerCase().includes(search.toLowerCase()) ||
      log.user_email.toLowerCase().includes(search.toLowerCase()) ||
      log.ip_address?.toLowerCase().includes(search.toLowerCase()) ||
      log.added_products.some(
        (p) =>
          p.product_name.toLowerCase().includes(search.toLowerCase()) ||
          p.sku.toLowerCase().includes(search.toLowerCase()) ||
          p.warehouse_name.toLowerCase().includes(search.toLowerCase())
      );

    const d = new Date(log.login_at);
    const logDay = String(d.getDate());
    const logMonth = String(d.getMonth() + 1);
    const logYear = String(d.getFullYear());

    const matchDay = !selectedDay || logDay === selectedDay;
    const matchMonth = !selectedMonth || logMonth === selectedMonth;
    const matchYear = !selectedYear || logYear === selectedYear;

    return matchSearch && matchDay && matchMonth && matchYear;
  });

  const totalItems = filteredLogs.length;
  const isAll = itemsPerPage === "ALL";
  const limit = isAll ? totalItems || 1 : Math.max(1, Number(itemsPerPage));
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalItems / limit));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedLogs = isAll
    ? filteredLogs
    : filteredLogs.slice((safePage - 1) * limit, safePage * limit);

  const thaiMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];

  return (
    <div className="space-y-6 w-full max-w-full">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-100 tracking-tight">
              ประวัติการนำเข้าสินค้า & การเข้าใช้งาน
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span>เรียลไทม์</span>
            </span>
          </div>
          <p className="text-slate-500 text-xs mt-1">
            ตรวจสอบรายชื่อพนักงานที่มีการนำเข้าสินค้าเข้าคลัง และรายละเอียดสินค้าในแต่ละรอบ
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center p-1 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs font-medium self-start sm:self-auto">
          <button
            onClick={() => setOnlyImported(true)}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              onlyImported
                ? "bg-indigo-600 text-white font-semibold shadow-md"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            📦 เฉพาะรอบที่มีการนำเข้า ({logs.filter((l) => l.added_products_count > 0).length})
          </button>
          <button
            onClick={() => setOnlyImported(false)}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              !onlyImported
                ? "bg-indigo-600 text-white font-semibold shadow-md"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            📋 ทั้งหมด ({logs.length})
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-card rounded-xl p-4 border border-white/[0.08] flex flex-col lg:flex-row gap-3 items-center justify-between">
        {/* Search input */}
        <div className="relative w-full lg:w-80">
          <svg
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อพนักงาน, อีเมล, หรือชื่อสินค้า/SKU..."
            className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-xs transition-all"
          />
        </div>

        {/* 3 Separate Dropdowns: วัน / เดือน / ปี */}
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <select
            value={selectedDay}
            onChange={(e) => setSelectedDay(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[#161622] border border-white/[0.09] text-slate-100 text-xs focus:outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
          >
            <option value="">วัน (ทั้งหมด)</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d)}>
                วันที่ {d}
              </option>
            ))}
          </select>

          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[#161622] border border-white/[0.09] text-slate-100 text-xs focus:outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
          >
            <option value="">เดือน (ทั้งหมด)</option>
            {thaiMonths.map((mName, idx) => (
              <option key={idx + 1} value={String(idx + 1)}>
                {mName}
              </option>
            ))}
          </select>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[#161622] border border-white/[0.09] text-slate-100 text-xs focus:outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
          >
            <option value="">ปี (ทั้งหมด)</option>
            {[2026, 2025, 2024].map((y) => (
              <option key={y} value={String(y)}>
                พ.ศ. {y + 543} ({y})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main History Table */}
      <div className="glass-card rounded-xl border border-white/[0.08] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm flex flex-col items-center gap-3">
            <svg
              className="animate-spin h-6 w-6 text-indigo-400"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span>กำลังโหลดข้อมูลประวัติการนำเข้าสินค้า...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm flex flex-col items-center gap-2">
            <svg
              className="w-10 h-10 text-slate-600 mb-1"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
            <p className="font-semibold text-slate-300">
              {onlyImported
                ? "ไม่พบประวัติการนำเข้าสินค้าในวันที่เลือก"
                : "ไม่พบประวัติการเข้าใช้งาน"}
            </p>
            <p className="text-xs text-slate-500">
              {onlyImported
                ? "ลองเปลี่ยนวัน/เดือน/ปี หรือกดปุ่ม 'ทั้งหมด' เพื่อดูประวัติย้อนหลัง"
                : "ลองเปลี่ยนคำค้นหาหรือตัวกรอง วัน/เดือน/ปี"}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.02] text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3.5 px-4">พนักงานที่นำเข้า</th>
                    <th className="py-3.5 px-4">บทบาท</th>
                    <th className="py-3.5 px-4">เวลาทำรายการ</th>
                    <th className="py-3.5 px-4">สินค้าที่นำเข้าในรอบนั้น</th>
                    <th className="py-3.5 px-4 text-center">สถานะ</th>
                    <th className="py-3.5 px-4 text-right">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {paginatedLogs.map((log) => {
                    const firstProduct = log.added_products[0];
                    const extraCount = log.added_products.length - 1;
                    const totalQtyInSession = log.added_products.reduce(
                      (sum, p) => sum + (Number(p.quantity) || 0),
                      0
                    );
                    const hasPending = log.added_products.some(
                      (p) => p.approval_status === "PENDING"
                    );

                    return (
                      <tr
                        key={log.id}
                        className="hover:bg-white/[0.02] transition-colors group"
                      >
                        {/* Employee Info */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-md">
                              {log.user_name?.charAt(0)?.toUpperCase() || "U"}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-200 group-hover:text-indigo-300 transition-colors">
                                {log.user_name}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {log.user_email}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Role Badge */}
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                              roleColor[log.user_role] || roleColor.VIEWER
                            }`}
                          >
                            {roleLabel[log.user_role] || log.user_role}
                          </span>
                        </td>

                        {/* Timestamp */}
                        <td className="py-3.5 px-4 min-w-[150px]">
                          <p className="text-slate-200 font-medium">
                            {formatThaiDate(log.login_at)}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {getRelativeTime(log.login_at)}
                          </p>
                        </td>

                        {/* Imported Products Preview */}
                        <td className="py-3.5 px-4">
                          {log.added_products_count > 0 ? (
                            <div className="space-y-1 max-w-md">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[11px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 font-bold">
                                  {firstProduct?.sku || "SKU"}
                                </span>
                                <span className="font-semibold text-slate-200 text-xs">
                                  {firstProduct?.product_name}
                                </span>
                                <span className="text-emerald-400 font-mono font-bold text-xs">
                                  +{firstProduct?.quantity} {firstProduct?.base_unit || "ชิ้น"}
                                </span>
                              </div>

                              {extraCount > 0 && (
                                <p className="text-[11px] text-indigo-300 font-medium">
                                  และสินค้าอีก <strong className="text-amber-400">{extraCount}</strong> รายการ (รวม <strong className="text-emerald-400">{totalQtyInSession}</strong> ชิ้น)
                                </p>
                              )}

                              {firstProduct?.warehouse_name && (
                                <p className="text-[10px] text-slate-500">
                                  📍 นำเข้าสู่: <span className="text-slate-300">{firstProduct.warehouse_name}</span>
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500 text-[11px]">
                              — ไม่มีรายการนำเข้า —
                            </span>
                          )}
                        </td>

                        {/* Approval Status */}
                        <td className="py-3.5 px-4 text-center">
                          {log.added_products_count > 0 ? (
                            hasPending ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[11px] font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                <span>รอ Admin อนุมัติ</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[11px] font-bold">
                                <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                <span>อนุมัติแล้ว</span>
                              </span>
                            )
                          ) : (
                            <span className="text-slate-600 text-[11px]">-</span>
                          )}
                        </td>

                        {/* View Details Button */}
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => setSelectedLog(log)}
                            id={`btn-view-details-${log.id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/25 font-semibold text-xs transition-all cursor-pointer hover:scale-105 active:scale-95"
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                              />
                            </svg>
                            <span>ดูรายละเอียด</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer Bar */}
            <div className="px-4 py-3 border-t border-white/[0.08] bg-white/[0.02] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-4 text-slate-400">
                <span>
                  แสดง {isAll || totalItems === 0 ? totalItems : Math.min((safePage - 1) * limit + 1, totalItems)} - {isAll ? totalItems : Math.min(safePage * limit, totalItems)} จากทั้งหมด <strong className="text-slate-200 font-semibold">{totalItems}</strong> รายการ
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">แสดงทีละ:</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => setItemsPerPage(e.target.value)}
                    className="px-2.5 py-1 rounded-lg bg-[#161622] border border-white/[0.09] text-slate-200 text-xs focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                  >
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="30">30</option>
                    <option value="ALL">ทั้งหมด</option>
                  </select>
                </div>
              </div>

              {!isAll && totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 rounded-lg bg-white/[0.04] border border-white/[0.09] text-slate-300 disabled:opacity-40 hover:bg-white/[0.08] transition-all cursor-pointer disabled:cursor-not-allowed"
                  >
                    ย้อนกลับ
                  </button>
                  <span className="px-3 py-1 text-slate-400 font-mono text-xs">
                    หน้า {safePage} / {totalPages}
                  </span>
                  <button
                    disabled={safePage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1 rounded-lg bg-white/[0.04] border border-white/[0.09] text-slate-300 disabled:opacity-40 hover:bg-white/[0.08] transition-all cursor-pointer disabled:cursor-not-allowed"
                  >
                    ถัดไป
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Employee Import Details Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="glass-card rounded-2xl max-w-2xl w-full border border-white/[0.12] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-md">
                  {selectedLog.user_name?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    {selectedLog.user_name}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {selectedLog.user_email} • {roleLabel[selectedLog.user_role]}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Session Info Bar */}
            <div className="px-6 py-3 bg-white/[0.03] border-b border-white/[0.06] flex flex-wrap gap-4 text-xs">
              <div>
                <span className="text-slate-500">เวลาทำรายการ: </span>
                <span className="text-slate-200 font-semibold">
                  {formatThaiDate(selectedLog.login_at)}
                </span>
              </div>
              <div>
                <span className="text-slate-500">วิธีเข้าใช้งาน: </span>
                <span className="text-indigo-400 font-semibold">
                  {selectedLog.login_method === "QR_CODE"
                    ? "📱 สแกน QR Code"
                    : "🔑 รหัสผ่าน"}
                </span>
              </div>
            </div>

            {/* Modal Body: Products Added */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-amber-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                    />
                  </svg>
                  <span>รายการสินค้าที่พนักงานนำเข้าในรอบนี้</span>
                </h3>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/20">
                  รวม {selectedLog.added_products.length} รายการ
                </span>
              </div>

              {selectedLog.added_products.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-white/[0.02] border border-white/[0.06] text-slate-500 text-xs flex flex-col items-center gap-2">
                  <svg
                    className="w-8 h-8 text-slate-600 mb-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                    />
                  </svg>
                  <p className="font-semibold text-slate-400">
                    ยังไม่มีข้อมูลการเพิ่มสินค้าจากพนักงานคนนี้ในรอบนี้
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedLog.added_products.map((item, idx) => (
                    <div
                      key={item.product_id + idx}
                      className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-indigo-500/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 font-bold">
                            {item.sku}
                          </span>
                          <span className="text-xs font-semibold text-slate-100">
                            {item.product_name}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-500/10 text-slate-400 border border-slate-500/20">
                            {item.category}
                          </span>
                          {item.approval_status === "POSTED" && (
                            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold flex items-center gap-1">
                              <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              <span>อนุมัติแล้ว</span>
                            </span>
                          )}
                          {item.approval_status === "PENDING" && (
                            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                              <span>รอ Admin อนุมัติ</span>
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">
                          {item.description || "รับสินค้าเข้าคลัง"}
                        </p>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-1">
                          <span>จัดเก็บที่: <strong className="text-slate-300 font-normal">{item.warehouse_name}</strong></span>
                          <span>•</span>
                          <span>เวลาเพิ่ม: <strong className="text-slate-300 font-normal">{formatThaiDate(item.created_at)}</strong></span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <div className="text-right">
                          <span className="text-xs text-slate-400 block">จำนวน</span>
                          <span className="text-sm font-bold text-emerald-400 font-mono">
                            +{item.quantity} {item.base_unit}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-white/[0.08] bg-white/[0.02] flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 text-xs font-medium transition-all cursor-pointer"
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
