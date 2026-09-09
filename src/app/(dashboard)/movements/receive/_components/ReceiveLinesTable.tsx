"use client";

import React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import ReceiveLineItem from "./ReceiveLineItem";
import type { ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";

export interface ReceiveLinesTableProps {
  form: UseFormReturn<ReceiveDocumentInput, any, any>;
  fields: { id: string; product_id: string; location_id?: string; boxes?: number; qty?: number }[];
  locations: Location[];
  products: Product[];
  activeWhId: string;
  confirmedLines: Record<number, boolean>;
  onToggleConfirm: (index: number) => void;
  onAddLocationForProduct: (index: number) => void;
  onRemove: (index: number) => void;
  onScanLocation: (index: number, code: string) => void;
  onScanFeedback?: (feedback: ScanFeedback | null) => void;
  onOpenConfirmModal: () => void;
}

const cardClass =
  "bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

export default function ReceiveLinesTable({
  form,
  fields,
  locations,
  products,
  activeWhId,
  confirmedLines,
  onToggleConfirm,
  onAddLocationForProduct,
  onRemove,
  onScanLocation,
  onScanFeedback,
  onOpenConfirmModal,
}: ReceiveLinesTableProps) {
  const watchLines = form.watch("lines") || [];
  const [showDone, setShowDone] = React.useState(false);

  const totalLines = fields.length;
  const totalBoxes = watchLines.reduce((acc, curr) => acc + (Number(curr.boxes) || 1), 0);
  const totalQty = watchLines.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);
  const confirmedCount = fields.filter((_, idx) => Boolean(confirmedLines[idx])).length;
  const hasZeroQty = watchLines.some((l) => (Number(l.qty) || 0) <= 0);
  const allConfirmed = totalLines > 0 && confirmedCount === totalLines && !hasZeroQty;

  // Split the list into the work-in-progress group (top) and a collapsed summary strip
  // for confirmed lines (bottom) so the card being worked on never scrolls out of view.
  // Form array order and indices stay untouched — grouping is render-level only.
  const activeIdxs = fields.map((_, i) => i).filter((i) => !confirmedLines[i]);
  const doneIdxs = fields.map((_, i) => i).filter((i) => Boolean(confirmedLines[i]));

  const renderLine = (index: number) => {
    // Queued only when this line is unconfirmed AND an earlier line is still
    // unconfirmed — confirmed lines never lock, so reordering is safe
    const isQueued =
      !confirmedLines[index] && fields.some((_, j) => j < index && !confirmedLines[j]);
    return (
      <ReceiveLineItem
        key={fields[index].id}
        index={index}
        fieldId={fields[index].id}
        form={form}
        line={fields[index]}
        locations={locations}
        products={products}
        activeWhId={activeWhId}
        isConfirmed={Boolean(confirmedLines[index])}
        isLocked={isQueued}
        onToggleConfirm={onToggleConfirm}
        onAddLocationForProduct={onAddLocationForProduct}
        onRemove={onRemove}
        onScanLocation={onScanLocation}
        onScanFeedback={onScanFeedback}
      />
    );
  };

  if (totalLines === 0) {
    return (
      <div className={`${cardClass} p-8 text-center space-y-3`}>
        <div className="w-14 h-14 rounded-2xl bg-[#EAF2EE] border border-[#DFEDE6] flex items-center justify-center mx-auto text-[#053425]">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <h3 className="text-base font-bold text-slate-900">ยังไม่มีรายการสินค้า</h3>
        <p className="text-sm text-[#667085]">
          ยิงบาร์โค้ดที่กล่องสินค้าในช่องสแกนด้านบน
          (หรือกดปุ่มกล้องเพื่อสแกนด้วยมือถือ) — รายการจะขึ้นที่นี่ทันที
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <div className={`${cardClass} p-3 sm:p-4`}>
          <div className="text-[13px] sm:text-sm text-[#667085] font-semibold leading-tight">รายการ</div>
          <div className="disp num text-xl sm:text-2xl font-bold text-[#111827] leading-tight">
            {totalLines.toLocaleString()}
          </div>
        </div>

        <div className={`${cardClass} p-3 sm:p-4`}>
          <div className="text-[13px] sm:text-sm text-[#667085] font-semibold leading-tight">กล่องรวม</div>
          <div className="disp num text-xl sm:text-2xl font-bold text-[#111827] leading-tight">
            {totalBoxes.toLocaleString()}
          </div>
        </div>

        <div className={`${cardClass} p-3 sm:p-4`}>
          <div className="text-[13px] sm:text-sm text-[#667085] font-semibold leading-tight">จำนวนรวม</div>
          <div className="disp num text-xl sm:text-2xl font-bold text-[#053425] leading-tight">
            {totalQty.toLocaleString()}
            <span className="text-sm font-bold text-[#667085] ml-1">ชิ้น</span>
          </div>
        </div>
      </div>

      <div className="px-1 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#667085] font-semibold">ยืนยันแล้ว</span>
          <span className={`font-bold shrink-0 ${allConfirmed ? "text-[#053425]" : "text-slate-900"}`}>
            {confirmedCount.toLocaleString()}/{totalLines.toLocaleString()}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-black/[.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#06402B] transition-[width] duration-300"
            style={{ width: `${totalLines > 0 ? (confirmedCount / totalLines) * 100 : 0}%` }}
          />
        </div>
        {confirmedCount === totalLines && hasZeroQty && (
          <p className="text-sm font-bold text-amber-700 pt-0.5">มีรายการที่จำนวนเป็น 0 — ระบุจำนวนก่อนบันทึก</p>
        )}
      </div>

      {activeIdxs.length > 0 && (
        <div className="space-y-3">{activeIdxs.map(renderLine)}</div>
      )}

      {doneIdxs.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowDone((prev) => !prev)}
            aria-expanded={showDone}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-[#EAF2EE] hover:bg-[#DFEDE6] border border-[#C9DFD4] text-[#053425] font-bold text-sm cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-5 h-5 rounded-full bg-[#06402B] text-white flex items-center justify-center shrink-0">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" />
                </svg>
              </span>
              ยืนยันแล้ว {doneIdxs.length.toLocaleString()} รายการ
            </span>
            <svg
              className={`w-5 h-5 shrink-0 transition-transform duration-200 ${showDone ? "rotate-180" : "rotate-0"}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showDone && (
            <div className="space-y-3 fade-in">{doneIdxs.map(renderLine)}</div>
          )}
        </div>
      )}

      {allConfirmed && (
        <div className="pt-2 fade-in">
          <button
            type="button"
            onClick={onOpenConfirmModal}
            className="w-full py-4 px-6 rounded-xl font-bold text-base sm:text-lg bg-[#06402B] hover:bg-[#053425] text-white shadow-lg shadow-[#06402B]/25 active:scale-[.98] cursor-pointer transition-transform flex items-center justify-center gap-2.5"
          >
            <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            <span>บันทึกรับสินค้า {totalQty.toLocaleString()} ชิ้น</span>
          </button>
        </div>
      )}
    </div>
  );
}
