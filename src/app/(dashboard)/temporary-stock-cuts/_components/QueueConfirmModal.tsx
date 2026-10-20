"use client";

import { useEscapeKey } from "@/hooks/use-escape-key";
import { displayProductName, formatQty, type CutQueueItem } from "./types";

interface QueueConfirmModalProps {
  open: boolean;
  items: CutQueueItem[];
  submitting: boolean;
  serverError?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export default function QueueConfirmModal({
  open,
  items,
  submitting,
  serverError,
  onClose,
  onConfirm,
}: QueueConfirmModalProps) {
  useEscapeKey(open && !submitting, onClose);

  if (!open) return null;

  const cutQty = items.filter((it) => it.direction !== "ADD").reduce((s, it) => s + it.quantity, 0);
  const addQty = items.filter((it) => it.direction === "ADD").reduce((s, it) => s + it.quantity, 0);
  const summaryParts: string[] = [];
  if (cutQty > 0) summaryParts.push(`ตัด ${formatQty(cutQty)} ชิ้น`);
  if (addQty > 0) summaryParts.push(`เพิ่ม ${formatQty(addQty)} ชิ้น`);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-m3-grey-800/50 "
        onClick={() => !submitting && onClose()}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ยืนยันการตัดสต็อก"
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-xl border border-[rgba(145,158,171,0.2)] shadow-m3-dropdown max-h-[88dvh] flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[rgba(145,158,171,0.2)]">
          <div>
            <h2 className="text-base font-bold text-m3-primary-dark">ยืนยันการทำรายการ</h2>
            <p className="mt-0.5 text-xs text-m3-grey-600 font-medium">
              {items.length} รายการ • {summaryParts.join(" • ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            aria-label="ปิด"
            className="shrink-0 grid place-items-center size-8 rounded-lg text-m3-grey-500 hover:text-m3-grey-600 hover:bg-m3-grey-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {items.map((it, i) => {
            const isAdd = it.direction === "ADD";
            return (
              <div
                key={`${it.product.sku}-${i}`}
                className="flex items-start justify-between gap-3 rounded-xl border border-[rgba(145,158,171,0.2)] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-m3-grey-800 leading-snug line-clamp-2">
                    {displayProductName(it.product)}
                  </p>
                  <p className="mt-1 text-[11px] text-m3-grey-500 font-medium">
                    {it.product.sku} • {it.reason}
                    {it.note ? ` • ${it.note}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-base font-bold num ${
                    isAdd ? "text-m3-primary-dark" : "text-m3-error-dark"
                  }`}
                >
                  {isAdd ? "+" : "−"}{formatQty(it.quantity)}
                </span>
              </div>
            );
          })}

          {serverError && (
            <div className="flex items-start gap-2.5 rounded-xl bg-[rgba(255,86,48,0.08)] border border-[rgba(255,86,48,0.24)] px-3.5 py-3 animate-in fade-in duration-150">
              <svg className="w-4 h-4 mt-0.5 shrink-0 text-m3-error-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
              <span className="text-sm font-semibold text-m3-error-dark leading-relaxed">{serverError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 px-6 py-4 border-t border-[rgba(145,158,171,0.2)]">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl border border-[rgba(145,158,171,0.2)] bg-white text-sm font-semibold text-m3-grey-600 hover:bg-m3-grey-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || items.length === 0}
            className="flex-[1.4] py-2.5 rounded-xl bg-m3-primary text-sm font-semibold text-white hover:bg-m3-primary-dark active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting && (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {submitting ? "กำลังบันทึก..." : `ยืนยันทั้งหมด (${items.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
