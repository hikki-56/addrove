"use client";

import React from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import type { ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";

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
  onScanLocation: (index: number, code: string) => void;
  onScanFeedback?: (feedback: ScanFeedback | null) => void;
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
  onScanLocation,
  onScanFeedback,
}: ReceiveLineItemProps) {
  const [isExpanded, setIsExpanded] = React.useState(!isConfirmed);
  const { watch, setValue } = form;

  const [locScanInput, setLocScanInput] = React.useState("");
  const [extraLocScanInputs, setExtraLocScanInputs] = React.useState<Record<number, string>>({});
  // Which slot the camera modal is scanning for — null when closed
  const [cameraSlot, setCameraSlot] = React.useState<{ isPrimary: boolean; extraIdx?: number } | null>(null);

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
  const currentQty = Number(watch(`lines.${index}.qty`)) || 0;
  const currentLocation = watch(`lines.${index}.location_id`) || "";
  const extraLocations: string[] = watch(`lines.${index}.extra_locations` as any) || [];
  const extraQtys: number[] = watch(`lines.${index}.extra_qtys` as any) || [];
  const rawPrimaryQty = watch(`lines.${index}.primary_qty` as any);

  const currentPrimaryQty = typeof rawPrimaryQty === "number" && rawPrimaryQty > 0
    ? rawPrimaryQty
    : extraLocations.length > 0
    ? Math.max(0, currentQty - extraQtys.reduce((sum, q) => sum + (Number(q) || 1), 0))
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
    setValue(`lines.${index}.qty`, validVal + sumExtras, { shouldValidate: true, shouldDirty: true });
  };

  const handleUpdateExtraQty = (extraIdx: number, val: number) => {
    const validVal = Math.max(0, val);
    const updatedQtys = [...extraQtys];
    while (updatedQtys.length <= extraIdx) updatedQtys.push(1);
    updatedQtys[extraIdx] = validVal;
    setValue(`lines.${index}.extra_qtys` as any, updatedQtys, { shouldValidate: true, shouldDirty: true });
    const pQty = currentPrimaryQty || 0;
    setValue(`lines.${index}.primary_qty` as any, pQty, { shouldValidate: true, shouldDirty: true });
    const sumExtras = updatedQtys.reduce((acc, curr) => acc + (Number(curr) || 0), 0);
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

  const handleLocScanSubmit = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    onScanLocation(index, code);
    setLocScanInput("");
  };

  const handleExtraLocScanSubmit = (extraIdx: number, rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    // Only accept locations that exist in the warehouse master — never accept an unknown code silently
    const cleanCode = code.toLowerCase();
    const knownLocation = locations.some(
      (l) =>
        (((l as any).shelf_code || "").trim().toLowerCase() === cleanCode ||
          (l.location_code || "").trim().toLowerCase() === cleanCode ||
          (l.location_id || "").trim().toLowerCase() === cleanCode ||
          (l.location_name || "").trim().toLowerCase() === cleanCode)
    );
    if (!knownLocation) {
      setExtraLocScanInputs((prev) => ({ ...prev, [extraIdx]: "" }));
      onScanFeedback?.({
        type: "error",
        title: "ไม่พบตำแหน่งนี้ในโกดัง",
        message: `"${code.toUpperCase()}" ไม่อยู่ในรายการตำแหน่ง — กรุณาเช็ค QR ชั้นวางหรือเพิ่มตำแหน่งในระบบก่อน`,
      });
      return;
    }
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
  const hasNoQty = (currentQty || 0) <= 0;
  const [showCancelModal, setShowCancelModal] = React.useState(false);

  useEscapeKey(showCancelModal, () => setShowCancelModal(false));

  const slotScanInputClass =
    "w-full pl-11 pr-14 py-3.5 bg-white text-base font-mono font-bold text-slate-900 outline-none border border-[#E8ECEA] rounded-xl placeholder:text-slate-500 placeholder:font-normal placeholder:font-sans focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 transition-colors";

  const renderSlot = (opts: {
    slotNo: number;
    isPrimary: boolean;
    extraIdx?: number;
    scannedLoc?: string;
  }) => {
    const { slotNo, isPrimary, extraIdx, scannedLoc } = opts;
    const isScanned = Boolean(scannedLoc && scannedLoc.trim());
    const scanValue = isPrimary ? locScanInput : (extraLocScanInputs[extraIdx!] || "");
    const setScanValue = (v: string) => {
      if (isPrimary) setLocScanInput(v);
      else setExtraLocScanInputs((prev) => ({ ...prev, [extraIdx!]: v }));
    };
    const submitScan = () => {
      if (isPrimary) handleLocScanSubmit(locScanInput);
      else handleExtraLocScanSubmit(extraIdx!, extraLocScanInputs[extraIdx!] || "");
    };

    return (
      <div className="bg-black/[.015] border border-[#E8ECEA] rounded-2xl p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-slate-900 flex items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded-lg bg-[#111827] text-white font-mono text-[13px] font-bold shrink-0">
              {slotNo}
            </span>
            <span className="truncate">
              ตำแหน่ง {slotNo}
              {isPrimary && extraLocations.length > 0 ? " (หลัก)" : ""}
            </span>
          </span>

          <div className="flex items-center gap-2 shrink-0">
            {isScanned ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#DFEDE6] text-[#053425] text-sm font-bold border border-[#C9DFD4] max-w-[180px] sm:max-w-none">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-mono truncate">{getLocationDisplay(scannedLoc!)}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-bold border border-amber-200">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>รอสแกนตำแหน่ง</span>
              </span>
            )}

            {!isPrimary && (
              <button
                type="button"
                onClick={() => handleRemoveExtraSlot(extraIdx!)}
                aria-label={`ลบตำแหน่ง ${slotNo}`}
                className="min-h-11 px-3 rounded-xl border border-rose-200 text-rose-700 text-sm font-bold hover:bg-rose-50 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>ลบ</span>
              </button>
            )}
          </div>
        </div>

        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitScan();
              }
            }}
            placeholder="สแกนบาร์โค้ดตำแหน่ง..."
            aria-label={`สแกนบาร์โค้ดตำแหน่งที่ ${slotNo}`}
            className={slotScanInputClass}
          />
          <button
            type="button"
            onClick={() => setCameraSlot({ isPrimary, extraIdx })}
            aria-label={`เปิดกล้องสแกนตำแหน่งที่ ${slotNo}`}
            title="เปิดกล้องสแกน"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-[#EAF2EE] hover:bg-[#DFEDE6] text-[#053425] rounded-xl border border-[#C9DFD4] cursor-pointer transition-colors active:scale-95"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0118.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 bg-white p-2 rounded-xl border border-[#E8ECEA]">
          <button
            type="button"
            aria-label="ลดจำนวน"
            onClick={() =>
              isPrimary
                ? handleUpdatePrimaryQty(Math.max(0, (currentPrimaryQty ?? 0) - 1))
                : handleUpdateExtraQty(extraIdx!, Math.max(1, (extraQtys[extraIdx!] || 1) - 1))
            }
            className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-2xl flex items-center justify-center cursor-pointer transition-transform active:scale-95 shrink-0"
          >−</button>

          <div className="flex items-baseline gap-2">
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={(isPrimary ? currentPrimaryQty : extraQtys[extraIdx!]) ?? 0}
              onFocus={(e) => (e.target as HTMLInputElement).select()}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              onChange={(e) => {
                const val = e.target.value;
                const parsed = val === "" ? 0 : parseInt(val, 10) || 0;
                if (isPrimary) handleUpdatePrimaryQty(parsed);
                else handleUpdateExtraQty(extraIdx!, parsed);
              }}
              onBlur={() => {
                if (!isPrimary && (!extraQtys[extraIdx!] || extraQtys[extraIdx!] < 1)) {
                  handleUpdateExtraQty(extraIdx!, 1);
                }
              }}
              aria-label={`จำนวนของตำแหน่งที่ ${slotNo}`}
              className="w-24 text-center py-2 bg-transparent font-mono font-bold text-2xl text-slate-900 focus:outline-none"
            />
            <span className="text-base text-slate-700 font-bold pr-1">ชิ้น</span>
          </div>

          <button
            type="button"
            aria-label="เพิ่มจำนวน"
            onClick={() =>
              isPrimary
                ? handleUpdatePrimaryQty((currentPrimaryQty || 0) + 1)
                : handleUpdateExtraQty(extraIdx!, (extraQtys[extraIdx!] || 0) + 1)
            }
            className="w-12 h-12 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-2xl flex items-center justify-center cursor-pointer transition-transform active:scale-95 shrink-0"
          >+</button>
        </div>
      </div>
    );
  };

  return (
    <div
      key={fieldId}
      className={`rounded-[20px] border transition-colors duration-200 ${
        isLocked
          ? "bg-black/[.03] border-[#E8ECEA] opacity-70"
          : isConfirmed
          ? "bg-[#EAF2EE]/70 border-[#C9DFD4]"
          : "bg-white border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
      }`}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        disabled={isLocked}
        aria-expanded={isExpanded}
        aria-label={`รายการที่ ${index + 1} ${name}`}
        className={`w-full text-left p-3.5 sm:p-4 flex items-center justify-between gap-3 select-none ${isLocked ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <span
            className={`px-2.5 py-1 rounded-lg font-mono text-sm font-bold shrink-0 ${
              isLocked ? "bg-white border border-black/10 text-slate-600" : "bg-[#111827] text-white"
            }`}
          >
            #{index + 1}
          </span>

          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {barcode ? (
                <>
                  <span className="font-mono font-bold text-base sm:text-lg text-[#111827] tracking-wide">
                    {barcode}
                  </span>
                  <span className="font-mono font-semibold text-sm text-[#667085]">
                    {sku}
                  </span>
                </>
              ) : (
                <span className="font-mono font-bold text-base sm:text-lg text-[#111827]">{sku}</span>
              )}
            </div>
            <span className="text-base font-bold text-slate-900 truncate mt-0.5" title={name}>
              {name}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {isLocked && (
            <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full border border-amber-200 shrink-0">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>รอคิว</span>
            </span>
          )}
          {isConfirmed && !isLocked && (
            <span className="hidden sm:inline-flex items-center gap-1 text-sm font-bold text-[#053425] bg-[#DFEDE6] px-2.5 py-1 rounded-full border border-[#C9DFD4] shrink-0">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>ยืนยันแล้ว</span>
            </span>
          )}

          {!isExpanded && locationBreakdowns.length > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EAF2EE] text-[#053425] font-semibold border border-[#DFEDE6] text-sm max-w-[260px]">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="font-mono truncate">{locationBreakdowns.map((item) => getLocationDisplay(item.loc)).join(", ")}</span>
            </span>
          )}

          <div className="px-3 py-1.5 rounded-xl bg-[#EAF2EE] border border-[#DFEDE6] text-[#052B1F] shrink-0 flex items-baseline gap-1">
            <span className="disp num text-lg font-bold">{(currentQty || 0).toLocaleString()}</span>
            <span className="text-sm font-bold">ชิ้น</span>
          </div>

          <svg
            className={`w-5 h-5 text-slate-600 transition-transform duration-200 ${isExpanded ? "rotate-180" : "rotate-0"}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="px-3.5 pb-4 sm:px-4 sm:pb-5 pt-3.5 border-t border-[#EEF1EF] space-y-3 fade-in">
          {renderSlot({
            slotNo: 1,
            isPrimary: true,
            scannedLoc: currentLocation,
          })}

          {extraLocations.map((extraLoc, extraIdx) =>
            renderSlot({
              slotNo: extraIdx + 2,
              isPrimary: false,
              extraIdx,
              scannedLoc: extraLoc,
            })
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={handleAddExtraSlot}
              className="min-h-11 px-4 rounded-xl bg-[#EAF2EE] hover:bg-[#DFEDE6] border border-[#C9DFD4] text-[#053425] text-sm font-bold flex items-center gap-2 cursor-pointer transition-colors shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              <span>เพิ่มตำแหน่ง</span>
            </button>
            <div className="text-sm text-[#667085] font-semibold text-right">
              รวม{" "}
              <span className="disp num text-[#053425] font-bold text-xl">{(currentQty || 0).toLocaleString()}</span>{" "}
              ชิ้น · {1 + extraLocations.length} ตำแหน่ง
            </div>
          </div>

          <button
            type="button"
            disabled={hasUnscannedSlot || hasNoQty}
            onClick={() => {
              if (hasUnscannedSlot || hasNoQty) return;
              onToggleConfirm(index);
              setIsExpanded(false);
            }}
            className={`w-full py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed ${
              hasUnscannedSlot || hasNoQty
                ? "bg-amber-50 border border-amber-200 text-amber-800"
                : "bg-[#06402B] hover:bg-[#053425] text-white shadow-lg shadow-[#06402B]/20 active:scale-[.98] transition-transform cursor-pointer"
            }`}
          >
            {hasUnscannedSlot ? (
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span>{hasUnscannedSlot ? "สแกนตำแหน่งก่อน" : hasNoQty ? "ระบุจำนวนก่อน" : "ยืนยันรายการนี้"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCancelModal(true)}
            className="w-full min-h-11 py-2 rounded-xl bg-white text-rose-700 text-sm font-bold flex items-center justify-center gap-2 hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>ลบรายการนี้</span>
          </button>
        </div>
      )}

      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs fade-in">
          <div className="w-full max-w-sm bg-white rounded-[20px] border border-[#E8ECEA] shadow-xl p-5 space-y-4 scale-in">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h4 className="text-lg font-extrabold text-[#111827]">ลบรายการนี้?</h4>
              <p className="text-sm text-slate-600">
                ลบ <strong className="text-slate-900">{name}</strong> (#{index + 1}){barcode ? ` บาร์โค้ด ${barcode}` : ""} ออกจากใบรับ?
              </p>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="flex-1 min-h-11 rounded-xl bg-white border border-black/10 text-slate-700 font-bold text-sm hover:bg-black/[.04] transition-colors cursor-pointer"
              >ย้อนกลับ</button>
              <button
                type="button"
                onClick={() => { setShowCancelModal(false); onRemove(index); }}
                className="flex-1 min-h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm cursor-pointer transition-colors active:scale-95"
              >ยืนยันลบ</button>
            </div>
          </div>
        </div>
      )}

      <CameraBarcodeScannerModal
        isOpen={cameraSlot !== null}
        onClose={() => setCameraSlot(null)}
        onScan={(code) => {
          const clean = code.trim();
          if (!clean || !cameraSlot) return;
          if (cameraSlot.isPrimary) handleLocScanSubmit(clean);
          else if (cameraSlot.extraIdx !== undefined) handleExtraLocScanSubmit(cameraSlot.extraIdx, clean);
        }}
      />
    </div>
  );
}
