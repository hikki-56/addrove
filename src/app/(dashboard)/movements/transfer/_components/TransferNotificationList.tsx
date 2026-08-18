"use client";

import React, { useState } from "react";
import type { TransferNotification } from "@/lib/transfer-notification-utils";

export interface TransferNotificationListProps {
  notifications: TransferNotification[];
  isAdmin: boolean;
  onSelectTask: (task: TransferNotification) => void;
  onCancelTask: (e: React.MouseEvent, task: TransferNotification) => void;
  onApproveTask?: (task: TransferNotification) => void;
  onRejectTask?: (e: React.MouseEvent, task: TransferNotification) => void;
  onCleanupHistory?: () => void;
  isCleaningUp?: boolean;
  cancellingId?: string | null;
  approvingId?: string | null;
}

export default function TransferNotificationList({
  notifications,
  isAdmin,
  onSelectTask,
  onCancelTask,
  onApproveTask,
  onRejectTask,
  onCleanupHistory,
  isCleaningUp = false,
  cancellingId = null,
  approvingId = null,
}: TransferNotificationListProps) {
  const [filterStep, setFilterStep] = useState<"ALL" | "WAITING_APPROVAL" | "IN_PROGRESS" | "WAITING">("ALL");

  const waitingApprovalList = notifications.filter((t) => t.status === "WAITING_APPROVAL" || t.current_step === 3);
  const inProgressList = notifications.filter((t) => t.status !== "WAITING_APPROVAL" && (t.current_step || 0) >= 1 && (t.current_step || 0) <= 2);
  const waitingList = notifications.filter((t) => t.status !== "WAITING_APPROVAL" && (!t.current_step || t.current_step === 0));

  const displayedList =
    filterStep === "WAITING_APPROVAL"
      ? waitingApprovalList
      : filterStep === "IN_PROGRESS"
      ? inProgressList
      : filterStep === "WAITING"
      ? waitingList
      : notifications;

  if (notifications.length === 0) {
    return (
      <div className="bg-white rounded-3xl p-10 text-center border border-slate-200/80 shadow-lg space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200/80 flex items-center justify-center mx-auto text-emerald-600 text-2xl">
          ✓
        </div>
        <div>
          <div className="text-base font-bold text-slate-800">ไม่มีรายการงานที่กำลังดำเนินการในขณะนี้</div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            เมื่อมีการสร้างใบย้ายสินค้า ระบบจะติดตามสถานะและขั้นตอนของพนักงานแบบ Real-time ที่นี่ทันที
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header with Real-time Status Badge & Summary Tabs (Admin Only) */}
      {isAdmin && (
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <div>
                <h3 className="font-extrabold text-slate-900 text-base sm:text-lg flex items-center gap-2">
                  <span>ติดตามสถานะงานพนักงานแบบเรียลไทม์</span>
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200/80">
                    Live Feed
                  </span>
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  ดูขั้นตอนที่พนักงานกำลังทำอยู่จริง ทุกการสแกนบาร์โค้ดและย้ายคลัง
                </p>
              </div>
            </div>

            {onCleanupHistory && (
              <button
                type="button"
                onClick={onCleanupHistory}
                disabled={isCleaningUp}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition-all cursor-pointer disabled:opacity-50"
              >
                {isCleaningUp ? "กำลังล้าง..." : "ล้างรายการที่เสร็จแล้ว"}
              </button>
            )}
          </div>

          {/* Filter Filter Chips */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setFilterStep("ALL")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterStep === "ALL"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/80"
              }`}
            >
              <span>งานทั้งหมด</span>
              <span className="px-1.5 py-0.2 rounded-md bg-black/15 text-[11px]">
                {notifications.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterStep("WAITING_APPROVAL")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterStep === "WAITING_APPROVAL"
                  ? "bg-amber-500 text-slate-950 shadow-xs"
                  : "bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200/80"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span>รอ Admin อนุมัติ</span>
              <span className="px-1.5 py-0.2 rounded-md bg-black/15 text-[11px]">
                {waitingApprovalList.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterStep("IN_PROGRESS")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterStep === "IN_PROGRESS"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>กำลังย้ายของ</span>
              <span className="px-1.5 py-0.2 rounded-md bg-black/15 text-[11px]">
                {inProgressList.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterStep("WAITING")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                filterStep === "WAITING"
                  ? "bg-slate-700 text-white shadow-xs"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200/80"
              }`}
            >
              <span>ยังไม่เริ่มย้าย</span>
              <span className="px-1.5 py-0.2 rounded-md bg-black/15 text-[11px]">
                {waitingList.length}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Task Cards List */}
      <div className="space-y-4">
        {displayedList.map((t) => {
          const barcode = t.barcode && t.barcode.trim() !== "-" ? t.barcode.trim() : "";
          const isCancelling = cancellingId === t.id;
          const isApproving = approvingId === t.id;
          const isWaitingApproval = t.status === "WAITING_APPROVAL" || t.current_step === 3;
          const step = t.current_step || 0; // 0 = Pending, 1 = Scan Prod, 2 = Source Pick, 3 = Dest Putaway, 4 = Done

          // Step badge config
          const stepConfig = isWaitingApproval
            ? {
                title: "ย้ายแล้ว (รอ Admin อนุมัติ)",
                detail: "พนักงานย้ายและสแกนของแล้ว รอ Admin กดอนุมัติบันทึกข้อมูลเข้าระบบ",
                color: "bg-amber-500 text-slate-950 border-amber-600",
                badge: "bg-amber-50 text-amber-900 border-amber-300 font-extrabold",
                dot: "bg-amber-500",
              }
            : step === 1
            ? {
                title: "กำลังสแกนสินค้า",
                detail: "พนักงานกำลังสแกนบาร์โค้ดสินค้าบนตัวสินค้า",
                color: "bg-sky-500 text-white border-sky-600",
                badge: "bg-sky-50 text-sky-700 border-sky-200",
                dot: "bg-sky-500",
              }
            : step === 2
            ? {
                title: "กำลังหยิบสินค้าต้นทาง",
                detail: `พนักงานกำลังสแกนตำแหน่งและหยิบของใน ${t.from_warehouse_name}`,
                color: "bg-amber-500 text-white border-amber-600",
                badge: "bg-amber-50 text-amber-700 border-amber-200",
                dot: "bg-amber-500",
              }
            : step >= 4
            ? {
                title: "ย้ายสินค้าสำเร็จ",
                detail: "ตัดสต็อกต้นทางและเพิ่มเข้าปลายทางแล้ว",
                color: "bg-emerald-600 text-white border-emerald-700",
                badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
                dot: "bg-emerald-500",
              }
            : {
                title: "รอดำเนินการ (ยังไม่เริ่ม)",
                detail: "สร้างใบงานแล้ว รอพนักงานกดเริ่มงาน",
                color: "bg-slate-400 text-white border-slate-500",
                badge: "bg-slate-100 text-slate-700 border-slate-200",
                dot: "bg-slate-400",
              };

          return (
            <div
              key={t.id}
              onClick={!isAdmin && !isWaitingApproval ? () => onSelectTask(t) : undefined}
              className={`p-5 sm:p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm transition-all duration-200 space-y-4 relative overflow-hidden ${
                !isAdmin && !isWaitingApproval
                  ? "cursor-pointer hover:border-emerald-500/80 hover:shadow-xl group"
                  : "cursor-default"
              }`}
            >
              {/* Top Row: Staff Assigned & Realtime Live Status Badge */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-700 font-extrabold flex items-center justify-center text-sm shrink-0">
                    👤
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-slate-900 text-sm sm:text-base">
                        {t.moved_by || t.assigned_to_name || "พนักงานคลังสินค้า"}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono font-bold text-[11px]">
                        {t.doc_no}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium">
                      สร้างเมื่อ: {new Date(t.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.
                    </p>
                  </div>
                </div>

                {/* Live Current Step Badge */}
                <div className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 font-bold text-xs shadow-2xs ${stepConfig.badge}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${stepConfig.dot} animate-pulse`} />
                  <span>{stepConfig.title}</span>
                  {step > 0 && step < 3 && (
                    <span className="font-mono text-[11px] opacity-80">({step}/3)</span>
                  )}
                </div>
              </div>

              {/* Product Info & Quantity Row */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1 min-w-0">
                  {/* อันแรก: บาร์โค้ดขนาดใหญ่พิเศษ หนาเด่นชัด */}
                  <div className="text-slate-950 font-mono font-black text-xl sm:text-2xl tracking-wide flex items-center gap-2.5 flex-wrap">
                    <span className="text-xs sm:text-sm font-black text-indigo-800 bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-xl shrink-0">
                      บาร์โค้ด
                    </span>
                    <span className="truncate">{barcode || t.sku}</span>
                  </div>

                  {/* อันที่สอง: SKU */}
                  <div className="text-sm sm:text-base text-slate-700 font-mono flex items-center gap-2">
                    <span className="text-slate-500 font-medium">SKU:</span>
                    <strong className="text-slate-950 font-bold">{t.sku}</strong>
                  </div>

                  {/* อันที่สาม: ชื่อสินค้า */}
                  <div className={`text-sm sm:text-base text-slate-800 font-semibold leading-snug line-clamp-2 ${!isAdmin && !isWaitingApproval ? "group-hover:text-emerald-700 transition-colors" : ""}`}>
                    {t.product_name}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="px-4 py-2 rounded-2xl bg-emerald-50 text-emerald-950 font-mono font-black text-base sm:text-xl border-2 border-emerald-200/90 shadow-2xs">
                    {t.qty.toLocaleString()} <span className="font-sans font-bold text-xs sm:text-sm text-emerald-700">ชิ้น</span>
                  </div>
                </div>
              </div>

              {/* Warehouse Route Card */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50/90 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2.5 font-black text-sm sm:text-base flex-wrap">
                  <span className="text-slate-800 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                    🏭 {t.from_warehouse_name}
                  </span>
                  <span className="text-emerald-600 font-black text-lg">➔</span>
                  <span className="text-emerald-900 bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-200 shadow-2xs font-black">
                    🎯 {t.to_warehouse_name}
                  </span>
                </div>
                <div className="text-xs sm:text-sm font-medium text-slate-600">
                  {stepConfig.detail}
                </div>
              </div>

              {/* Scanned Locations info if available */}
              {(t.from_location_id || t.to_location_id || (t.source_allocations && t.source_allocations.length > 0)) && (
                <div className="p-3 rounded-2xl bg-indigo-50/50 border border-indigo-100/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-700 font-bold">ตำแหน่งที่สแกนจริง:</span>
                    {t.source_allocations && t.source_allocations.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {t.source_allocations.map((a, idx) => (
                          <span key={idx} className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 font-mono text-xs font-bold text-slate-800">
                            ต้นทาง: 📍 {a.location_name || a.location_id} ({a.qty} ชิ้น)
                          </span>
                        ))}
                      </div>
                    ) : t.from_location_id ? (
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 font-mono text-xs font-bold text-slate-800">
                        ต้นทาง: 📍 {t.from_location_id}
                      </span>
                    ) : null}
                    <span className="text-indigo-600 font-black">➔</span>
                    {t.to_location_id && (
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-indigo-200 font-mono text-xs font-bold text-indigo-900">
                        ปลายทาง: 📍 {t.to_location_id}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons Row */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
                {isAdmin ? (
                  isWaitingApproval && onApproveTask ? (
                    <div className="w-full flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                        <span>พนักงานย้ายสินค้าเสร็จแล้ว รอ Admin อนุมัติ</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isCancelling || isApproving}
                          onClick={(e) => (onRejectTask ? onRejectTask(e, t) : onCancelTask(e, t))}
                          className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                        >
                          {isCancelling ? "กำลังปฏิเสธ..." : "ปฏิเสธ"}
                        </button>
                        <button
                          type="button"
                          disabled={isApproving || isCancelling}
                          onClick={() => onApproveTask(t)}
                          className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-1.5"
                        >
                          {isApproving ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>กำลังบันทึก...</span>
                            </>
                          ) : (
                            <>
                              <span>✓ อนุมัติการย้าย (บันทึกเข้าระบบ)</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span>พนักงานกำลังดำเนินการ</span>
                      </div>
                      <button
                        type="button"
                        disabled={isCancelling}
                        onClick={(e) => onCancelTask(e, t)}
                        className="px-3.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                      >
                        {isCancelling ? "กำลังยกเลิก..." : "ยกเลิกใบงาน"}
                      </button>
                    </>
                  )
                ) : (
                  isWaitingApproval ? (
                    <div className="w-full flex items-center justify-between">
                      <div className="text-xs text-amber-700 font-bold bg-amber-50 px-3 py-1 rounded-xl border border-amber-200 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                        <span>ย้ายสินค้าแล้ว (ส่งให้ Admin อนุมัติเรียบร้อยแล้ว)</span>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full flex justify-end">
                      <button
                        type="button"
                        onClick={() => onSelectTask(t)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs shadow-emerald-600/20 cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                      >
                        <span>{step === 0 ? "เริ่มย้ายสินค้า / สแกน" : "สแกนต่อ"}</span>
                        <span>➔</span>
                      </button>
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
