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
          const firstMsg = Object.values(formErrors)[0]?.message;
          onErrorPrompt(typeof firstMsg === "string" ? firstMsg : "กรุณากรอกข้อมูลให้ครบถ้วน");
        }
      })}
      className="space-y-4"
    >
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl p-4 sm:p-6 space-y-4 border border-slate-200/80 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="font-extrabold text-slate-800 text-lg sm:text-xl">{activeWhName}</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
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
              <div className="py-4 px-4 sm:px-5 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-3 relative shadow-xs">
                <div className="flex items-center justify-between border-b border-emerald-200/80 pb-2.5">
                  <span className="text-sm font-extrabold text-emerald-800">✓ สินค้าที่ยิงสแกนได้</span>
                  <button
                    type="button"
                    onClick={() => {
                      setValue("product_id", "");
                      setValue("qty", 1);
                    }}
                    className="text-sm text-rose-700 hover:text-rose-900 font-bold px-3 py-1 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 transition-all cursor-pointer"
                  >
                    ✕ สแกนใหม่
                  </button>
                </div>
                <div className="space-y-2">
                  {hasDistinctName && (
                    <div>
                      <span className="text-xs sm:text-sm font-bold text-slate-600">ชื่อสินค้า: </span>
                      <span className="font-bold text-slate-900 text-base sm:text-lg">{displayName}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-bold text-slate-600">รหัสสินค้า:</span>
                      <span className="font-mono font-bold text-slate-900 text-base sm:text-lg">
                        {displaySku || watchProduct}
                      </span>
                    </div>
                    {displayBarcode && displayBarcode !== "-" && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold text-slate-600">บาร์โค้ด:</span>
                        <span className="font-mono font-bold text-slate-900 text-base sm:text-lg">
                          {displayBarcode}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-bold text-slate-600">ตำแหน่งปัจจุบัน:</span>
                      <span className="font-mono font-extrabold text-blue-800 bg-blue-50 px-3 py-1 rounded-xl border border-blue-200 text-sm sm:text-base">
                        {selectedProduct?.location && selectedProduct.location !== "-" ? selectedProduct.location : (watchFromLocation || "ยังไม่ระบุ")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-5 px-4 text-center space-y-1.5 bg-white border border-slate-200 rounded-2xl shadow-xs">
                <p className="text-base font-bold text-slate-900">ยิงสแกนบาร์โค้ดสินค้าที่ต้องการย้าย</p>
                <p className="text-sm text-slate-600 font-medium">ยิงสแกนบาร์โค้ดสินค้าที่ช่องสแกนด้านบน</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                จำนวนที่ต้องการจัดวาง / ย้าย (ชิ้น) *
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
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
                  className={`w-full py-3.5 sm:py-4 rounded-xl bg-white border border-slate-300 text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-base sm:text-xl font-mono font-bold outline-none ${
                    maxAvailableQty !== null && maxAvailableQty !== undefined
                      ? "pl-4 pr-32 sm:pr-40"
                      : "px-4"
                  }`}
                />
                {maxAvailableQty !== null && maxAvailableQty !== undefined && (
                  <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none">
                    <span className="text-xs sm:text-sm font-extrabold text-indigo-800 bg-indigo-50 px-2.5 sm:px-3 py-1.5 rounded-xl border border-indigo-200 shadow-2xs font-sans">
                      คงเหลือ: {maxAvailableQty.toLocaleString()} ชิ้น
                    </span>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onNextStep1}
              className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all text-base cursor-pointer shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 active:scale-95"
            >
              <span>ถัดไป: สแกนตำแหน่งปลายทาง</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        )}

        {/* STEP 2: Destination Location / Shelf Scan */}
        {step === 2 && (
          <div className="space-y-4">
            <input type="hidden" {...register("to_location_id")} />

            {/* Selected Product Summary Card */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-slate-700">
                <span className="font-bold text-sm">สินค้าที่ต้องการจัดตำแหน่ง:</span>
                <span className="text-amber-800 font-extrabold text-sm sm:text-base font-mono">
                  จำนวน: {watchQty.toLocaleString()} ชิ้น
                </span>
              </div>
              <div className="text-sm sm:text-base font-bold text-slate-900 font-mono">
                [{displaySku}]{hasDistinctName ? ` ${displayName}` : ""}
              </div>
            </div>

            {/* The 2-row From -> To location block (from move-flow.md) */}
            <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-200 shadow-xs overflow-hidden">
              {/* Source (หยิบจาก) */}
              <div className="p-4 space-y-1">
                <p className="text-sm font-bold text-slate-600">หยิบจากตำแหน่ง</p>
                <p className="text-2xl font-mono font-bold text-slate-900">
                  {selectedFromLoc?.location_code || watchFromLocation || selectedProduct?.location || "ไม่ระบุ"}
                </p>
              </div>

              {/* Down Arrow Divider */}
              <div className="flex justify-center py-1.5 bg-slate-50">
                <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>

              {/* Destination (ไปวางที่) */}
              <div className="p-4 space-y-1 bg-indigo-50/70">
                <p className="text-sm font-bold text-indigo-700">ไปวางที่ตำแหน่ง</p>
                <p className="text-2xl font-mono font-bold text-indigo-950">
                  {selectedToLoc?.location_code || watchToLocation || "ยังไม่ได้สแกน"}
                </p>
              </div>
            </div>

            {/* Step 2 Section Header with circle number */}
            <div className="flex items-center gap-3 pt-1">
              <span className="w-10 h-10 rounded-full bg-indigo-600 text-white font-bold text-lg flex items-center justify-center shrink-0">
                2
              </span>
              <p className="text-base font-bold text-slate-900">สแกนป้ายตำแหน่งที่จะไปวาง</p>
            </div>

            {/* Destination Scan Feedback Status */}
            {selectedToLoc || watchToLocation ? (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-emerald-800 font-bold">✓ ตำแหน่งปลายทางที่ยิงสแกนได้:</span>
                  <span className="px-4 py-1.5 rounded-xl bg-emerald-600 text-white font-mono font-bold text-base shadow-sm">
                    {selectedToLoc?.location_code || watchToLocation}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-5 px-4 text-center space-y-1.5 bg-white border border-slate-200 rounded-2xl shadow-xs">
                <p className="text-base font-bold text-slate-900">ยิงป้าย QR ที่ชั้นวางปลายทาง</p>
                <p className="text-sm text-slate-600 font-medium">ป้ายติดอยู่ที่หน้าชั้น</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-1/3 py-4 rounded-2xl bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm sm:text-base transition-all border border-slate-300 shadow-xs cursor-pointer flex items-center justify-center gap-2 active:scale-95"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>ย้อนกลับ</span>
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                id="move-submit"
                className="w-2/3 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold transition-all text-sm sm:text-base cursor-pointer shadow-lg shadow-emerald-600/20 active:scale-95 flex flex-col items-center justify-center"
              >
                <span>ย้าย {watchQty.toLocaleString()} ชิ้น</span>
                <span className="text-xs sm:text-sm font-mono font-bold text-emerald-100">
                  {selectedFromLoc?.location_code || watchFromLocation || selectedProduct?.location || "?"} → {selectedToLoc?.location_code || watchToLocation || "..."}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
