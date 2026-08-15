"use client";

import React, { useState } from "react";
import type { TransferNotification } from "@/lib/transfer-notification-utils";

export interface TransferNotificationListProps {
  notifications: TransferNotification[];
  isAdmin: boolean;
  onSelectTask: (task: TransferNotification) => void;
  onCancelTask: (e: React.MouseEvent, task: TransferNotification) => void;
  onCleanupHistory?: () => void;
  isCleaningUp?: boolean;
  cancellingId?: string | null;
}

export default function TransferNotificationList({
  notifications,
  isAdmin,
  onSelectTask,
  onCancelTask,
  onCleanupHistory,
  isCleaningUp = false,
  cancellingId = null,
}: TransferNotificationListProps) {
  const [filterStep, setFilterStep] = useState<"ALL" | "IN_PROGRESS" | "WAITING">("ALL");

  const inProgressList = notifications.filter((t) => (t.current_step || 0) >= 1 && (t.current_step || 0) <= 3);
  const waitingList = notifications.filter((t) => !t.current_step || t.current_step === 0);

  const displayedList =
    filterStep === "IN_PROGRESS"
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
      {/* Header with Real-time Status Badge & Summary Tabs */}
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

          {isAdmin && onCleanupHistory && (
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
            onClick={() => setFilterStep("IN_PROGRESS")}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              filterStep === "IN_PROGRESS"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>กำลังทำอยู่</span>
            <span className="px-1.5 py-0.2 rounded-md bg-black/15 text-[11px]">
              {inProgressList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStep("WAITING")}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              filterStep === "WAITING"
                ? "bg-amber-600 text-white shadow-xs"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200/80"
            }`}
          >
            <span>รอดำเนินการ</span>
            <span className="px-1.5 py-0.2 rounded-md bg-black/15 text-[11px]">
              {waitingList.length}
            </span>
          </button>
        </div>
      </div>

      {/* Task Cards List */}
      <div className="space-y-4">
        {displayedList.map((t) => {
          const barcode = t.barcode && t.barcode.trim() !== "-" ? t.barcode.trim() : "";
          const isCancelling = cancellingId === t.id;
          const step = t.current_step || 0; // 0 = Pending, 1 = Scan Prod, 2 = Source Pick, 3 = Dest Putaway, 4 = Done

          // Step badge config
          const stepConfig =
            step === 1
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
              : step === 3
              ? {
                  title: "กำลังนำเข้าปลายทาง",
                  detail: `พนักงานกำลังนำสินค้าไปสแกนจัดเก็บที่ ${t.to_warehouse_name}`,
                  color: "bg-purple-500 text-white border-purple-600",
                  badge: "bg-purple-50 text-purple-700 border-purple-200",
                  dot: "bg-purple-500",
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
                  detail: "มอบหมายงานแล้ว รอพนักงานกดเริ่มงาน",
                  color: "bg-slate-400 text-white border-slate-500",
                  badge: "bg-slate-100 text-slate-700 border-slate-200",
                  dot: "bg-slate-400",
                };

          return (
            <div
              key={t.id}
              onClick={!isAdmin ? () => onSelectTask(t) : undefined}
              className={`p-5 sm:p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm transition-all duration-200 space-y-4 relative overflow-hidden ${
                !isAdmin
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
                  {step > 0 && step <= 3 && (
                    <span className="font-mono text-[11px] opacity-80">({step}/3)</span>
                  )}
                </div>
              </div>

              {/* Product Info & Quantity Row */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 flex-1 min-w-0">
                  <h4 className={`font-extrabold text-slate-900 text-base sm:text-lg line-clamp-1 ${!isAdmin ? "group-hover:text-emerald-700 transition-colors" : ""}`}>
                    {t.product_name}
                  </h4>
                  <div className="text-xs text-slate-500 font-mono flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>SKU: <strong className="text-slate-800 font-bold">{t.sku}</strong></span>
                    {barcode && <span>บาร์โค้ด: <strong className="text-slate-800 font-bold">{barcode}</strong></span>}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 font-mono font-black text-sm sm:text-base border border-emerald-200/80">
                    {t.qty.toLocaleString()} <span className="font-sans font-normal text-xs text-emerald-600">ชิ้น</span>
                  </div>
                </div>
              </div>

              {/* Warehouse Route Card */}
              <div className="p-3 rounded-2xl bg-slate-50/80 border border-slate-100 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 font-bold">
                  <span className="text-slate-700 bg-white px-2.5 py-1 rounded-lg border border-slate-200/80 shadow-2xs">
                    🏭 {t.from_warehouse_name}
                  </span>
                  <span className="text-emerald-600 font-black">➔</span>
                  <span className="text-emerald-800 bg-emerald-100/60 px-2.5 py-1 rounded-lg border border-emerald-200/80 shadow-2xs font-extrabold">
                    🎯 {t.to_warehouse_name}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {stepConfig.detail}
                </div>
              </div>

              {/* 4-Step Realtime Visual Progress Bar */}
              <div className="pt-2 pb-1">
                <div className="relative flex items-center justify-between px-2 sm:px-6">
                  {/* Progress Line */}
                  <div className="absolute left-6 right-6 top-3.5 h-1 bg-slate-100 -z-0">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-500 ease-out rounded-full"
                      style={{
                        width:
                          step === 0
                            ? "0%"
                            : step === 1
                            ? "33%"
                            : step === 2
                            ? "66%"
                            : "100%",
                      }}
                    />
                  </div>

                  {/* Step 1: Assign */}
                  <div className="flex flex-col items-center gap-1 z-10">
                    <div className="w-7 h-7 rounded-full bg-emerald-600 text-white text-[11px] font-extrabold flex items-center justify-center shadow-xs">
                      ✓
                    </div>
                    <span className="text-[11px] font-bold text-slate-700">มอบหมาย</span>
                  </div>

                  {/* Step 2: Scan Product */}
                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-7 h-7 rounded-full text-[11px] font-extrabold flex items-center justify-center transition-all ${
                        step > 1
                          ? "bg-emerald-600 text-white shadow-xs"
                          : step === 1
                          ? "bg-sky-500 text-white ring-4 ring-sky-100 shadow-md scale-110"
                          : "bg-white text-slate-400 border-2 border-slate-200"
                      }`}
                    >
                      {step > 1 ? "✓" : "1"}
                    </div>
                    <span
                      className={`text-[11px] ${
                        step === 1 ? "font-extrabold text-sky-700" : step > 1 ? "font-bold text-emerald-700" : "text-slate-400 font-medium"
                      }`}
                    >
                      สแกนสินค้า
                    </span>
                  </div>

                  {/* Step 3: Pick Source */}
                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-7 h-7 rounded-full text-[11px] font-extrabold flex items-center justify-center transition-all ${
                        step > 2
                          ? "bg-emerald-600 text-white shadow-xs"
                          : step === 2
                          ? "bg-amber-500 text-white ring-4 ring-amber-100 shadow-md scale-110"
                          : "bg-white text-slate-400 border-2 border-slate-200"
                      }`}
                    >
                      {step > 2 ? "✓" : "2"}
                    </div>
                    <span
                      className={`text-[11px] ${
                        step === 2 ? "font-extrabold text-amber-700" : step > 2 ? "font-bold text-emerald-700" : "text-slate-400 font-medium"
                      }`}
                    >
                      หยิบต้นทาง
                    </span>
                  </div>

                  {/* Step 4: Putaway Dest */}
                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-7 h-7 rounded-full text-[11px] font-extrabold flex items-center justify-center transition-all ${
                        step >= 4
                          ? "bg-emerald-600 text-white shadow-xs"
                          : step === 3
                          ? "bg-purple-500 text-white ring-4 ring-purple-100 shadow-md scale-110"
                          : "bg-white text-slate-400 border-2 border-slate-200"
                      }`}
                    >
                      {step >= 4 ? "✓" : "3"}
                    </div>
                    <span
                      className={`text-[11px] ${
                        step === 3 ? "font-extrabold text-purple-700" : step >= 4 ? "font-bold text-emerald-700" : "text-slate-400 font-medium"
                      }`}
                    >
                      เข้าปลายทาง
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons Row */}
              <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
                {isAdmin ? (
                  <>
                    <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span>โหมดผู้ดูแล: แสดงผลสถานะแบบ Real-time เท่านั้น</span>
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
                ) : (
                  <div className="w-full flex justify-end">
                    <button
                      type="button"
                      onClick={() => onSelectTask(t)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs shadow-emerald-600/20 cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                    >
                      <span>{step === 0 ? "เริ่มทำงาน" : "สแกนต่อ"}</span>
                      <span>➔</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
