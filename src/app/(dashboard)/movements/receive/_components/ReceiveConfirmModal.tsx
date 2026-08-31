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
  const totalQty = watchLines.reduce((acc, curr) => acc + (Number(curr.qty) || 1), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-2xl space-y-4 sm:space-y-5 max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            <h3 className="font-extrabold text-slate-900 text-base sm:text-xl">ยืนยันการรับสินค้าเข้า</h3>
          </div>
          <button
            type="button"
            aria-label="ปิดหน้าต่าง"
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-xl hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          className="space-y-3.5 sm:space-y-4 flex-1 overflow-y-auto overscroll-y-contain pr-0.5"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="flex justify-between items-center p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200/90 shadow-2xs">
            <span className="text-slate-700 font-bold text-sm sm:text-base">โกดังปลายทาง:</span>
            <span className="font-extrabold text-emerald-800 text-base sm:text-lg">{activeWhName}</span>
          </div>

          <div className="space-y-3">
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
              const primaryQty = typeof (line as any).primary_qty === "number" && (line as any).primary_qty > 0
                ? (line as any).primary_qty
                : extraLocs.length > 0
                ? Math.max(1, (Number(line.qty) || 1) - extraQtys.reduce((sum, q) => sum + (Number(q) || 1), 0))
                : (Number(line.qty) || 1);

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

              const allLocs = locBreakdowns.join(" | ");

              return (
                <div key={`confirm-row-${idx}`} className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 shadow-2xs">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {(matched?.barcode && matched.barcode.trim() !== "-") ? (
                        <span className="font-mono text-sm sm:text-base font-black text-slate-950 tracking-wide">
                          {matched.barcode}
                        </span>
                      ) : (line as any).barcode ? (
                        <span className="font-mono text-sm sm:text-base font-black text-slate-950 tracking-wide">
                          {(line as any).barcode}
                        </span>
                      ) : null}
                      <span className="font-mono font-bold text-slate-600 truncate text-sm">
                        {matched?.sku || line.product_id}
                      </span>
                    </div>
                    <div className="text-slate-900 font-bold truncate text-sm sm:text-base">{matched?.product_name || "สินค้า"}</div>
                    <div className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-emerald-900 bg-emerald-100/90 border border-emerald-300/80 px-2.5 py-1 rounded-lg font-mono">
                      <svg className="w-3.5 h-3.5 text-emerald-700 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span>ตำแหน่ง: {allLocs}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-black text-emerald-700 text-base sm:text-lg">{(Number(line.qty) || 0).toLocaleString()} ชิ้น</div>
                    <div className="text-xs sm:text-sm text-slate-700 font-semibold">{(Number(line.boxes) || 1).toLocaleString()} กล่อง</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex justify-between items-center shadow-2xs">
            <span className="font-extrabold text-emerald-950 text-base sm:text-lg">รวมทั้งหมด:</span>
            <span className="font-black font-mono text-emerald-800 text-xl sm:text-2xl">{(totalQty || 0).toLocaleString()} ชิ้น</span>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          {/* Left Cancel button: Red background, solid white text */}
          <button
            type="button"
            onClick={onClose}
            className="w-1/3 py-3.5 sm:py-4 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-sm sm:text-base cursor-pointer transition-all shadow-md shadow-rose-600/20 active:scale-95"
            style={{ color: "#ffffff", backgroundColor: "#e11d48" }}
          >
            ยกเลิก
          </button>

          {/* Right Confirm button: Green gradient, solid white text */}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(onSubmit)()}
            className="w-2/3 py-3.5 sm:py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm sm:text-base shadow-md shadow-emerald-600/25 cursor-pointer transition-all disabled:opacity-50 active:scale-95"
            style={{ color: "#ffffff", backgroundColor: "#059669" }}
          >
            {isSubmitting ? "กำลังบันทึก..." : "ยืนยันและสร้างเอกสาร"}
          </button>
        </div>
      </div>
    </div>
  );
}
