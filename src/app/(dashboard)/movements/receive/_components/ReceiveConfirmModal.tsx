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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
            <h3 className="font-bold text-slate-100 text-lg">ยืนยันการรับสินค้าเข้า</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="flex justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400">โกดังปลายทาง:</span>
            <span className="font-bold text-white text-sm">{activeWhName}</span>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
            {watchLines.map((line, idx) => {
              const matched = products.find(
                (p) =>
                  p.product_id.toLowerCase() === line.product_id.toLowerCase() ||
                  p.sku.toLowerCase() === line.product_id.toLowerCase()
              );
              const loc = locations.find((l) => l.location_code === line.location_id || l.location_id === line.location_id);
              const locDisplay = loc?.location_code || line.location_id || "ตำแหน่งเริ่มต้น";

              return (
                <div key={`confirm-row-${idx}`} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-mono font-bold text-white truncate">{matched?.sku || line.product_id}</div>
                    <div className="text-slate-400 truncate">{matched?.product_name || "สินค้า"}</div>
                    <div className="text-[10px] text-indigo-400">ตำแหน่ง: {locDisplay}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-amber-400 text-sm">{line.qty} ชิ้น</div>
                    <div className="text-[10px] text-slate-500">{line.boxes || 1} กล่อง</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex justify-between items-center text-sm">
            <span className="font-semibold text-emerald-300">รวมทั้งหมด:</span>
            <span className="font-bold font-mono text-emerald-400 text-base">{totalQty} ชิ้น</span>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-1/3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs cursor-pointer transition-all"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(onSubmit)()}
            className="w-2/3 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/40 cursor-pointer transition-all disabled:opacity-50"
          >
            {isSubmitting ? "กำลังบันทึก..." : "ยืนยันและสร้างเอกสาร"}
          </button>
        </div>
      </div>
    </div>
  );
}
