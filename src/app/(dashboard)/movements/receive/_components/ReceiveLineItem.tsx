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
  const [isExpanded, setIsExpanded] = React.useState(!isConfirmed);
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
      if (shelfCode && shelfCode.toLowerCase() === cleanVal) {
        return shelfCode.toUpperCase();
      }
      const locCode = (matched.location_code || "").trim();
      if (locCode && locCode.toLowerCase() === cleanVal) {
        return locCode.toUpperCase();
      }
      if (!cleanVal.startsWith("loc-") && !cleanVal.startsWith("id-") && !cleanVal.startsWith("sh-")) {
        return locVal.trim().toUpperCase();
      }
      return matched.shelf_code || matched.location_code || matched.location_name || locVal.trim().toUpperCase();
    }
    return locVal.trim().toUpperCase();
  };

  const availableLocationOptions = React.useMemo(() => {
    const list: { code: string; label: string }[] = [];
    const seen = new Set<string>();

    const addOption = (code?: string, name?: string) => {
      if (!code || !code.trim()) return;
      const clean = code.trim().toUpperCase();
      if (seen.has(clean.toLowerCase())) return;
      seen.add(clean.toLowerCase());
      list.push({
        code: clean,
        label: name && name.trim() !== clean ? `${clean} (${name.trim()})` : clean,
      });
    };

    (locations || []).forEach((loc) => {
      if ((loc as any).shelf_code) addOption((loc as any).shelf_code, (loc as any).shelf_name);
      if (loc.location_code) addOption(loc.location_code, loc.location_name);
    });

    if (currentLocation) addOption(currentLocation);
    extraLocations.forEach((el) => {
      if (el) addOption(el);
    });

    if (list.length === 0) {
      ["1K14-A", "1K15-1B", "1K15-2A", "1K16-1A", "1K16-2B", "WH1-A01", "WH1-A02", "WH1-B01"].forEach((def) => addOption(def));
    }

    return list;
  }, [locations, currentLocation, extraLocations]);

  const handleUpdatePrimaryQty = (val: number) => {
    const validVal = Math.max(1, val);
    const sumExtras = extraQtys.reduce((acc, curr) => acc + (Number(curr) || 1), 0);
    setValue(`lines.${index}.primary_qty` as any, validVal, { shouldValidate: true, shouldDirty: true });
    setValue(`lines.${index}.qty`, validVal + sumExtras, { shouldValidate: true, shouldDirty: true });
  };

  const handleUpdateExtraQty = (extraIdx: number, val: number) => {
    const validVal = Math.max(1, val);
    const updatedQtys = [...extraQtys];
    while (updatedQtys.length <= extraIdx) {
      updatedQtys.push(1);
    }
    updatedQtys[extraIdx] = validVal;
    setValue(`lines.${index}.extra_qtys` as any, updatedQtys, { shouldValidate: true, shouldDirty: true });

    const pQty = currentPrimaryQty;
    setValue(`lines.${index}.primary_qty` as any, pQty, { shouldValidate: true, shouldDirty: true });
    const sumExtras = updatedQtys.reduce((acc, curr) => acc + (Number(curr) || 1), 0);
    setValue(`lines.${index}.qty`, pQty + sumExtras, { shouldValidate: true, shouldDirty: true });
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

  const locationBreakdowns = [
    { loc: currentLocation, qty: currentPrimaryQty },
    ...extraLocations.map((loc, i) => ({ loc, qty: extraQtys[i] || 1 })),
  ].filter((item) => Boolean(item.loc && item.loc.trim()));

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
          {!isExpanded && locationBreakdowns.length > 0 && (
            <div className="pt-1 flex items-center gap-2 text-xs sm:text-sm flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 text-xs sm:text-sm">
                📍 {locationBreakdowns.map((item) => `${getLocationDisplay(item.loc)}${extraLocations.length > 0 ? ` (${item.qty} ชิ้น)` : ""}`).join(", ")}
              </span>
              <span className="text-slate-600 font-mono text-xs sm:text-sm font-semibold">
                ({currentBoxes} กล่อง / รวม {currentQty} ชิ้น)
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

          {/* Quantity Summary Badge (Pinned Top Right) */}
          <div className="px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl bg-emerald-50 border border-emerald-200/90 text-emerald-800 font-mono text-xs sm:text-sm font-bold flex items-center gap-1 shadow-2xs shrink-0">
            <span className="text-xs sm:text-sm text-slate-500 font-sans font-semibold">รวม:</span>
            <strong className="text-emerald-700 font-mono font-extrabold text-sm sm:text-base">{currentQty}</strong>
            <span className="text-[11px] font-sans font-medium text-slate-500">ชิ้น</span>
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
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-700">
                เลือกตำแหน่งจัดเก็บและระบุจำนวนในแต่ละตำแหน่ง:
              </label>
              <button
                type="button"
                onClick={handleAddExtraSlot}
                className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/90 text-emerald-700 cursor-pointer transition-all shadow-xs shrink-0"
                title="เพิ่มตำแหน่งจัดเก็บใหม่สำหรับสินค้านี้"
              >
                <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                <span>+ เพิ่มตำแหน่งจัดเก็บ</span>
              </button>
            </div>

            {/* Slot 1: Primary Location Card with Dropdown & Qty */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50/90 border border-slate-200/90 space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-800 text-xs sm:text-sm font-bold font-sans flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  ตำแหน่งที่ 1 {extraLocations.length > 0 ? "(หลัก)" : ""}:
                </span>
                {currentLocation ? (
                  <span className="text-[11px] sm:text-xs text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full font-sans font-bold border border-emerald-200">
                    ✓ เลือกแล้ว: {getLocationDisplay(currentLocation)}
                  </span>
                ) : (
                  <span className="text-[11px] sm:text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full font-sans font-semibold border border-amber-200">
                    ⚠️ เลือกหรือยิงสแกนตำแหน่ง
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                {/* Location Dropdown / Scanner Selection */}
                <div className="sm:col-span-7">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    เลือกหรือสแกนตำแหน่งจัดเก็บ *
                  </label>
                  <div className="relative">
                    <select
                      value={currentLocation}
                      onChange={(e) => {
                        const val = e.target.value;
                        setValue(`lines.${index}.location_id`, val, { shouldValidate: true, shouldDirty: true });
                      }}
                      className="w-full pl-3 pr-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm font-mono font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs appearance-none cursor-pointer"
                    >
                      <option value="">-- คลิกเลือกตำแหน่ง หรือยิงบาร์โค้ด --</option>
                      {availableLocationOptions.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          📍 {opt.label}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">
                      ▼
                    </div>
                  </div>
                </div>

                {/* Quantity Selection for Slot 1 */}
                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    จำนวนในตำแหน่งที่ 1 *
                  </label>
                  <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-300 shadow-xs">
                    <button
                      type="button"
                      onClick={() => handleUpdatePrimaryQty(currentPrimaryQty - 1)}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-base flex items-center justify-center cursor-pointer border border-slate-200 transition-colors"
                      title="ลดจำนวน"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={currentPrimaryQty}
                      onChange={(e) => handleUpdatePrimaryQty(parseInt(e.target.value, 10) || 1)}
                      className="flex-1 text-center py-1 bg-transparent font-mono font-black text-sm sm:text-base text-emerald-700 focus:outline-none"
                    />
                    <span className="text-xs text-slate-400 font-bold pr-1">ชิ้น</span>
                    <button
                      type="button"
                      onClick={() => handleUpdatePrimaryQty(currentPrimaryQty + 1)}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-extrabold text-base flex items-center justify-center cursor-pointer border border-emerald-200 transition-colors"
                      title="เพิ่มจำนวน"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Extra Location Slots (Slot 2..N) */}
            {extraLocations.map((extraLoc, extraIdx) => (
              <div key={`extra-slot-${extraIdx}`} className="p-3.5 sm:p-4 rounded-2xl bg-slate-50/90 border border-slate-200/90 space-y-2.5 shadow-2xs animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-800 text-xs sm:text-sm font-bold font-sans flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-teal-500" />
                    ตำแหน่งที่ {extraIdx + 2}:
                  </span>
                  <div className="flex items-center gap-2">
                    {extraLoc ? (
                      <span className="text-[11px] sm:text-xs text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full font-sans font-bold border border-emerald-200">
                        ✓ เลือกแล้ว: {getLocationDisplay(extraLoc)}
                      </span>
                    ) : (
                      <span className="text-[11px] sm:text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full font-sans font-semibold border border-amber-200">
                        ⚠️ เลือกหรือยิงสแกนตำแหน่ง
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveExtraSlot(extraIdx)}
                      className="text-xs text-rose-600 hover:text-rose-800 hover:underline font-bold cursor-pointer flex items-center gap-1 ml-1"
                      title="ลบตำแหน่งนี้"
                    >
                      <svg className="w-3.5 h-3.5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      ลบตำแหน่งนี้
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                  {/* Location Dropdown / Scanner Selection for Extra Slot */}
                  <div className="sm:col-span-7">
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      เลือกหรือสแกนตำแหน่งที่ {extraIdx + 2} *
                    </label>
                    <div className="relative">
                      <select
                        value={extraLoc}
                        onChange={(e) => {
                          const val = e.target.value;
                          const updated = [...extraLocations];
                          updated[extraIdx] = val;
                          setValue(`lines.${index}.extra_locations` as any, updated, { shouldValidate: true, shouldDirty: true });
                        }}
                        className="w-full pl-3 pr-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm font-mono font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs appearance-none cursor-pointer"
                      >
                        <option value="">-- คลิกเลือกตำแหน่ง หรือยิงบาร์โค้ด --</option>
                        {availableLocationOptions.map((opt) => (
                          <option key={opt.code} value={opt.code}>
                            📍 {opt.label}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">
                        ▼
                      </div>
                    </div>
                  </div>

                  {/* Quantity Selection for Extra Slot */}
                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      จำนวนในตำแหน่งที่ {extraIdx + 2} *
                    </label>
                    <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-300 shadow-xs">
                      <button
                        type="button"
                        onClick={() => handleUpdateExtraQty(extraIdx, (extraQtys[extraIdx] || 1) - 1)}
                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-base flex items-center justify-center cursor-pointer border border-slate-200 transition-colors"
                        title="ลดจำนวน"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={extraQtys[extraIdx] || 1}
                        onChange={(e) => handleUpdateExtraQty(extraIdx, parseInt(e.target.value, 10) || 1)}
                        className="flex-1 text-center py-1 bg-transparent font-mono font-black text-sm sm:text-base text-emerald-700 focus:outline-none"
                      />
                      <span className="text-xs text-slate-400 font-bold pr-1">ชิ้น</span>
                      <button
                        type="button"
                        onClick={() => handleUpdateExtraQty(extraIdx, (extraQtys[extraIdx] || 1) + 1)}
                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-extrabold text-base flex items-center justify-center cursor-pointer border border-emerald-200 transition-colors"
                        title="เพิ่มจำนวน"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Total Quantity Breakdown Bar */}
            <div className="p-3 rounded-2xl bg-emerald-50/90 border border-emerald-200 flex items-center justify-between shadow-2xs">
              <div className="text-xs text-slate-600 font-bold flex items-center gap-1.5">
                <span>📦 จำนวนรวมทั้งหมดในสินค้านี้:</span>
                <span className="text-slate-400 font-normal">({1 + extraLocations.length} ตำแหน่ง)</span>
              </div>
              <div className="font-mono font-extrabold text-base sm:text-lg text-emerald-700">
                {currentQty} ชิ้น
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 gap-2">
            {/* Left: Cancel button */}
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
                {hasUnscannedSlot ? "🔒 เลือกตำแหน่งก่อน" : "ยืนยัน"}
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
