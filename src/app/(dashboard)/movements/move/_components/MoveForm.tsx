"use client";

import React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { MoveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import ProductSearchInput from "@/components/ui/ProductSearchInput";
import ScanFeedbackBanner, { type ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";

export interface MoveFormProps {
  form: UseFormReturn<MoveDocumentInput>;
  step: 1 | 2;
  setStep: (step: 1 | 2) => void;
  activeWhName: string;
  locations: Location[];
  products: Product[];
  selectedFromLoc?: Location;
  selectedToLoc?: Location;
  selectedProduct: Product | null;
  watchProduct: string;
  watchFromLocation: string;
  watchToLocation: string;
  watchQty: number;
  maxAvailableQty?: number | null;
  displayName: string;
  displaySku: string;
  displayBarcode: string;
  hasDistinctName: boolean;
  error: string;
  scanFeedback: ScanFeedback | null;
  onDismissScanFeedback?: () => void;
  onNextStep1: () => void;
  onNextStep2: () => void;
  onSubmit: (data: MoveDocumentInput) => void;
  onErrorPrompt: (msg: string) => void;
}

export default function MoveForm({
  form,
  step,
  setStep,
  activeWhName,
  locations,
  products,
  selectedFromLoc,
  selectedToLoc,
  selectedProduct,
  watchProduct,
  watchFromLocation,
  watchToLocation,
  watchQty,
  maxAvailableQty,
  displayName,
  displaySku,
  displayBarcode,
  hasDistinctName,
  error,
  scanFeedback,
  onDismissScanFeedback,
  onNextStep1,
  onNextStep2,
  onSubmit,
  onErrorPrompt,
}: MoveFormProps) {
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = form;

  return (
    <form
      onSubmit={handleSubmit(onSubmit, (formErrors) => {
        if (step === 1 && !watchProduct) {
          onErrorPrompt("กรุณายิงสแกนสินค้าก่อน");
        } else if (step === 2 && !watchToLocation) {
          onErrorPrompt("กรุณาสแกนตำแหน่งปลายทางก่อน");
        } else {
          const firstMsg = Object.values(formErrors)[0]?.message;
          onErrorPrompt(typeof firstMsg === "string" ? firstMsg : "กรุณากรอกข้อมูลให้ครบถ้วน");
        }
      })}
      className="space-y-4"
    >
      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl p-6 space-y-4 border border-slate-200/80 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="font-extrabold text-slate-800 text-lg sm:text-xl">{activeWhName}</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-slate-600 text-sm sm:text-base font-semibold">
              {form.watch("document_date")
                ? new Date(form.watch("document_date") + "T00:00:00").toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })
                : new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}
            </span>
            <input type="hidden" {...register("document_date")} />
          </div>
        </div>

        {/* Scan feedback banner */}
        <ScanFeedbackBanner feedback={scanFeedback} onDismiss={onDismissScanFeedback} />

        <input type="hidden" {...register("product_id")} />
        <input type="hidden" {...register("from_location_id")} />

        {/* STEP 1: Product Scan & Quantity */}
        {step === 1 && (
          <div className="space-y-4">
            {(selectedProduct || watchProduct) ? (
              <div className="py-3.5 px-4 rounded-2xl bg-emerald-50/80 border border-emerald-200/80 space-y-2.5 relative shadow-sm">
                <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
                  <span className="text-xs font-extrabold text-emerald-700">✓ สินค้าที่ยิงสแกนได้</span>
                  <button
                    type="button"
                    onClick={() => {
                      setValue("product_id", "");
                      setValue("qty", 1);
                    }}
                    className="text-xs text-rose-600 hover:text-rose-700 font-bold px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 transition-all cursor-pointer"
                  >
                    ✕ เปลี่ยนสินค้า / สแกนใหม่
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">รหัสสินค้า:</span>
                    <span className="font-mono font-bold text-slate-900 text-sm sm:text-base">
                      {displaySku || watchProduct}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">บาร์โค้ด:</span>
                    <span className="font-mono font-bold text-slate-900 text-sm sm:text-base">
                      {displayBarcode || "-"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">ตำแหน่งปัจจุบัน:</span>
                    <span className="font-mono font-extrabold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-lg border border-blue-200 text-xs sm:text-sm">
                      {selectedProduct?.location && selectedProduct.location !== "-" ? selectedProduct.location : (watchFromLocation || "ยังไม่ระบุ")}
                    </span>
                  </div>
                </div>
                {hasDistinctName && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">ชื่อสินค้า:</span>
                    <span className="font-bold text-slate-800 text-sm sm:text-base">{displayName}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-4 px-4 text-center space-y-1 bg-white border border-slate-200/90 rounded-2xl shadow-sm">
                <p className="text-sm font-bold text-slate-800">⚡ พร้อมยิงสแกนสินค้า</p>
                <p className="text-xs text-slate-500 font-medium">ยิงสแกนบาร์โค้ดสินค้าที่ช่องสแกนด้านบน</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                จำนวนที่ต้องการจัดวาง / ย้าย *
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  min="1"
                  placeholder="ระบุจำนวน..."
                  onFocus={(e) => (e.target as HTMLInputElement).select()}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  max={maxAvailableQty && maxAvailableQty > 0 ? maxAvailableQty : undefined}
                  {...register("qty", {
                    valueAsNumber: true,
                    onChange: (e) => {
                      const num = Number(e.target.value);
                      if (maxAvailableQty !== null && maxAvailableQty !== undefined && maxAvailableQty > 0) {
                        if (num > maxAvailableQty) {
                          setValue("qty", maxAvailableQty, { shouldValidate: true });
                        }
                      }
                    },
                  })}
                  onInput={(e: React.FormEvent<HTMLInputElement>) => {
                    const inputEl = e.currentTarget;
                    const num = Number(inputEl.value);
                    if (maxAvailableQty !== null && maxAvailableQty !== undefined && maxAvailableQty > 0) {
                      if (num > maxAvailableQty) {
                        inputEl.value = String(maxAvailableQty);
                        setValue("qty", maxAvailableQty, { shouldValidate: true });
                      }
                    }
                  }}
                  className={`w-full py-3 rounded-xl bg-white border border-slate-300 text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm sm:text-base font-mono font-bold outline-none ${
                    maxAvailableQty !== null && maxAvailableQty !== undefined
                      ? "pl-3 sm:pl-4 pr-28 sm:pr-36"
                      : "px-3 sm:px-4"
                  }`}
                />
                {maxAvailableQty !== null && maxAvailableQty !== undefined && (
                  <div className="absolute inset-y-0 right-1.5 sm:right-2 flex items-center pointer-events-none">
                    <span className="text-[10px] sm:text-xs font-extrabold text-indigo-700 bg-indigo-50 px-2 sm:px-2.5 py-1 rounded-lg border border-indigo-200 shadow-2xs font-sans">
                      คงเหลือ: {maxAvailableQty} ชิ้น
                    </span>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onNextStep1}
              className="w-full py-3 sm:py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all text-xs sm:text-sm cursor-pointer shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 active:scale-95"
            >
              <span>ถัดไป: สแกนตำแหน่งปลายทาง</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        )}

        {/* STEP 2: Destination Location / Shelf Scan */}
        {step === 2 && (
          <div className="space-y-4">
            <input type="hidden" {...register("to_location_id")} />
            <div className="p-3 sm:p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-500">
                <span className="font-semibold">สินค้าที่เลือก:</span>
                <span className="text-amber-600 font-extrabold text-xs sm:text-sm">จำนวน: {watchQty} ชิ้น</span>
              </div>
              <div className="text-xs sm:text-sm font-bold text-slate-900 font-mono">
                [{displaySku}]{hasDistinctName ? ` ${displayName}` : ""}
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 pt-1 border-t border-slate-100 text-slate-600 flex-wrap">
                <span className="font-bold text-slate-500">จากตำแหน่ง:</span>
                <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                  {selectedFromLoc?.location_code || watchFromLocation || selectedProduct?.location || "ไม่ระบุ"}
                </span>
                <span className="text-slate-400">➔</span>
                <span className="font-bold text-slate-500">ไปตำแหน่ง:</span>
                <span className="font-mono font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {selectedToLoc?.location_code || watchToLocation || "รอสแกน..."}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                2. สแกนบาร์โค้ด / QR Code ตำแหน่งปลายทาง *
              </label>
            </div>

            {selectedToLoc || watchToLocation ? (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-emerald-800 font-bold">✓ ตำแหน่งปลายทางที่ยิงสแกนได้:</span>
                  <span className="px-3.5 py-1 rounded-lg bg-emerald-600 text-white font-mono font-bold text-sm shadow-md">
                    {selectedToLoc?.location_code || watchToLocation}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-4 px-4 text-center space-y-1 bg-white border border-slate-200/90 rounded-2xl shadow-sm">
                <p className="text-sm font-bold text-slate-800">⚡ พร้อมยิงสแกนตำแหน่งปลายทาง</p>
                <p className="text-xs text-slate-500 font-medium">ยิงป้าย QR Code / บาร์โค้ดประจำชั้นวางหรือตำแหน่งปลายทางที่ช่องสแกนด้านบน</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-1/3 py-3.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm transition-all border border-slate-300 shadow-sm cursor-pointer flex items-center justify-center gap-1.5 active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>ย้อนกลับ</span>
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                id="move-submit"
                className="w-2/3 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold transition-all text-sm cursor-pointer shadow-lg shadow-emerald-600/20 active:scale-95"
              >
                {isSubmitting ? "กำลังบันทึก..." : "ยืนยันจัดตำแหน่งสินค้า"}
              </button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
