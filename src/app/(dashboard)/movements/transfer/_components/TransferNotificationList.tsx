"use client";

import React from "react";
import type { TransferNotification } from "@/lib/transfer-notification-utils";
import BarcodeSvg from "@/components/ui/BarcodeSvg";

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
  if (notifications.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center border border-slate-200/80 shadow-xl space-y-3">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-500">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-sm font-bold text-slate-800">ไม่มีรายการโอนสินค้าที่รอดำเนินการ</div>
        <p className="text-xs text-slate-500 font-medium">รายการโอนสินค้าใหม่จะแสดงที่นี่โดยอัตโนมัติ</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
          <h3 className="font-extrabold text-slate-800 text-sm sm:text-base">
            รายการโอนสินค้าที่รอดำเนินการ ({notifications.length})
          </h3>
        </div>

        {isAdmin && onCleanupHistory && (
          <button
            type="button"
            onClick={onCleanupHistory}
            disabled={isCleaningUp}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition-all cursor-pointer disabled:opacity-50"
          >
            {isCleaningUp ? "กำลังล้าง..." : "ล้างประวัติที่เสร็จแล้ว"}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {notifications.map((t) => {
          const barcode = t.barcode && t.barcode.trim() !== "-" ? t.barcode.trim() : "";
          const isCancelling = cancellingId === t.id;

          return (
            <div
              key={t.id}
              onClick={() => onSelectTask(t)}
              className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 hover:border-indigo-400 hover:shadow-md transition-all duration-150 space-y-3 cursor-pointer group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-mono font-bold text-xs border border-indigo-200/80">
                      {t.doc_no}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">
                      {new Date(t.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>

                  <h4 className="font-extrabold text-slate-900 text-base sm:text-lg group-hover:text-indigo-600 transition-colors line-clamp-1">
                    {t.product_name}
                  </h4>

                  <div className="text-xs text-slate-500 font-mono flex items-center gap-3">
                    <span>SKU: <strong className="text-slate-800 font-bold">{t.sku}</strong></span>
                    {barcode && <span>บาร์โค้ด: <strong className="text-slate-800 font-bold">{barcode}</strong></span>}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <span className="inline-block px-3 py-1 rounded-xl bg-indigo-50 text-indigo-800 font-mono font-extrabold text-sm sm:text-base border border-indigo-200/70">
                    {t.qty.toLocaleString()} ชิ้น
                  </span>
                </div>
              </div>

              {/* Warehouse Route Card */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 font-bold">
                  <span className="text-slate-600">{t.from_warehouse_name}</span>
                  <span className="text-slate-400">➔</span>
                  <span className="text-emerald-700">{t.to_warehouse_name}</span>
                </div>

                <span className="text-slate-500 text-[11px] truncate max-w-[140px]">
                  {t.moved_by || "พนักงาน"}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-0.5">
                {isAdmin && (
                  <button
                    type="button"
                    disabled={isCancelling}
                    onClick={(e) => onCancelTask(e, t)}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isCancelling ? "กำลังยกเลิก..." : "ยกเลิก"}
                  </button>
                )}

                <button
                  type="button"
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs shadow-indigo-600/20 cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                >
                  <span>เริ่มย้ายสินค้า</span>
                  <span>➔</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
