"use client";

import React from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";

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
  const [isExpanded, setIsExpanded] = React.useState(!isConfirmed);
  const { watch, setValue } = form;

  // Location barcode scan input state
  const [locScanInput, setLocScanInput] = React.useState("");
  const [extraLocScanInputs, setExtraLocScanInputs] = React.useState<Record<number, string>>({});
  const locInputRef = React.useRef<HTMLInputElement>(null);

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

  const currentBoxes = watch(`lines.${index}.boxes`) || 1;
  const currentQty = watch(`lines.${index}.qty`) || 1;
  const currentLocation = watch(`lines.${index}.location_id`) || "";
  const extraLocations: string[] = watch(`lines.${index}.extra_locations` as any) || [];
  const extraQtys: number[] = watch(`lines.${index}.extra_qtys` as any) || [];
  const rawPrimaryQty = watch(`lines.${index}.primary_qty` as any);

  const currentPrimaryQty = typeof rawPrimaryQty === "number" && rawPrimaryQty > 0
    ? rawPrimaryQty
    : extraLocations.length > 0
    ? Math.max(1, currentQty - extraQtys.reduce((sum, q) => sum + (Number(q) || 1), 0))
    : currentQty;

  const getLocationDisplay = (locVal: string): string => {
    if (!locVal || !locVal.trim()) return "";
    const cleanVal = locVal.trim().toLowerCase();
    const matched = locations.find(
      (l) =>
        ((l as any).shelf_code || "").trim().toLowerCase() === cleanVal ||
        (l.location_code || "").trim().toLowerCase() === cleanVal ||
        (l.location_id || "").trim().toLowerCase() === cleanVal ||
        (l.location_name || "").trim().toLowerCase() === cleanVal
    );
    if (matched) {
      const shelfCode = ((matched as any).shelf_code || "").trim();
      if (shelfCode && shelfCode.toLowerCase() === cleanVal) return shelfCode.toUpperCase();
      const locCode = (matched.location_code || "").trim();
      if (locCode && locCode.toLowerCase() === cleanVal) return locCode.toUpperCase();
      if (!cleanVal.startsWith("loc-") && !cleanVal.startsWith("id-") && !cleanVal.startsWith("sh-")) {
        return locVal.trim().toUpperCase();
      }
      return matched.shelf_code || matched.location_code || matched.location_name || locVal.trim().toUpperCase();
    }
    return locVal.trim().toUpperCase();
  };

  const handleUpdatePrimaryQty = (val: number) => {
    const validVal = Math.max(0, val);
    const sumExtras = extraQtys.reduce((acc, curr) => acc + (Number(curr) || 1), 0);
    setValue(`lines.${index}.primary_qty` as any, validVal, { shouldValidate: true, shouldDirty: true });
    setValue(`lines.${index}.qty`, Math.max(1, validVal + sumExtras), { shouldValidate: true, shouldDirty: true });
  };

  const handleUpdateExtraQty = (extraIdx: number, val: number) => {
    const validVal = Math.max(0, val);
    const updatedQtys = [...extraQtys];
    while (updatedQtys.length <= extraIdx) updatedQtys.push(1);
    updatedQtys[extraIdx] = validVal;
    setValue(`lines.${index}.extra_qtys` as any, updatedQtys, { shouldValidate: true, shouldDirty: true });
    const pQty = currentPrimaryQty || 1;
    setValue(`lines.${index}.primary_qty` as any, pQty, { shouldValidate: true, shouldDirty: true });
    const sumExtras = updatedQtys.reduce((acc, curr) => acc + (Number(curr) || 0), 0);
    setValue(`lines.${index}.qty`, Math.max(1, pQty + sumExtras), { shouldValidate: true, shouldDirty: true });
  };

  const handleAddExtraSlot = () => {
    const currentLocs: string[] = form.getValues(`lines.${index}.extra_locations` as any) || [];
    const currentQtys: number[] = form.getValues(`lines.${index}.extra_qtys` as any) || [];
    const pQty = currentPrimaryQty;
    setValue(`lines.${index}.primary_qty` as any, pQty, { shouldValidate: true, shouldDirty: true });
    setValue(`lines.${index}.extra_locations` as any, [...currentLocs, ""], { shouldValidate: true, shouldDirty: true });
    setValue(`lines.${index}.extra_qtys` as any, [...currentQtys, 1], { shouldValidate: true, shouldDirty: true });
    const sumExtras = [...currentQtys, 1].reduce((acc, curr) => acc + (Number(curr) || 1), 0);
    setValue(`lines.${index}.qty`, pQty + sumExtras, { shouldValidate: true, shouldDirty: true });
  };

  const handleRemoveExtraSlot = (extraIdx: number) => {
    const currentLocs: string[] = form.getValues(`lines.${index}.extra_locations` as any) || [];
    const currentQtys: number[] = form.getValues(`lines.${index}.extra_qtys` as any) || [];
    const updatedLocs = currentLocs.filter((_, i) => i !== extraIdx);
    const updatedQtys = currentQtys.filter((_, i) => i !== extraIdx);
    setValue(`lines.${index}.extra_locations` as any, updatedLocs, { shouldValidate: true, shouldDirty: true });
    setValue(`lines.${index}.extra_qtys` as any, updatedQtys, { shouldValidate: true, shouldDirty: true });
    const pQty = currentPrimaryQty;
    const sumExtras = updatedQtys.reduce((acc, curr) => acc + (Number(curr) || 1), 0);
    setValue(`lines.${index}.qty`, pQty + sumExtras, { shouldValidate: true, shouldDirty: true });
  };

  // Handle scanning/typing location barcode for primary slot
  const handleLocScanSubmit = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    onScanLocation(index, code);
    setLocScanInput("");
  };

  // Handle scanning/typing location barcode for extra slots
  const handleExtraLocScanSubmit = (extraIdx: number, rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    const updated = [...extraLocations];
    updated[extraIdx] = code.toUpperCase();
    setValue(`lines.${index}.extra_locations` as any, updated, { shouldValidate: true, shouldDirty: true });
    setExtraLocScanInputs((prev) => ({ ...prev, [extraIdx]: "" }));
  };

  const locationBreakdowns = [
    { loc: currentLocation, qty: currentPrimaryQty },
    ...extraLocations.map((loc, i) => ({ loc, qty: extraQtys[i] || 1 })),
  ].filter((item) => Boolean(item.loc && item.loc.trim()));

  const hasUnscannedSlot = !currentLocation || extraLocations.some((loc) => !loc || !loc.trim());
  const [showCancelModal, setShowCancelModal] = React.useState(false);

  useEscapeKey(showCancelModal, () => setShowCancelModal(false));

  return (
    <div
      key={fieldId}
      className={`transition-all duration-200 ${
        isLocked
          ? "bg-slate-50 border border-slate-200 rounded-2xl opacity-60 cursor-not-allowed"
          : isConfirmed
          ? "bg-emerald-50/50 border border-emerald-300 rounded-2xl shadow-sm"
          : "bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md"
      }`}
    >
      {/* Header Summary (Clickable to Expand / Collapse) */}
      <div
        onClick={() => { if (isLocked) return; setIsExpanded((prev) => !prev); }}
        className={`p-3.5 sm:p-4 flex items-center justify-between gap-2 sm:gap-3 select-none ${isLocked ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div className="min-w-0 flex-1 flex items-center gap-2.5 sm:gap-3">
          {/* Sequence badge - Rounded pill #1 */}
          <span className="px-2.5 sm:px-3 py-1 rounded-xl bg-emerald-100/70 text-emerald-800 font-mono text-xs sm:text-sm font-extrabold border border-emerald-200/50 shrink-0">
            #{index + 1}
          </span>
          {isLocked && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-800 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200 font-bold shrink-0">
              <svg className="w-3.5 h-3.5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>รอคิว</span>
            </span>
          )}
          {/* SKU + Barcode + Name Stack */}
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {barcode ? (
                <>
                  <span className="font-black font-mono text-base sm:text-lg text-slate-950 tracking-wider">
                    {barcode}
                  </span>
                  <span className="font-bold text-sm text-slate-600 font-mono">
                    {sku}
                  </span>
                </>
              ) : (
                <span className="font-extrabold text-base sm:text-lg text-slate-900 font-mono">{sku}</span>
              )}
            </div>
            <span className="text-sm sm:text-base text-slate-700 font-bold truncate max-w-[200px] sm:max-w-[380px] md:max-w-[500px] mt-0.5" title={name}>
              {name}
            </span>
          </div>
        </div>

        {/* Right side: qty badge + chevron */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Location pill when collapsed */}
          {!isExpanded && locationBreakdowns.length > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-100/80 text-emerald-800 font-bold border border-emerald-200 text-xs sm:text-sm">
              <svg className="w-3.5 h-3.5 text-emerald-700 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{locationBreakdowns.map((item) => getLocationDisplay(item.loc)).join(", ")}</span>
            </span>
          )}
          <div className="px-3 sm:px-4 py-1.5 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 font-mono text-sm sm:text-base font-extrabold shrink-0">
            {(currentQty || 0).toLocaleString()} ชิ้น
          </div>
          <svg
            className={`w-4 h-4 text-slate-700 transition-transform duration-200 ${isExpanded ? "rotate-180" : "rotate-0"}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expanded Details Body */}
      {isExpanded && (
        <div className="px-3.5 pb-4 sm:px-5 sm:pb-5 space-y-3.5 pt-1 border-t border-slate-100">
          {/* Primary Location Scan Slot */}
          <div className="p-3.5 sm:p-4.5 rounded-2xl sm:rounded-3xl bg-slate-50/80 border border-slate-200/80 space-y-3 sm:space-y-3.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-900 text-sm sm:text-base font-bold flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                ตำแหน่ง 1 {extraLocations.length > 0 ? "(หลัก)" : ""}
              </span>
              {currentLocation ? (
                <span className="text-xs sm:text-sm text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full font-bold border border-emerald-200">
                  ✓ {getLocationDisplay(currentLocation)}
                </span>
              ) : (
                <span className="text-xs sm:text-sm text-amber-800 bg-amber-100/90 px-3 py-1 rounded-full font-bold border border-amber-200 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>สแกนตำแหน่ง</span>
                </span>
              )}
            </div>

            {/* Barcode scan input for location (Full Width, Curved, No Camera Button) */}
            <div className="relative w-full bg-white border border-slate-200/90 rounded-2xl focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 shadow-xs transition-all overflow-hidden">
              <input
                ref={locInputRef}
                type="text"
                value={locScanInput}
                onChange={(e) => setLocScanInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleLocScanSubmit(locScanInput);
                  }
                }}
                placeholder="สแกนบาร์โค้ดตำแหน่ง..."
                className="w-full pl-11 sm:pl-12 pr-4 py-3.5 sm:py-4 bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:text-slate-500 placeholder:font-normal"
              />
              <svg className="absolute left-3.5 sm:left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            {/* Qty Stepper for slot 1 */}
            <div className="flex items-center justify-between bg-white p-2 rounded-2xl border border-slate-200/90 shadow-xs">
              <button
                type="button"
                aria-label="ลดจำนวน"
                onClick={() => handleUpdatePrimaryQty(Math.max(1, (currentPrimaryQty || 1) - 1))}
                className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-2xl flex items-center justify-center cursor-pointer transition-transform active:scale-95 shrink-0"
              >−</button>
              <div className="flex items-baseline gap-2">
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={currentPrimaryQty === 0 ? "" : (currentPrimaryQty ?? 1)}
                  onFocus={(e) => (e.target as HTMLInputElement).select()}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleUpdatePrimaryQty(val === "" ? 0 : parseInt(val, 10) || 0);
                  }}
                  onBlur={() => {
                    if (!currentPrimaryQty || currentPrimaryQty < 1) {
                      handleUpdatePrimaryQty(1);
                    }
                  }}
                  className="w-20 sm:w-24 text-center py-2 sm:py-3 bg-transparent font-mono font-black text-2xl text-slate-900 focus:outline-none"
                />
                <span className="text-base text-slate-700 font-bold pr-2">ชิ้น</span>
              </div>
              <button
                type="button"
                aria-label="เพิ่มจำนวน"
                onClick={() => handleUpdatePrimaryQty((currentPrimaryQty || 0) + 1)}
                className="w-12 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-2xl flex items-center justify-center cursor-pointer transition-transform active:scale-95 shrink-0"
              >+</button>
            </div>
          </div>

          {/* Extra Location Slots */}
          {extraLocations.map((extraLoc, extraIdx) => (
            <div key={`extra-slot-${extraIdx}`} className="p-3.5 sm:p-4.5 rounded-2xl sm:rounded-3xl bg-slate-50/80 border border-slate-200/80 space-y-3 sm:space-y-3.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-900 text-sm sm:text-base font-bold flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  ตำแหน่ง {extraIdx + 2}
                </span>
                <div className="flex items-center gap-2">
                  {extraLoc ? (
                    <span className="text-xs sm:text-sm text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full font-bold border border-emerald-200">
                      ✓ {getLocationDisplay(extraLoc)}
                    </span>
                  ) : (
                    <span className="text-xs sm:text-sm text-amber-800 bg-amber-100/90 px-3 py-1 rounded-full font-bold border border-amber-200 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span>สแกนตำแหน่ง</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveExtraSlot(extraIdx)}
                    className="text-xs sm:text-sm text-rose-700 hover:text-rose-900 font-bold cursor-pointer ml-1 px-2 py-1 rounded-lg hover:bg-rose-50 border border-rose-200"
                    title="ลบตำแหน่ง"
                  >✕ ลบ</button>
                </div>
              </div>

              {/* Barcode scan input for extra location (Full Width, Curved, No Camera Button) */}
              <div className="relative w-full bg-white border border-slate-200/90 rounded-2xl focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 shadow-xs transition-all overflow-hidden">
                <input
                  type="text"
                  value={extraLocScanInputs[extraIdx] || ""}
                  onChange={(e) => setExtraLocScanInputs((prev) => ({ ...prev, [extraIdx]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleExtraLocScanSubmit(extraIdx, extraLocScanInputs[extraIdx] || "");
                    }
                  }}
                  placeholder="สแกนบาร์โค้ดตำแหน่ง..."
                  className="w-full pl-11 sm:pl-12 pr-4 py-3.5 sm:py-4 bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:text-slate-500 placeholder:font-normal"
                />
                <svg className="absolute left-3.5 sm:left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              {/* Qty for extra slot */}
              <div className="flex items-center justify-between bg-white p-2 rounded-2xl border border-slate-200/90 shadow-xs">
                <button
                  type="button"
                  aria-label="ลดจำนวน"
                  onClick={() => handleUpdateExtraQty(extraIdx, Math.max(1, (extraQtys[extraIdx] || 1) - 1))}
                  className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-2xl flex items-center justify-center cursor-pointer transition-transform active:scale-95 shrink-0"
                >−</button>
                <div className="flex items-baseline gap-2">
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={extraQtys[extraIdx] === 0 ? "" : (extraQtys[extraIdx] ?? 1)}
                    onFocus={(e) => (e.target as HTMLInputElement).select()}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleUpdateExtraQty(extraIdx, val === "" ? 0 : parseInt(val, 10) || 0);
                    }}
                    onBlur={() => {
                      if (!extraQtys[extraIdx] || extraQtys[extraIdx] < 1) {
                        handleUpdateExtraQty(extraIdx, 1);
                      }
                    }}
                    className="w-20 sm:w-24 text-center py-2 sm:py-3 bg-transparent font-mono font-black text-2xl text-slate-900 focus:outline-none"
                  />
                  <span className="text-base text-slate-700 font-bold pr-2">ชิ้น</span>
                </div>
                <button
                  type="button"
                  aria-label="เพิ่มจำนวน"
                  onClick={() => handleUpdateExtraQty(extraIdx, (extraQtys[extraIdx] || 0) + 1)}
                  className="w-12 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-2xl flex items-center justify-center cursor-pointer transition-transform active:scale-95 shrink-0"
                >+</button>
              </div>
            </div>
          ))}

          {/* Add extra location + Total */}
          <div className="flex items-center justify-between pt-1 gap-2">
            <button
              type="button"
              onClick={handleAddExtraSlot}
              className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 cursor-pointer shadow-2xs transition-all shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              <span>เพิ่มตำแหน่ง</span>
            </button>
            <div className="text-xs sm:text-sm font-semibold text-slate-700 truncate text-right">
              รวม <span className="text-emerald-700 font-mono font-black text-base sm:text-lg">{(currentQty || 0).toLocaleString()}</span> ชิ้น ({1 + extraLocations.length} ตำแหน่ง)
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-2 gap-2.5 sm:gap-3">
            {/* Cancel Button */}
            <button
              type="button"
              onClick={() => setShowCancelModal(true)}
              className="flex-1 py-3 sm:py-3.5 rounded-2xl text-sm sm:text-base font-bold flex items-center justify-center gap-1.5 sm:gap-2 bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 cursor-pointer shadow-2xs active:scale-98 transition-all"
            >
              <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>ยกเลิก</span>
            </button>

            {/* Confirm / Scan Location Button */}
            <button
              type="button"
              disabled={hasUnscannedSlot}
              onClick={() => {
                if (hasUnscannedSlot) return;
                onToggleConfirm(index);
                setIsExpanded(false);
              }}
              className={`flex-[1.5] py-3 sm:py-3.5 rounded-2xl text-sm sm:text-base font-bold flex items-center justify-center gap-2 transition-all shadow-sm ${
                hasUnscannedSlot
                  ? "bg-slate-700 hover:bg-slate-800 text-white cursor-pointer"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer active:scale-98"
              }`}
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>{hasUnscannedSlot ? "สแกนตำแหน่งก่อน" : "ยืนยัน"}</span>
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-sm bg-white rounded-2xl sm:rounded-3xl p-5 shadow-2xl space-y-4 border border-slate-200">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h4 className="text-base font-extrabold text-slate-900">ยกเลิกรายการ?</h4>
              <p className="text-sm text-slate-600">
                ลบ <strong>{name}</strong> (#{index + 1}) {barcode ? `(บาร์โค้ด: ${barcode})` : ""}?
              </p>
            </div>
            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm cursor-pointer border border-slate-200/90"
              >ย้อนกลับ</button>
              <button
                type="button"
                onClick={() => { setShowCancelModal(false); onRemove(index); }}
                className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-sm cursor-pointer shadow-md shadow-rose-600/25"
              >ยืนยันลบ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
