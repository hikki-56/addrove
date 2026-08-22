"use client";

import React from "react";
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
  if (!isOpen) return null;

  const { watch, handleSubmit, formState: { isSubmitting } } = form;
  const watchLines = watch("lines") || [];
  const totalQty = watchLines.reduce((acc, curr) => acc + (Number(curr.qty) || 1), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-2xl space-y-4 sm:space-y-5 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-emerald-500 animate-ping" />
            <h3 className="font-extrabold text-slate-900 text-sm sm:text-lg">ยืนยันการรับสินค้าเข้า</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 sm:space-y-3.5 text-xs flex-1 overflow-y-auto">
          <div className="flex justify-between items-center p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 shadow-2xs">
            <span className="text-slate-600 font-bold text-xs sm:text-sm">โกดังปลายทาง:</span>
            <span className="font-extrabold text-emerald-700 text-sm sm:text-base">{activeWhName}</span>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1">
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
                locBreakdowns.push(`${locDisplay} (${primaryQty} ชิ้น)`);
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
                  locBreakdowns.push(`${elocDisplay} (${eqty} ชิ้น)`);
                }
              } else {
                locBreakdowns.push(locDisplay);
              }

              const allLocs = locBreakdowns.join(" | ");

              return (
                <div key={`confirm-row-${idx}`} className="p-3.5 rounded-2xl bg-slate-50/90 border border-slate-200/90 flex items-center justify-between gap-3 shadow-2xs">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {(matched?.barcode && matched.barcode.trim() !== "-") ? (
                        <span className="font-mono text-xs sm:text-base font-black text-slate-900 tracking-wide">
                          {matched.barcode}
                        </span>
                      ) : (line as any).barcode ? (
                        <span className="font-mono text-xs sm:text-base font-black text-slate-900 tracking-wide">
                          {(line as any).barcode}
                        </span>
                      ) : null}
                      <span className="font-mono font-bold text-slate-500 truncate text-xs sm:text-sm">
                        {matched?.sku || line.product_id}
                      </span>
                    </div>
                    <div className="text-slate-700 font-bold truncate text-xs">{matched?.product_name || "สินค้า"}</div>
                    <div className="inline-block text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md font-mono">
                      📍 ตำแหน่ง: {allLocs}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-extrabold text-emerald-600 text-sm sm:text-base">{line.qty} ชิ้น</div>
                    <div className="text-[11px] text-slate-500 font-medium">{line.boxes || 1} กล่อง</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 rounded-2xl bg-emerald-50/90 border border-emerald-200 flex justify-between items-center shadow-2xs">
            <span className="font-extrabold text-emerald-900 text-sm">รวมทั้งหมด:</span>
            <span className="font-extrabold font-mono text-emerald-700 text-lg sm:text-xl">{totalQty} ชิ้น</span>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          {/* Left Cancel button: Red background, solid white text */}
          <button
            type="button"
            onClick={onClose}
            className="w-1/3 py-3 rounded-2xl bg-rose-600 hover:bg-rose-700 !text-white font-extrabold text-xs sm:text-sm cursor-pointer transition-all shadow-md shadow-rose-600/20"
            style={{ color: "#ffffff", backgroundColor: "#e11d48" }}
          >
            ยกเลิก
          </button>

          {/* Right Confirm button: Green gradient, solid white text */}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(onSubmit)()}
            className="w-2/3 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 !text-white font-extrabold text-xs sm:text-sm shadow-md shadow-emerald-600/25 cursor-pointer transition-all disabled:opacity-50"
            style={{ color: "#ffffff", backgroundColor: "#059669" }}
          >
            {isSubmitting ? "กำลังบันทึก..." : "ยืนยันและสร้างเอกสาร"}
          </button>
        </div>
      </div>
    </div>
  );
}
