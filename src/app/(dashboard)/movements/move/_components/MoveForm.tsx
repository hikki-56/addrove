"use client";

import React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { MoveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import ProductSearchInput from "@/components/ui/ProductSearchInput";
import ScanFeedbackBanner, { type ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";

export interface MoveFormProps {
  form: UseFormReturn<MoveDocumentInput>;
  step: 1 | 2 | 3;
  setStep: (step: 1 | 2 | 3) => void;
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
        if (step === 1 && !watchFromLocation) {
          onErrorPrompt("กรุณาเลือกหรือสแกนตำแหน่งต้นทางก่อน");
        } else if (step === 2 && !watchProduct) {
          onErrorPrompt("กรุณายิงสแกนบาร์โค้ดสินค้าก่อน");
        } else if (step === 3 && !watchToLocation) {
          onErrorPrompt("กรุณาเลือกหรือสแกนตำแหน่งปลายทางก่อนกดบันทึก");
        } else {
          const firstMsg = Object.values(formErrors)[0]?.message;
          onErrorPrompt(typeof firstMsg === "string" ? firstMsg : "กรุณากรอกข้อมูลให้ครบถ้วนก่อนบันทึก");
        }
      })}
      className="space-y-4"
    >
      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
          {error}
        </div>
      )}

      <div className="glass-card rounded-2xl p-5 space-y-4 border border-white/10 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-1">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="font-bold text-white text-lg sm:text-xl">{activeWhName}</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-slate-200 text-sm sm:text-base font-semibold">
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

        {/* STEP 1: Scan Source Location */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                1. สแกนบาร์โค้ด / QR Code ตำแหน่งต้นทาง ({activeWhName}) *
              </label>
              <select
                {...register("from_location_id", {
                  onChange: (e) => {
                    if (e.target.value) {
                      setStep(2);
                    }
                  },
                })}
                className="w-full px-3.5 py-3 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-medium"
              >
                <option value="" className="bg-[#111118] text-white">ยิงสแกนหรือเลือกตำแหน่งต้นทาง</option>
                {locations.map((l, idx) => {
                  const shelfName = (l as unknown as { shelf_name?: string }).shelf_name;
                  const val = l.location_code || l.location_id;
                  return (
                    <option key={`from-loc-${val}-${idx}`} value={val} className="bg-[#111118] text-white">
                      {l.location_code} {shelfName ? `(${shelfName})` : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            {selectedFromLoc ? (
              <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-indigo-300 font-semibold">✓ ตำแหน่งต้นทางที่เลือก:</span>
                  <span className="px-3 py-1 rounded-lg bg-indigo-500 text-white font-mono font-bold text-sm shadow-md">
                    {selectedFromLoc.location_code}
                  </span>
                </div>
                {(selectedFromLoc as unknown as { shelf_name?: string }).shelf_name && (
                  <p className="text-xs text-slate-300">
                    ชั้นวาง: <strong className="text-white font-semibold">{(selectedFromLoc as unknown as { shelf_name?: string }).shelf_name}</strong>
                  </p>
                )}
              </div>
            ) : (
              <div className="py-3.5 text-center space-y-1 bg-slate-900/40 border border-slate-800/80 rounded-xl">
                <p className="text-sm font-semibold text-slate-200">⚡ พร้อมสแกนตำแหน่งต้นทาง</p>
                <p className="text-xs text-slate-400">ยิงป้าย QR Code ประจำชั้นวาง/ตำแหน่งเพื่อเลือกตำแหน่งต้นทาง</p>
              </div>
            )}

            <button
              type="button"
              onClick={onNextStep1}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold transition-all text-sm cursor-pointer shadow-lg shadow-indigo-950/40 flex items-center justify-center gap-2 active:scale-95"
            >
              <span>ถัดไป: สแกนสินค้า</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        )}

        {/* STEP 2: Product Scan & Quantity */}
        {step === 2 && (
          <div className="space-y-4">
            {selectedFromLoc && (
              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-between text-xs">
                <span className="text-slate-300">ตำแหน่งต้นทาง:</span>
                <span className="font-mono font-bold text-indigo-300 bg-indigo-500/20 px-2.5 py-0.5 rounded border border-indigo-500/40">
                  {selectedFromLoc.location_code} {(selectedFromLoc as unknown as { shelf_name?: string }).shelf_name ? `(${(selectedFromLoc as unknown as { shelf_name?: string }).shelf_name})` : ""}
                </span>
              </div>
            )}

            {(selectedProduct || watchProduct) ? (
              <div className="py-3 px-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2.5 relative">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-xs font-bold text-emerald-400">✓ สินค้าที่ยิงสแกนได้</span>
                  <button
                    type="button"
                    onClick={() => {
                      setValue("product_id", "");
                      setValue("qty", 1);
                    }}
                    className="text-xs text-rose-400 hover:text-rose-300 font-bold px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 transition-all cursor-pointer"
                  >
                    ✕ เปลี่ยนสินค้า / สแกนใหม่
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">รหัสสินค้า:</span>
                    <span className="font-mono font-bold text-white text-sm sm:text-base">
                      {displaySku || watchProduct}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">บาร์โค้ด:</span>
                    <span className="font-mono font-bold text-white text-sm sm:text-base">
                      {displayBarcode}
                    </span>
                  </div>
                </div>
                {hasDistinctName && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">ชื่อสินค้า:</span>
                    <span className="font-bold text-white text-sm sm:text-base">{displayName}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  2. ยิงสแกนบาร์โค้ดสินค้า หรือ พิมพ์ค้นหาสินค้า *
                </label>
                <ProductSearchInput
                  products={products}
                  value={watchProduct}
                  onChange={(val) => {
                    setValue("product_id", val, { shouldValidate: true });
                  }}
                  placeholder="ค้นหาชื่อสินค้า / รหัสสินค้า SKU / ยิงสแกนบาร์โค้ด..."
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">จำนวนที่ต้องการย้าย *</label>
              <input
                type="number"
                min="1"
                {...register("qty", { valueAsNumber: true })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-100 focus:outline-none focus:border-indigo-500 text-sm font-mono"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="w-1/3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>ย้อนกลับ</span>
              </button>

              <button
                type="button"
                onClick={onNextStep2}
                className="w-2/3 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-semibold transition-all text-sm cursor-pointer shadow-lg shadow-indigo-950/40 flex items-center justify-center gap-2 active:scale-95"
              >
                <span>ถัดไป: สแกนตำแหน่งปลายทาง</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Destination Location / Shelf Scan */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span>สินค้าที่เลือก:</span>
                <span className="text-amber-400 font-bold">จำนวน: {watchQty} ชิ้น</span>
              </div>
              <div className="text-sm font-bold text-white font-mono">
                [{displaySku}]{hasDistinctName ? ` ${displayName}` : ""}
              </div>
              <div className="text-slate-400 pt-1">
                ต้นทาง: <span className="font-mono font-bold text-indigo-300">{selectedFromLoc?.location_code || watchFromLocation}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                3. สแกนบาร์โค้ด / QR Code ตำแหน่งปลายทาง ({activeWhName}) *
              </label>
              <select
                {...register("to_location_id")}
                className="w-full px-3.5 py-3 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-medium"
              >
                <option value="" className="bg-[#111118] text-white">ยิงสแกนหรือเลือกตำแหน่งปลายทางที่จะเอาสินค้าไปไว้</option>
                {locations
                  .filter((l) => l.location_code !== watchFromLocation && l.location_id !== watchFromLocation)
                  .map((l, idx) => {
                    const shelfName = (l as unknown as { shelf_name?: string }).shelf_name;
                    const val = l.location_code || l.location_id;
                    return (
                      <option key={`to-loc-${val}-${idx}`} value={val} className="bg-[#111118] text-white">
                        {l.location_code} {shelfName ? `(${shelfName})` : ""}
                      </option>
                    );
                  })}
              </select>
              {errors.to_location_id && (
                <p className="mt-1 text-xs text-rose-400">{errors.to_location_id.message}</p>
              )}
            </div>

            {selectedToLoc && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-emerald-300 font-semibold">✓ ตำแหน่งปลายทางที่เลือก:</span>
                  <span className="px-3 py-1 rounded-lg bg-emerald-500 text-white font-mono font-bold text-sm shadow-md">
                    {selectedToLoc.location_code}
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-1/3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95"
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
                className="w-2/3 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-semibold transition-all text-sm cursor-pointer shadow-lg shadow-emerald-950/40 active:scale-95"
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
