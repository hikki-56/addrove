"use client";

import React from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";

export interface ReceiveConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: UseFormReturn<ReceiveDocumentInput, any, any>;
  locations: Location[];
  products: Product[];
  activeWhName: string;
  onSubmit: (data: ReceiveDocumentInput) => void;
}

export default function ReceiveConfirmModal({
  isOpen,
  onClose,
  form,
  locations,
  products,
  activeWhName,
  onSubmit,
}: ReceiveConfirmModalProps) {
  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  const { watch, handleSubmit, formState: { isSubmitting } } = form;
  const watchLines = watch("lines") || [];
  const totalQty = watchLines.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs fade-in">
      <div className="w-full max-w-lg bg-white rounded-[20px] border border-[#E8ECEA] shadow-xl p-4 sm:p-6 space-y-4 max-h-[90dvh] flex flex-col scale-in">
        <div className="flex items-center justify-between border-b border-[#EEF1EF] pb-3 shrink-0">
          <h3 className="font-extrabold text-[#111827] text-lg sm:text-xl leading-tight">ยืนยันการรับสินค้าเข้า</h3>
          <button
            type="button"
            aria-label="ปิดหน้าต่าง"
            onClick={onClose}
            className="w-11 h-11 shrink-0 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-xl hover:bg-black/[.04] cursor-pointer transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          className="space-y-3 flex-1 overflow-y-auto overscroll-y-contain pr-0.5"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="flex justify-between items-center p-3.5 rounded-2xl bg-black/[.015] border border-[#E8ECEA]">
            <span className="text-slate-700 font-bold text-sm">โกดังปลายทาง</span>
            <span className="inline-flex items-center gap-1.5 font-extrabold text-[#052B1F] text-base">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
              {activeWhName}
            </span>
          </div>

          <div className="space-y-2.5">
            {watchLines.map((line, idx) => {
              const matched = products.find(
                (p) =>
                  p.product_id.toLowerCase() === line.product_id.toLowerCase() ||
                  p.sku.toLowerCase() === line.product_id.toLowerCase()
              );
              const loc = locations.find(
                (l) =>
                  ((l as any).shelf_code || "").toLowerCase() === (line.location_id || "").toLowerCase() ||
                  (l.location_code || "").toLowerCase() === (line.location_id || "").toLowerCase() ||
                  (l.location_id || "").toLowerCase() === (line.location_id || "").toLowerCase()
              );
              const locDisplay =
                ((loc as any)?.shelf_code && (loc as any).shelf_code.toLowerCase() === (line.location_id || "").toLowerCase())
                  ? (loc as any).shelf_code
                  : (loc?.location_code && loc.location_code.toLowerCase() === (line.location_id || "").toLowerCase())
                  ? loc.location_code
                  : line.location_id || loc?.location_code || "ตำแหน่งเริ่มต้น";

              const extraLocs: string[] = Array.isArray((line as any).extra_locations)
                ? (line as any).extra_locations.filter((x: string) => Boolean(x && x.trim()))
                : [];
              const extraQtys: number[] = Array.isArray((line as any).extra_qtys) ? (line as any).extra_qtys : [];
              const primaryQty = typeof (line as any).primary_qty === "number"
                ? (line as any).primary_qty
                : extraLocs.length > 0
                ? Math.max(0, (Number(line.qty) || 0) - extraQtys.reduce((sum, q) => sum + (Number(q) || 1), 0))
                : Number(line.qty) || 0;

              const locBreakdowns: string[] = [];
              if (extraLocs.length > 0) {
                locBreakdowns.push(`${locDisplay} (${primaryQty.toLocaleString()} ชิ้น)`);
                for (let i = 0; i < extraLocs.length; i++) {
                  const eloc = extraLocs[i];
                  const eqty = extraQtys[i] || 1;
                  const matchedExtra = locations.find(
                    (l) =>
                      ((l as any).shelf_code || "").toLowerCase() === eloc.toLowerCase() ||
                      (l.location_code || "").toLowerCase() === eloc.toLowerCase()
                  );
                  const elocDisplay = (matchedExtra as any)?.shelf_code && (matchedExtra as any).shelf_code.toLowerCase() === eloc.toLowerCase()
                    ? (matchedExtra as any).shelf_code
                    : matchedExtra?.location_code && matchedExtra.location_code.toLowerCase() === eloc.toLowerCase()
                    ? matchedExtra.location_code
                    : eloc;
                  locBreakdowns.push(`${elocDisplay} (${eqty.toLocaleString()} ชิ้น)`);
                }
              } else {
                locBreakdowns.push(locDisplay);
              }

              return (
                <div key={`confirm-row-${idx}`} className="p-3.5 rounded-2xl bg-black/[.015] border border-[#E8ECEA] flex items-start justify-between gap-3">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {(matched?.barcode && matched.barcode.trim() !== "-") ? (
                        <span className="font-mono text-sm sm:text-base font-bold text-[#111827] tracking-wide">
                          {matched.barcode}
                        </span>
                      ) : (line as any).barcode ? (
                        <span className="font-mono text-sm sm:text-base font-bold text-[#111827] tracking-wide">
                          {(line as any).barcode}
                        </span>
                      ) : null}
                      <span className="font-mono font-semibold text-sm text-[#667085] truncate">
                        {matched?.sku || line.product_id}
                      </span>
                    </div>
                    <div className="text-slate-900 font-bold text-sm sm:text-base">{matched?.product_name || "สินค้า"}</div>
                    <div className="flex items-start gap-1.5 flex-wrap">
                      {locBreakdowns.map((bd, bdIdx) => (
                        <span
                          key={`loc-${idx}-${bdIdx}`}
                          className="inline-flex items-center gap-1 text-[13px] font-bold text-[#053425] bg-[#EAF2EE] border border-[#DFEDE6] px-2 py-0.5 rounded-lg font-mono"
                        >
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span>{bd}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-baseline gap-1 justify-end">
                      <span className="disp num font-bold text-[#053425] text-lg sm:text-xl">{(Number(line.qty) || 0).toLocaleString()}</span>
                      <span className="text-sm font-bold text-slate-700">ชิ้น</span>
                    </div>
                    <div className="text-sm text-[#667085] font-semibold">{(Number(line.boxes) || 1).toLocaleString()} กล่อง</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 rounded-2xl bg-[#EAF2EE] border border-[#C9DFD4] flex justify-between items-center">
            <span className="font-extrabold text-[#04231A] text-base sm:text-lg">รวมทั้งหมด</span>
            <span className="flex items-baseline gap-1.5">
              <span className="disp num font-bold text-[#052B1F] text-2xl">{(totalQty || 0).toLocaleString()}</span>
              <span className="font-bold text-[#052B1F] text-base">ชิ้น</span>
            </span>
          </div>
        </div>

        <div className="space-y-2.5 pt-1 shrink-0">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(onSubmit)()}
            className="w-full py-4 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-base shadow-lg shadow-[#06402B]/25 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[.98] flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                <span>กำลังบันทึก...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span>ยืนยันและสร้างเอกสาร</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-full min-h-11 rounded-xl bg-white border border-black/10 text-slate-700 font-bold text-sm hover:bg-black/[.04] transition-colors cursor-pointer disabled:opacity-50"
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}
