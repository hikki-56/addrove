"use client";

import React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import BarcodeSvg from "@/components/ui/BarcodeSvg";

export interface ReceiveLineItemProps {
  index: number;
  fieldId: string;
  form: UseFormReturn<ReceiveDocumentInput>;
  line: { product_id: string; location_id?: string; boxes?: number; qty?: number };
  locations: Location[];
  products: Product[];
  activeWhId: string;
  isConfirmed: boolean;
  isLocked?: boolean;
  onToggleConfirm: (index: number) => void;
  onAddLocationForProduct: (index: number) => void;
  onRemove: (index: number) => void;
  onOpenLocationCamera: (index: number) => void;
  onScanLocation: (index: number, code: string) => void;
}

export default function ReceiveLineItem({
  index,
  fieldId,
  form,
  line,
  locations,
  products,
  activeWhId,
  isConfirmed,
  isLocked = false,
  onToggleConfirm,
  onAddLocationForProduct,
  onRemove,
  onOpenLocationCamera,
  onScanLocation,
}: ReceiveLineItemProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const { register, watch, setValue } = form;

  const currentProductId = (line.product_id || "").trim().toLowerCase();
  const matchedProd = products.find(
    (p) =>
      p.product_id.toLowerCase() === currentProductId ||
      p.sku.toLowerCase() === currentProductId ||
      (p.barcode && p.barcode.trim().toLowerCase() === currentProductId) ||
      p.product_id.toLowerCase() === `prod-${currentProductId}`
  );

  const sku = matchedProd?.sku || line.product_id;
  const name = matchedProd?.product_name || "สินค้าใหม่";
  const barcode = matchedProd?.barcode && matchedProd.barcode.trim() !== "-" ? matchedProd.barcode.trim() : "";
  const category = matchedProd?.category || "ทั่วไป";

  const currentBoxes = watch(`lines.${index}.boxes`) || 1;
  const currentQty = watch(`lines.${index}.qty`) || 1;
  const currentLocation = watch(`lines.${index}.location_id`) || "";
  const extraLocations: string[] = watch(`lines.${index}.extra_locations` as any) || [];

  const getLocationDisplay = (locVal: string): string => {
    if (!locVal || !locVal.trim()) return "";
    const cleanVal = locVal.trim().toLowerCase();
    const matched = locations.find(
      (l) =>
        (l.location_code || "").trim().toLowerCase() === cleanVal ||
        (l.location_id || "").trim().toLowerCase() === cleanVal ||
        ((l as any).shelf_code || "").trim().toLowerCase() === cleanVal
    );
    if (matched) {
      return matched.location_code || matched.location_name || locVal.trim().toUpperCase();
    }
    return locVal.trim().toUpperCase();
  };

  const handleAddExtraSlot = () => {
    const current: string[] = form.getValues(`lines.${index}.extra_locations` as any) || [];
    setValue(`lines.${index}.extra_locations` as any, [...current, ""], { shouldValidate: true, shouldDirty: true });
  };

  const handleRemoveExtraSlot = (extraIdx: number) => {
    const current: string[] = form.getValues(`lines.${index}.extra_locations` as any) || [];
    const updated = current.filter((_, i) => i !== extraIdx);
    setValue(`lines.${index}.extra_locations` as any, updated, { shouldValidate: true, shouldDirty: true });
  };

  const allSelectedLocations = [currentLocation, ...extraLocations].filter((l) => Boolean(l && l.trim()));
  const hasUnscannedSlot = !currentLocation || extraLocations.some((loc) => !loc || !loc.trim());
  const [showCancelModal, setShowCancelModal] = React.useState(false);

  return (
    <div
      key={fieldId}
      className={`rounded-2xl border transition-all duration-200 ${
        isLocked
          ? "bg-slate-100/70 border-slate-200 opacity-60 cursor-not-allowed"
          : isConfirmed
          ? "bg-emerald-50/70 border-emerald-300/80 shadow-md shadow-emerald-500/10"
          : "bg-white border-slate-200/90 hover:border-slate-300 shadow-md shadow-slate-200/60"
      }`}
    >
      {/* Header Summary (Clickable to Expand / Collapse) */}
      <div
        onClick={() => {
          if (isLocked) return;
          setIsExpanded((prev) => !prev);
        }}
        className={`p-3.5 sm:p-5 flex items-start justify-between gap-2 select-none ${
          isLocked ? "cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <div className="space-y-1.5 min-w-0 flex-1">
          {/* Line 1: Sequence badge + Barcode + Lock badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 font-mono text-xs sm:text-sm font-extrabold border border-indigo-200/80 shrink-0">
              #{index + 1}
            </span>
            {isLocked && (
              <span className="text-[10px] sm:text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md font-sans border border-amber-200/80 font-bold shrink-0">
                🔒 รอดำเนินการรายการก่อนหน้า
              </span>
            )}
            {barcode && (
              <div className="text-sm sm:text-base text-slate-500 font-mono flex items-center gap-1.5">
                <span className="text-slate-500 font-sans font-medium text-xs sm:text-sm">บาร์โค้ด:</span>
                <strong className="text-slate-900 font-extrabold text-sm sm:text-base">{barcode}</strong>
              </div>
            )}
          </div>

          {/* Line 2: SKU (รหัสสินค้า) */}
          <div className="text-sm sm:text-base font-mono font-bold text-slate-800 flex items-center gap-1.5">
            <span className="text-slate-500 font-sans font-medium text-xs sm:text-sm">รหัสสินค้า:</span>
            <strong className="text-slate-900 font-mono font-bold text-sm sm:text-base">{sku}</strong>
          </div>

          {/* Line 3: Product Name (ชื่อสินค้า) */}
          <div className="text-sm sm:text-base font-bold text-slate-900 leading-snug break-words">
            {name}
          </div>

          {/* Show location preview pill when collapsed if location selected */}
          {!isExpanded && allSelectedLocations.length > 0 && (
            <div className="pt-1 flex items-center gap-2 text-xs sm:text-sm flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 text-xs sm:text-sm">
                📍 {allSelectedLocations.map((locVal) => getLocationDisplay(locVal)).join(", ")}
              </span>
              <span className="text-slate-600 font-mono text-xs sm:text-sm font-semibold">
                ({currentBoxes} กล่อง / {currentQty} ชิ้น)
              </span>
            </div>
          )}
        </div>

        {/* Action Group Top Right */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-1">
          {barcode && (
            <div className="p-1.5 bg-slate-50 rounded-xl shadow-xs border border-slate-200 shrink-0 hidden md:block">
              <BarcodeSvg value={barcode} height={30} showText={false} />
            </div>
          )}

          {/* Box Count Badge (Pinned Top Right) */}
          <div className="px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl bg-slate-100/90 border border-slate-200/90 text-slate-700 font-mono text-xs sm:text-sm font-bold flex items-center gap-1 shadow-2xs shrink-0">
            <span className="text-xs sm:text-sm text-slate-500 font-sans font-semibold">กล่อง:</span>
            <strong className="text-emerald-600 font-mono font-extrabold text-sm sm:text-base">{currentBoxes}</strong>
          </div>

          <button
            type="button"
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-transform cursor-pointer shrink-0"
            title={isExpanded ? "ย่อรายการ" : "ขยายเพื่อเลือกตำแหน่ง"}
          >
            <svg
              className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform duration-200 ${isExpanded ? "rotate-180" : "rotate-0"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded Details Body */}
      {isExpanded && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5 space-y-3.5 pt-2 border-t border-slate-100 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Location selection */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">ตำแหน่งจัดเก็บ *</label>
              <div className="space-y-2">
                {/* Slot 1: Primary Location + Add Button on same row */}
                <div className="flex items-center gap-2">
                  {currentLocation ? (
                    <div className="flex-1 px-4 py-2.5 sm:py-3 rounded-2xl bg-emerald-50 border border-emerald-300/90 text-emerald-900 text-xs sm:text-sm font-mono font-bold flex items-center justify-between shadow-xs">
                      <div className="flex items-center gap-2.5">
                        <span className="text-emerald-600 text-lg">📍</span>
                        <div>
                          <span className="text-slate-500 text-[10px] sm:text-xs font-sans font-medium block">ตำแหน่ง (1):</span>
                          <span className="text-sm sm:text-base font-extrabold text-emerald-800">{getLocationDisplay(currentLocation)}</span>
                        </div>
                      </div>
                      <span className="text-xs text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full font-sans font-bold border border-emerald-200 flex items-center gap-1">
                        ✓ สแกนแล้ว
                      </span>
                    </div>
                  ) : (
                    <div className="flex-1 px-4 py-3 sm:py-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-400 ring-2 ring-emerald-500/30 text-emerald-900 text-xs sm:text-sm font-mono font-medium flex items-center gap-2.5 shadow-xs animate-pulse">
                      <span className="text-emerald-600 text-lg sm:text-xl">🔍</span>
                      <span className="text-emerald-800 font-bold">ยิงสแกนตำแหน่ง...</span>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={hasUnscannedSlot}
                    onClick={() => {
                      if (hasUnscannedSlot) return;
                      handleAddExtraSlot();
                    }}
                    className={`p-3 sm:px-3.5 sm:py-3.5 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all shadow-xs shrink-0 ${
                      hasUnscannedSlot
                        ? "bg-slate-100 text-slate-400 border border-slate-200/80 cursor-not-allowed opacity-60"
                        : "bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/90 text-emerald-700 cursor-pointer"
                    }`}
                    title={hasUnscannedSlot ? "กรุณายิงสแกนตำแหน่งช่องปัจจุบันก่อนเพิ่มตำแหน่งใหม่" : "เพิ่มตำแหน่งสแกนในการ์ดเดิม"}
                  >
                    <svg className={`w-4 h-4 sm:w-5 sm:h-5 ${hasUnscannedSlot ? "text-slate-400" : "text-emerald-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="hidden sm:inline">เพิ่มตำแหน่งสแกน</span>
                  </button>
                </div>

                {/* Additional Scan Slots inside the same card */}
                {extraLocations.map((extraLoc, extraIdx) => (
                  <div key={`extra-loc-${extraIdx}`} className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-150">
                    {extraLoc ? (
                      <div className="flex-1 px-4 py-2.5 sm:py-3 rounded-2xl bg-emerald-50 border border-emerald-300/90 text-emerald-900 text-xs sm:text-sm font-mono font-bold flex items-center justify-between shadow-xs">
                        <div className="flex items-center gap-2.5">
                          <span className="text-emerald-600 text-lg">📍</span>
                          <div>
                            <span className="text-slate-500 text-[10px] sm:text-xs font-sans font-medium block">ตำแหน่ง ({extraIdx + 2}):</span>
                            <span className="text-sm sm:text-base font-extrabold text-emerald-800">{getLocationDisplay(extraLoc)}</span>
                          </div>
                        </div>
                        <span className="text-xs text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full font-sans font-bold border border-emerald-200">
                          ✓ สแกนแล้ว
                        </span>
                      </div>
                    ) : (
                      <div className="flex-1 px-4 py-3 sm:py-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-400 ring-2 ring-emerald-500/30 text-emerald-900 text-xs sm:text-sm font-mono font-medium flex items-center gap-2.5 shadow-xs animate-pulse">
                        <span className="text-emerald-600 text-lg sm:text-xl">🔍</span>
                        <span className="text-emerald-800 font-bold">ยิงสแกนตำแหน่ง ({extraIdx + 2})...</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRemoveExtraSlot(extraIdx)}
                      className="p-3 sm:p-3.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-colors shrink-0 border border-slate-200"
                      title="ลบช่องสแกนตำแหน่งนี้"
                    >
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">จำนวนชิ้นรวม *</label>
              <div className="flex items-center gap-2">
                {/* Number Input on the Left */}
                <div className="flex-1 relative">
                  <input
                    type="number"
                    min="1"
                    {...register(`lines.${index}.qty`, { valueAsNumber: true })}
                    className="w-full pl-4 pr-9 py-3 sm:py-3.5 rounded-2xl bg-white border border-slate-200 text-left text-emerald-600 text-sm sm:text-base font-mono font-extrabold shadow-xs focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-sans font-semibold text-slate-400 pointer-events-none">
                    ชิ้น
                  </span>
                </div>

                {/* Minus and Plus buttons grouped on the Right */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setValue(`lines.${index}.qty`, Math.max(1, currentQty - 1), { shouldValidate: true })}
                    className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-lg sm:text-xl flex items-center justify-center cursor-pointer border border-slate-200 transition-colors shadow-xs"
                    title="ลดจำนวนชิ้น"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() => setValue(`lines.${index}.qty`, currentQty + 1, { shouldValidate: true })}
                    className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-extrabold text-lg sm:text-xl flex items-center justify-center cursor-pointer border border-emerald-200/90 transition-colors shadow-xs"
                    title="เพิ่มจำนวนชิ้น"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 gap-2">
            {/* Left: Cancel button (Triggers Delete Confirmation Modal) */}
            <button
              type="button"
              onClick={() => setShowCancelModal(true)}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold bg-rose-600 hover:bg-rose-700 transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-rose-600/25 !text-white"
              style={{ color: "#ffffff", backgroundColor: "#e11d48" }}
            >
              <svg className="w-4 h-4 !text-white" fill="none" stroke="#ffffff" strokeWidth="2.5" viewBox="0 0 24 24" style={{ stroke: "#ffffff", color: "#ffffff" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="font-extrabold !text-white" style={{ color: "#ffffff" }}>ยกเลิก</span>
            </button>

            {/* Right: Confirm button */}
            <button
              type="button"
              disabled={hasUnscannedSlot}
              onClick={() => {
                if (hasUnscannedSlot) return;
                onToggleConfirm(index);
                setIsExpanded(false);
              }}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold flex items-center gap-1.5 transition-all shadow-md ${
                hasUnscannedSlot
                  ? "bg-slate-200 text-slate-400 border border-slate-300/80 cursor-not-allowed opacity-75"
                  : "bg-emerald-600 hover:bg-emerald-700 !text-white shadow-emerald-600/25 cursor-pointer"
              }`}
              style={!hasUnscannedSlot ? { color: "#ffffff", backgroundColor: "#059669" } : undefined}
            >
              <svg className={`w-4 h-4 ${hasUnscannedSlot ? "text-slate-400" : "!text-white"}`} fill="none" stroke={hasUnscannedSlot ? "#94a3b8" : "#ffffff"} strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className={hasUnscannedSlot ? "text-slate-400" : "font-extrabold !text-white"}>
                {hasUnscannedSlot ? "🔒 ยิงสแกนตำแหน่งก่อน" : "ยืนยัน"}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Delete / Cancel Item Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto text-xl font-bold">
              🗑️
            </div>
            <div className="text-center space-y-1.5">
              <h4 className="text-base font-extrabold text-slate-900">ยืนยันการยกเลิกรายการ?</h4>
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                คุณต้องการยกเลิกและลบรายการสินค้า <strong className="text-slate-900 font-bold block mt-1">&ldquo;{name}&rdquo; (#{index + 1})</strong> ออกจากรายการใช่หรือไม่?
              </p>
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer transition-all border border-slate-200/90"
              >
                ย้อนกลับ
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCancelModal(false);
                  onRemove(index);
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs cursor-pointer transition-all shadow-md shadow-rose-600/25"
              >
                ยืนยันลบรายการ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
