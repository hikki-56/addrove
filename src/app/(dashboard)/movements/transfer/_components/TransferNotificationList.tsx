"use client";

import React from "react";
import type { TransferNotification } from "@/lib/transfer-notification-utils";

export interface TransferNotificationListProps {
  notifications: TransferNotification[];
  isAdmin: boolean;
  onSelectTask: (task: TransferNotification) => void;
  onCancelTask?: (e: React.MouseEvent, task: TransferNotification) => void;
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
  if (notifications.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 sm:p-10 text-center border border-slate-200 shadow-xs space-y-3">
        <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-700">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <div className="text-base sm:text-lg font-bold text-slate-900">ไม่มีรายการงานที่กำลังดำเนินการในขณะนี้</div>
          <p className="text-sm text-slate-600 font-medium mt-1 max-w-md mx-auto">
            เมื่อมีการสร้างใบเบิกสินค้า ระบบจะแสดงรายการที่ต้องดำเนินการที่นี่ทันที
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Task Cards List */}
      <div className="space-y-3.5">
        {notifications.map((t) => {
          const barcode = t.barcode && t.barcode.trim() !== "-" ? t.barcode.trim() : "";
          const isCancelling = cancellingId === t.id;
          const isApproving = approvingId === t.id;
          const isWaitingApproval = t.status === "WAITING_APPROVAL";
          const step = t.current_step || 0; // 0 = Pending, 1 = Scan Prod, 2 = Source Pick, 3 = Dest Putaway, 4 = Done

          // Step badge config
          const stepConfig = isWaitingApproval
            ? {
                title: "เบิกแล้ว (รอ Admin อนุมัติ)",
                detail: "",
                badge: "bg-amber-50 text-amber-900 border-amber-300",
                dot: "bg-amber-500",
              }
            : step === 1
            ? {
                title: "กำลังสแกนสินค้า",
                detail: "พนักงานกำลังสแกนบาร์โค้ดสินค้าบนตัวสินค้า",
                badge: "bg-sky-50 text-sky-700 border-sky-200",
                dot: "bg-sky-500",
              }
            : step === 2
            ? {
                title: "กำลังหยิบสินค้าต้นทาง",
                detail: `พนักงานกำลังสแกนตำแหน่งและหยิบของใน ${t.from_warehouse_name}`,
                badge: "bg-amber-50 text-amber-700 border-amber-200",
                dot: "bg-amber-500",
              }
            : step === 3
            ? {
                title: "กำลังสแกนตำแหน่งปลายทาง",
                detail: `พนักงานกำลังนำสินค้าเข้าตำแหน่งปลายทางใน ${t.to_warehouse_name}`,
                badge: "bg-indigo-50 text-indigo-700 border-indigo-200",
                dot: "bg-indigo-500",
              }
            : step >= 4
            ? {
                title: "เบิกสินค้าสำเร็จ",
                detail: "ตัดสต็อกต้นทางและนำส่งปลายทางแล้ว",
                badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
                dot: "bg-emerald-500",
              }
            : {
                title: "รอดำเนินการ (ยังไม่เริ่ม)",
                detail: "สร้างใบงานแล้ว รอพนักงานกดเริ่มงาน",
                badge: "bg-slate-50 text-slate-700 border-slate-200",
                dot: "bg-slate-500",
              };

          return (
            <div
              key={t.id}
              onClick={!isAdmin && !isWaitingApproval ? () => onSelectTask(t) : undefined}
              className={`p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-xs transition-all duration-150 space-y-3.5 relative min-w-0 max-w-full overflow-hidden ${
                !isAdmin && !isWaitingApproval
                  ? "cursor-pointer hover:border-emerald-500 hover:shadow-md group"
                  : "cursor-default"
              }`}
            >
              {/* Top Row: Staff Assigned & Realtime Live Status Badge */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 shadow-2xs">
                    <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-800 font-mono font-bold text-xs sm:text-sm border border-slate-200">
                        {t.doc_no}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 font-medium mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>สร้างเมื่อ: {new Date(t.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.</span>
                    </div>
                  </div>
                </div>

                {/* Live Current Step Badge */}
                <div className={`px-3 py-1 rounded-full border flex items-center gap-1.5 font-bold text-xs sm:text-sm ${stepConfig.badge}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${stepConfig.dot}`} />
                  <span>{stepConfig.title}</span>
                  {step > 0 && step < 3 && (
                    <span className="font-mono text-xs opacity-85">({step}/3)</span>
                  )}
                </div>
              </div>

              {/* Product Info & Quantity Row */}
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1 min-w-0">
                  {/* Barcode */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-lg shrink-0">
                      บาร์โค้ด
                    </span>
                    <span className="font-mono font-bold text-base sm:text-lg text-slate-900 tracking-wide truncate">
                      {barcode || t.sku}
                    </span>
                  </div>

                  {/* SKU */}
                  <div className="text-sm text-slate-600 font-mono flex items-center gap-2">
                    <span>SKU:</span>
                    <strong className="text-slate-900 font-bold">{t.sku}</strong>
                  </div>

                  {/* Product Title */}
                  <div className={`text-sm sm:text-base text-slate-900 font-bold leading-normal line-clamp-2 ${!isAdmin && !isWaitingApproval ? "group-hover:text-emerald-800 transition-colors" : ""}`}>
                    {t.product_name}
                  </div>
                </div>

                {/* Quantity Badge */}
                <div className="shrink-0 text-right">
                  <div className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 font-mono font-bold text-sm sm:text-base border border-emerald-200">
                    {t.qty.toLocaleString()} <span className="font-sans font-bold text-xs sm:text-sm text-emerald-700">ชิ้น</span>
                  </div>
                </div>
              </div>

              {/* Warehouse Route Bar */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs sm:text-sm">
                <div className="flex items-center gap-2 font-bold">
                  <span className="text-slate-800 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                    {t.from_warehouse_name}
                  </span>
                  <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <span className="text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 font-bold">
                    {t.to_warehouse_name}
                  </span>
                </div>
                <div className="text-xs text-slate-600 font-medium">
                  {stepConfig.detail}
                </div>
              </div>

              {/* Scanned Locations info if available */}
              {(t.from_location_id || t.to_location_id || (t.source_allocations && t.source_allocations.length > 0)) && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-600 font-bold">ตำแหน่งที่สแกนจริง:</span>
                    {t.source_allocations && t.source_allocations.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {t.source_allocations.map((a, idx) => (
                          <span key={idx} className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 font-mono text-xs text-slate-800 font-bold">
                            ต้นทาง: {a.location_name || a.location_id} ({a.qty.toLocaleString()} ชิ้น)
                          </span>
                        ))}
                      </div>
                    ) : t.from_location_id ? (
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 font-mono text-xs text-slate-800 font-bold">
                        ต้นทาง: {t.from_location_id}
                      </span>
                    ) : null}
                    <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    {t.to_location_id && (
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-emerald-200 font-mono text-xs text-emerald-800 font-bold">
                        ปลายทาง: {t.to_location_id}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons Row */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-slate-100">
                {isWaitingApproval ? (
                  isAdmin && onApproveTask ? (
                    <div className="w-full flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-[200px]">
                        <div className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-amber-500" />
                          <span>พนักงานเบิกสินค้าเรียบร้อยแล้ว รอ Admin อนุมัติ</span>
                        </div>
                        {/* Creator & Performer info */}
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                            <span className="text-slate-500">ผู้สร้างใบเบิก:</span>
                            <strong className="text-slate-900 font-bold">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</strong>
                          </span>
                          {(t.moved_by || t.assigned_to_name) && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-50 text-indigo-900 border border-indigo-200 font-medium">
                              <span className="text-indigo-600 font-bold">ผู้เบิกสินค้า:</span>
                              <strong className="text-indigo-950 font-bold">{t.moved_by || t.assigned_to_name}</strong>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 font-mono">
                            เวลาเบิก: {new Date(t.last_active_at || t.created_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} น.
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isCancelling || isApproving}
                          onClick={(e) => (onRejectTask ? onRejectTask(e, t) : onCancelTask?.(e, t))}
                          className="px-4 py-2.5 rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                        >
                          {isCancelling ? "กำลังปฏิเสธ..." : "ปฏิเสธ"}
                        </button>
                        <button
                          type="button"
                          disabled={isApproving || isCancelling}
                          onClick={() => onApproveTask?.(t)}
                          className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-2"
                        >
                          {isApproving ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>กำลังบันทึก...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              <span>อนุมัติการเบิก</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-xs sm:text-sm text-amber-900 font-bold bg-amber-50 px-3 py-1 rounded-lg border border-amber-200 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-amber-500" />
                          <span>เบิกสินค้าแล้ว (ส่งให้ Admin อนุมัติเรียบร้อยแล้ว)</span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium">
                          <span>ผู้สร้าง:</span>
                          <strong className="text-slate-900 font-bold">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</strong>
                        </span>
                      </div>
                      {isAdmin && onCancelTask && (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={(e) => onCancelTask(e, t)}
                          className="px-4 py-2 rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-1.5"
                        >
                          {isCancelling ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
                              <span>กำลังยกเลิก...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              <span>ยกเลิกรายการ</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <div className="w-full flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap text-xs sm:text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 font-medium text-xs">
                        <span>ผู้สร้าง:</span>
                        <strong className="text-slate-900 font-bold">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isAdmin && onCancelTask && (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={(e) => onCancelTask(e, t)}
                          className="px-4 py-2 rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-1.5"
                        >
                          {isCancelling ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
                              <span>กำลังยกเลิก...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              <span>ยกเลิก</span>
                            </>
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onSelectTask(t)}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                      >
                        <span>{step === 0 ? "เริ่มเบิกสินค้า / สแกน" : "สแกนต่อ"}</span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
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
