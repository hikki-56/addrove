"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import { safeNavigate } from "@/lib/safe-navigate";
import { isProductionReviewer } from "@/lib/production-reviewers";
import TableReportBoard from "./_components/TableReportBoard";

import type {
  ProductionMaterialItem,
  ProductionOrderItem,
  ProductionOrderRecord,
} from "@/types/production";

// คง export เดิมไว้เพื่อไม่ให้ผู้ import รายอื่นพัง (ถ้ามี)
export type { ProductionMaterialItem, ProductionOrderItem, ProductionOrderRecord };

export default function ProductionHistoryPage() {
  const router = useRouter();
  const { user } = useTabAuth();

  // Data states
  const [orders, setOrders] = useState<ProductionOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // มุมมองหน้า — "tables" = การ์ดโต๊ะผลิต (ดู/รายงานผลต่อโต๊ะ), "list" = ตารางรายการใบผลิตแบบเดิม
  const [view, setView] = useState<"tables" | "list">("tables");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const loadIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch production orders
  const loadData = useCallback(async () => {
    const currentLoadId = ++loadIdRef.current;

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

  // เปิดรายละเอียดใบผลิตเป็นหน้าแยก — เดิมเปิดเป็น modal ในหน้าเดียวกัน
  // หน้าแยกลิงก์/แชร์/refresh ตรงใบได้ และตาราง BOM อ่านได้กว้างขึ้น
  // ใช้ safeNavigate — ถ้าคลิกก่อน hydration เสร็จ/HMR ค้าง จะตกไปนำทางเต็มแทน ไม่โยน
  // "Router action dispatched before initialization"
  const openDetail = useCallback(
    (orderNo: string) => {
      safeNavigate(router, `/production/history/${encodeURIComponent(orderNo)}`);
    },
    [router]
  );

  // ไม่มีแถบตัวกรองแล้ว — แสดงรายการทั้งหมด
  const filteredOrders = orders;

  // Statistics — คำนวณจากข้อมูลที่ผ่านตัวกรอง
  const stats = useMemo(() => {
    const total = filteredOrders.length;
    const totalUnits = filteredOrders.reduce((sum, o) => sum + (Number(o.total_fg_qty) || 0), 0);
    const completed = filteredOrders.filter((o) => o.status === "COMPLETED").length;
    const inProgress = filteredOrders.filter((o) => o.status === "IN_PROGRESS" || o.status === "PENDING").length;

    return { total, totalUnits, completed, inProgress };
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

  // สรุปโต๊ะผลิตที่ใบผลิตนี้ใช้ (เช่น "โต๊ะ 1, 3") — ไม่ระบุ = ไม่แสดง
  const formatTables = (order: ProductionOrderRecord): string => {
    const tables = Array.from(
      new Set((order.items || []).map((i) => i.table_no).filter((t): t is number => typeof t === "number" && t >= 1 && t <= 5))
    ).sort((a, b) => a - b);
    return tables.length > 0 ? `โต๊ะ ${tables.join(", ")}` : "";
  };

  // Export CSV
  const handleExportCSV = () => {
    if (filteredOrders.length === 0) {
      alert("ไม่มีข้อมูลสำหรับส่งออก");
      return;
    }

    const headers = [
      "ลำดับ",
      "เลขที่ใบผลิต",
      "วันที่สั่งผลิต",
      "รายการสินค้าสำเร็จรูป",
      "โต๊ะผลิต",
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
        `"${formatTables(order)}"`,
        order.total_fg_qty,
        `"โกดัง 2 (สินค้าสำเร็จรูป)"`,
        `"${order.created_by_name || "Admin"}"`,
        `"${
          order.status === "COMPLETED"
            ? "ผลิตเสร็จสมบูรณ์"
            : order.status === "IN_PROGRESS"
            ? "กำลังดำเนินการผลิต"
            : order.status === "CANCELLED"
            ? "ยกเลิกใบผลิต"
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
            <span>ตรวจแล้วบางส่วน</span>
          </span>
        );
      case "PENDING":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
            <span>รอตรวจ</span>
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
      {/* Summary Statistics Cards (4 Columns) — ปรับให้อ่านง่ายบนมือถือ (ซ่อนไอคอนจอเล็ก ให้ชื่อเต็มความกว้าง) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3.5">
        <div className="bg-white rounded-2xl p-3 sm:p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs sm:text-sm font-semibold text-slate-500 leading-snug">ใบผลิตทั้งหมด</span>
            <div className="hidden sm:flex w-6 h-6 rounded-lg bg-slate-100 items-center justify-center text-slate-600 shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900">{stats.total.toLocaleString()}</div>
        </div>

        <div className="bg-white rounded-2xl p-3 sm:p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs sm:text-sm font-semibold text-slate-500 leading-snug">ยอดผลิตสำเร็จรูป</span>
            <div className="hidden sm:flex w-6 h-6 rounded-lg bg-[#EAF2EE] items-center justify-center text-[#06402B] shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-[#06402B]">{stats.totalUnits.toLocaleString()}</div>
        </div>

        <div className="bg-white rounded-2xl p-3 sm:p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs sm:text-sm font-semibold text-slate-500 leading-snug">เสร็จสมบูรณ์</span>
            <div className="hidden sm:flex w-6 h-6 rounded-lg bg-teal-50 items-center justify-center text-teal-600 shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-teal-600">{stats.completed.toLocaleString()}</div>
        </div>

        <div className="bg-white rounded-2xl p-3 sm:p-3.5 border border-[#E8ECEA] shadow-xs space-y-0.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs sm:text-sm font-semibold text-slate-500 leading-snug">กำลังดำเนินการ</span>
            <div className="hidden sm:flex w-6 h-6 rounded-lg bg-amber-50 items-center justify-center text-amber-600 shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-600">{stats.inProgress.toLocaleString()}</div>
        </div>
      </div>

      {/* สลับมุมมอง: การ์ดโต๊ะผลิต (ดู/รายงานผลต่อโต๊ะ) กับตารางรายการใบผลิตแบบเดิม */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-xl border border-[#E8ECEA] bg-white p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setView("tables")}
            aria-pressed={view === "tables"}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              view === "tables"
                ? "bg-[#06402B] text-white shadow-md shadow-[#06402B]/20"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            🪑 การ์ดโต๊ะผลิต
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              view === "list"
                ? "bg-[#06402B] text-white shadow-md shadow-[#06402B]/20"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            📋 รายการใบผลิต
          </button>
        </div>
      </div>

      {/* มุมมองการ์ดโต๊ะ — สรุป/รายงานผลผลิตต่อโต๊ะ */}
      {view === "tables" &&
        (loading ? (
          <div className="bg-white rounded-2xl border border-[#E8ECEA] shadow-xs p-8 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-500">กำลังโหลดข้อมูลโต๊ะผลิต...</p>
          </div>
        ) : (
          <TableReportBoard
            orders={orders}
            canReport={user?.role === "ADMIN" || isProductionReviewer({ email: user?.email, name: user?.name })}
            reporterName={user?.name || "ผู้ดูแลระบบ (Admin)"}
            openDetail={openDetail}
            onSubmitted={loadData}
          />
        ))}

      {/* Orders Table Container */}
      {view === "list" && (
      <div className="bg-white rounded-2xl border border-[#E8ECEA] shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[#EEF1EF] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
            <h2 className="text-base font-extrabold text-slate-900">รายการใบผลิต</h2>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {filteredOrders.length} รายการ
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-500">กำลังโหลดข้อมูลใบผลิต...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center space-y-2 text-slate-400">
            <span className="text-4xl">🏭</span>
            <h3 className="text-base font-bold text-slate-700">ไม่พบรายการใบผลิต</h3>
            <p className="text-sm text-slate-400">ยังไม่มีรายการใบผลิตในระบบ</p>
          </div>
        ) : (
          <>
            {/* ตาราง — จอ md ขึ้นไป */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-[#EEF1EF] bg-slate-50/70 text-slate-500 font-bold">
                    <th className="py-3 px-4">เลขที่ใบผลิต</th>
                    <th className="py-3 px-4">สินค้า</th>
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
                            onClick={() => openDetail(order.order_no)}
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
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                                <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded font-semibold text-slate-700">
                                  {firstItem.fg_sku}
                                </span>
                                {formatTables(order) && (
                                  <span className="font-bold text-[#052B1F] bg-[#06402B] px-1.5 py-0.5 rounded text-[10px] text-white whitespace-nowrap">
                                    {formatTables(order)}
                                  </span>
                                )}
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

                        {/* Created By */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5" title={order.created_by_name}>
                            <div className="w-5 h-5 rounded-full bg-[#DFEDE6] text-[#052B1F] flex items-center justify-center font-bold text-xs shrink-0">
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
                            onClick={() => openDetail(order.order_no)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-[#EAF2EE] hover:text-[#053425] text-slate-600 text-xs font-bold transition-colors cursor-pointer"
                          >
                            ตรวจสอบ
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* การ์ดรายการ — มือถือ (จอเล็กกว่า md) */}
            <div className="md:hidden p-3 sm:p-4 space-y-3">
              {paginatedOrders.map((order, idx) => {
                const firstItem = order.items?.[0];
                const extraItemsCount = (order.items?.length || 0) - 1;

                return (
                  <div
                    key={order.order_no + idx}
                    className="rounded-2xl border border-[#E8ECEA] bg-white p-3.5 space-y-2.5 shadow-2xs"
                  >
                    {/* เลขที่ใบผลิต + สถานะ */}
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openDetail(order.order_no)}
                        className="flex items-center gap-1.5 font-mono font-bold text-[#053425] text-sm text-left hover:underline cursor-pointer min-w-0"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#0F5C3F] shrink-0" />
                        <span className="truncate">{order.order_no}</span>
                      </button>
                      {renderStatusBadge(order.status)}
                    </div>

                    {/* สินค้า */}
                    {firstItem ? (
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 text-sm leading-snug break-words" title={firstItem.fg_name}>
                          {firstItem.fg_name}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded font-semibold text-slate-700">
                            {firstItem.fg_sku}
                          </span>
                          {formatTables(order) && (
                            <span className="font-bold text-white bg-[#06402B] px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap">
                              {formatTables(order)}
                            </span>
                          )}
                          {extraItemsCount > 0 && (
                            <span className="font-bold text-[#06402B] bg-[#EAF2EE] px-1.5 py-0.5 rounded border border-[#C9DFD4]">
                              +{extraItemsCount} รายการ
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-slate-400 text-sm">-</p>
                    )}

                    {/* ผู้สั่งผลิต + วันที่ */}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 min-w-0" title={order.created_by_name}>
                        <span className="w-5 h-5 rounded-full bg-[#DFEDE6] text-[#052B1F] flex items-center justify-center font-bold shrink-0">
                          {(order.created_by_name || "A").slice(0, 1)}
                        </span>
                        <span className="truncate text-slate-700 font-medium">
                          {order.created_by_name || "ผู้ดูแลระบบ (Admin)"}
                        </span>
                      </span>
                      <span className="text-slate-400 shrink-0">{formatThaiDateTime(order.created_at)}</span>
                    </div>

                    {/* ปุ่มตรวจสอบ */}
                    <button
                      type="button"
                      onClick={() => openDetail(order.order_no)}
                      className="w-full py-2 rounded-xl bg-slate-100 hover:bg-[#EAF2EE] hover:text-[#053425] text-slate-600 text-sm font-bold transition-colors cursor-pointer"
                    >
                      ตรวจสอบ
                    </button>
                  </div>
                );
              })}
            </div>
          </>
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
      )}

    </div>
  );
}
