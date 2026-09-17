"use client";

import { useEscapeKey } from "@/hooks/use-escape-key";
import { displayProductName, formatDateTime, formatQty, type TempStockCutRecord } from "./types";

interface HistoryModalProps {
  open: boolean;
  loading: boolean;
  records: TempStockCutRecord[];
  onClose: () => void;
}

export default function HistoryModal({ open, loading, records, onClose }: HistoryModalProps) {
  useEscapeKey(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#101828]/50 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ประวัติการตัดสต็อก"
        className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl border border-[#E8ECEA] shadow-[0_20px_60px_rgba(16,24,40,0.18)] max-h-[88dvh] flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-4 border-b border-[#F2F4F3]">
          <div>
            <h2 className="text-base font-bold text-[#06402B]">ประวัติการตัดสต็อก</h2>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">
              รายการตัดสต็อกชั่วคราวล่าสุดจากโกดัง2
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="shrink-0 grid place-items-center size-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-14 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[#0F5C3F] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500 font-medium">กำลังโหลดประวัติ...</p>
            </div>
          ) : records.length === 0 ? (
            <div className="py-14 flex flex-col items-center gap-2 text-center">
              <div className="size-12 rounded-2xl bg-[#F7FAF8] border border-[#E8F0EB] grid place-items-center">
                <svg className="w-5 h-5 text-[#6B9C85]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M12 7v5l4 2" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-600">ยังไม่มีประวัติการตัดสต็อก</p>
              <p className="text-xs text-slate-400">รายการตัดสต็อกชั่วคราวจะแสดงที่นี่</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {records.map((r) => {
                const isAdd = r.direction === "ADD";
                return (
                  <li
                    key={r.id}
                    className="rounded-xl border border-[#E8ECEA] bg-white px-4 py-3.5 hover:border-[#C8DBD1] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 leading-snug line-clamp-1">
                          {displayProductName(r)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400 font-medium">
                          {r.sku} • {r.cut_no}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${
                          isAdd ? "bg-[#E7F6EE] text-[#067647]" : "bg-[#FEF3F2] text-[#B42318]"
                        }`}
                      >
                        {isAdd ? "+" : "−"}{formatQty(r.quantity)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 font-medium">
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5">
                        {r.reason}
                      </span>
                      <span>
                        ยอด {formatQty(r.stock_before)} → {formatQty(r.stock_after)} ชิ้น
                      </span>
                    </div>
                    {r.note && (
                      <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">“{r.note}”</p>
                    )}
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      {formatDateTime(r.created_at)} • โดย {r.created_by_name}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
