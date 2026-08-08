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
      <div className="glass-card rounded-2xl p-8 text-center border border-white/10 shadow-lg space-y-3">
        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-sm font-semibold text-slate-200">ไม่มีรายการโอนสินค้าที่รอดำเนินการ</div>
        <p className="text-xs text-slate-400">รายการโอนสินค้าใหม่จะแสดงที่นี่โดยอัตโนมัติ</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
          <h3 className="font-bold text-slate-100 text-sm sm:text-base">
            รายการโอนสินค้าที่รอดำเนินการ ({notifications.length})
          </h3>
        </div>

        {isAdmin && onCleanupHistory && (
          <button
            type="button"
            onClick={onCleanupHistory}
            disabled={isCleaningUp}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
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
              className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/90 hover:border-emerald-500/50 transition-all duration-200 shadow-md space-y-3 cursor-pointer group"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-mono font-bold text-xs border border-amber-500/30">
                      {t.doc_no}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(t.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>

                  <div className="font-bold text-white text-base group-hover:text-emerald-300 transition-colors">
                    {t.product_name}
                  </div>

                  <div className="text-xs text-slate-400 font-mono flex flex-wrap items-center gap-3">
                    <span>SKU: <strong className="text-slate-200">{t.sku}</strong></span>
                    {barcode && (
                      <span>บาร์โค้ด: <strong className="text-slate-200">{barcode}</strong></span>
                    )}
                  </div>
                </div>

                {barcode && (
                  <div className="p-1.5 bg-white rounded-xl shadow-sm border border-slate-200 shrink-0 hidden sm:block">
                    <BarcodeSvg value={barcode} height={32} showText={false} />
                  </div>
                )}
              </div>

              {/* Warehouse Route Details */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">จาก:</span>
                  <span className="font-semibold text-indigo-300">{t.from_warehouse_name}</span>
                  <span className="text-slate-500">➔</span>
                  <span className="text-slate-400">ไปยัง:</span>
                  <span className="font-semibold text-emerald-300">{t.to_warehouse_name}</span>
                </div>

                <div className="font-mono font-bold text-amber-400 text-sm">
                  จำนวน: {t.qty} ชิ้น
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-slate-400">
                  ผู้รับผิดชอบ: <strong className="text-slate-200">{t.moved_by || "พนักงาน"}</strong>
                </span>

                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={isCancelling}
                      onClick={(e) => onCancelTask(e, t)}
                      className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isCancelling ? "กำลังยกเลิก..." : "ยกเลิก"}
                    </button>
                  )}

                  <button
                    type="button"
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs shadow-md shadow-emerald-950/40 cursor-pointer transition-all active:scale-95"
                  >
                    เริ่มทำรายการย้าย ➔
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
