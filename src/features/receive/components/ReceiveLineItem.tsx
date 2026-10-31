"use client";

import React from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import type { ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { M3Dialog, M3NumberTile, m3Cls } from "@/components/ui/m3";
import { SolarAddLine, SolarAltArrowDown, SolarCheckCircle, SolarClockCircle, SolarDangerTriangle, SolarMapPoint, SolarMinusLine, SolarQrCode } from "@/components/icons";
import { prepareFeedbackAudio } from "@/client/feedback";

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
  onScanLocation: (index: number, code: string, playSound?: boolean) => void | Promise<void>;
  onScanFeedback?: (feedback: ScanFeedback | null, playSound?: boolean) => void;
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
  const baseUnit = matchedProd?.base_unit || "ชิ้น";
  const packSize = matchedProd?.units_per_carton;
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

  const handleLocScanSubmit = async (rawCode: string, playSound = false) => {
    const code = rawCode.trim();
    if (!code) return;
    await onScanLocation(index, code, playSound);
    setLocScanInput("");
  };

  const handleExtraLocScanSubmit = (extraIdx: number, rawCode: string, playSound = false) => {
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
      }, playSound);
      return;
    }
    const updated = [...extraLocations];
    updated[extraIdx] = code.toUpperCase();
    setValue(`lines.${index}.extra_locations` as any, updated, { shouldValidate: true, shouldDirty: true });
    setExtraLocScanInputs((prev) => ({ ...prev, [extraIdx]: "" }));
    onScanFeedback?.({
      type: "success",
      title: "บันทึกตำแหน่งแล้ว",
      message: code.toUpperCase(),
    }, playSound);
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
    "h-13 w-full rounded-lg border border-[rgba(145,158,171,0.32)] bg-white pr-14 pl-11 text-base font-semibold tabular-nums text-m3-grey-800 outline-none transition-colors placeholder:font-normal placeholder:text-m3-grey-500 focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800";

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
      <div className="space-y-3 rounded-xl border border-[rgba(145,158,171,0.2)] p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-m3-grey-800 flex items-center gap-2 min-w-0">
            <M3NumberTile className="size-6 text-xs">{slotNo}</M3NumberTile>
            <span className="truncate">
              ตำแหน่ง {slotNo}
              {isPrimary && extraLocations.length > 0 ? " (หลัก)" : ""}
            </span>
          </span>

          <div className="flex items-center gap-2 shrink-0">
            {isScanned && (
              <span className="m3-label m3-label-success max-w-[180px] gap-1 sm:max-w-none">
                <SolarMapPoint size={14} className="shrink-0" />
                <span className="tabular-nums truncate">{getLocationDisplay(scannedLoc!)}</span>
              </span>
            )}

            {!isPrimary && (
              <button
                type="button"
                onClick={() => handleRemoveExtraSlot(extraIdx!)}
                aria-label={`ลบตำแหน่ง ${slotNo}`}
                className="m3-btn m3-btn-sm m3-btn-text gap-1.5 text-m3-error-dark hover:bg-[rgba(255,86,48,0.08)]"
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
          <SolarQrCode size={20} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-m3-grey-500" />
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
            onClick={() => {
              prepareFeedbackAudio();
              setCameraSlot({ isPrimary, extraIdx });
            }}
            aria-label={`เปิดกล้องสแกนตำแหน่งที่ ${slotNo}`}
            title="เปิดกล้องสแกน"
            className="absolute top-1/2 right-1.5 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-m3-grey-700 transition-colors hover:bg-[rgba(145,158,171,0.08)] active:scale-95"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0118.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        <div className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-[rgba(145,158,171,0.2)] bg-white p-1.5 sm:gap-3 sm:p-2">
          <button
            type="button"
            aria-label="ลดจำนวน"
            onClick={() =>
              isPrimary
                ? handleUpdatePrimaryQty(Math.max(0, (currentPrimaryQty ?? 0) - 1))
                : handleUpdateExtraQty(extraIdx!, Math.max(1, (extraQtys[extraIdx!] || 1) - 1))
            }
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-m3-grey-200 text-m3-grey-800 transition-transform hover:bg-m3-grey-300 active:scale-95 sm:size-12"
          ><SolarMinusLine size={20} /></button>

          <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 sm:gap-2 px-1">
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={(isPrimary ? currentPrimaryQty : extraQtys[extraIdx!]) || ""}
              onContextMenu={(e) => e.preventDefault()}
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
              className="w-full max-w-[90px] bg-transparent py-1.5 text-center font-m3-disp text-2xl font-bold tabular-nums text-m3-grey-800 select-none focus:outline-none [-webkit-touch-callout:none] sm:max-w-[120px] sm:text-[28px]"
            />
            <span className="text-sm sm:text-base text-m3-grey-700 font-bold shrink-0">{baseUnit}</span>
          </div>

          <button
            type="button"
            aria-label="เพิ่มจำนวน"
            onClick={() =>
              isPrimary
                ? handleUpdatePrimaryQty((currentPrimaryQty || 0) + 1)
                : handleUpdateExtraQty(extraIdx!, (extraQtys[extraIdx!] || 0) + 1)
            }
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-m3-grey-800 text-white transition-transform hover:bg-m3-grey-700 active:scale-95 sm:size-12"
          ><SolarAddLine size={20} /></button>
        </div>
      </div>
    );
  };

  return (
    <div
      key={fieldId}
      className={`rounded-2xl transition-colors duration-200 ${
        isLocked
          ? "border border-dashed border-[rgba(145,158,171,0.32)] bg-m3-grey-100 opacity-72"
          : isConfirmed
          ? "border border-[rgba(0,167,111,0.24)] bg-[rgba(0,167,111,0.04)]"
          : "m3-card"
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
            className={`flex size-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular-nums ${
              isLocked ? "bg-white text-m3-grey-500" : isConfirmed ? "bg-m3-primary text-white" : "bg-m3-grey-200 text-m3-grey-800"
            }`}
          >
            {isConfirmed && !isLocked ? <SolarCheckCircle size={20} /> : `#${index + 1}`}
          </span>

          <div className="flex flex-col min-w-0 flex-1">
            <span className="truncate text-base font-bold text-m3-grey-800" title={name}>
              {name}
            </span>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5">
              {barcode ? (
                <>
                  <span className="text-xs tabular-nums text-m3-grey-500">บาร์โค้ด {barcode}</span>
                  <span className="hidden text-xs tabular-nums text-m3-grey-500 sm:inline">· {sku}</span>
                </>
              ) : (
                <span className="text-xs tabular-nums text-m3-grey-500">{sku}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {isLocked && (
            <span className="m3-label m3-label-warning shrink-0 gap-1">
              <SolarClockCircle size={14} className="shrink-0" />
              <span>รอคิว</span>
            </span>
          )}
          {isConfirmed && !isLocked && (
            <span className="m3-label m3-label-success hidden shrink-0 gap-1 sm:inline-flex">
              <span>ยืนยันแล้ว</span>
            </span>
          )}

          {!isExpanded && locationBreakdowns.length > 0 && (
            <span className="m3-label m3-label-default hidden max-w-[260px] gap-1 sm:inline-flex">
              <SolarMapPoint size={14} className="shrink-0" />
              <span className="tabular-nums truncate">{locationBreakdowns.map((item) => getLocationDisplay(item.loc)).join(", ")}</span>
            </span>
          )}

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div
              className="flex items-baseline gap-1 rounded-lg bg-m3-grey-100 px-2 py-1 text-m3-grey-600 sm:px-2.5 sm:py-1.5"
              title={`สแกนไปแล้ว ${(currentBoxes || 0).toLocaleString()} กล่อง`}
            >
              <span className="font-m3-disp text-base font-bold tabular-nums">{(currentBoxes || 0).toLocaleString()}</span>
              <span className="text-xs">กล่อง</span>
            </div>

            <div className="flex items-baseline gap-1 text-m3-grey-800">
              <span className="font-m3-disp text-xl font-bold tabular-nums">{(currentQty || 0).toLocaleString()}</span>
              <span className="text-sm text-m3-grey-600">{baseUnit}</span>
            </div>
          </div>

          <SolarAltArrowDown
            size={20}
            className={`text-m3-grey-500 transition-transform duration-200 ${isExpanded ? "rotate-180" : "rotate-0"}`}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="fade-in space-y-3 border-t border-dashed border-[rgba(145,158,171,0.32)] px-4 pt-4 pb-4 sm:px-5 sm:pb-5">
          {packSize ? (
            <span className="m3-label m3-label-info">กล่อง {packSize.toLocaleString()} {baseUnit}</span>
          ) : null}
          <p className="text-sm text-m3-grey-600">
            {packSize
              ? `สแกน 1 ครั้ง = 1 กล่อง (${packSize.toLocaleString()} ${baseUnit}) · แก้จำนวนตามของจริงได้`
              : "ยังไม่มีจำนวนบรรจุ — กรุณากรอกจำนวนตามของจริง"}
          </p>
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
              className="m3-btn m3-btn-text shrink-0 gap-1.5 px-1 text-m3-primary-dark"
            >
              <SolarAddLine size={18} />
              <span>เพิ่มตำแหน่ง</span>
            </button>
          </div>

          <div className="flex flex-col-reverse items-stretch gap-2.5 sm:flex-row">
            <button
              type="button"
              onClick={() => setShowCancelModal(true)}
              className="m3-btn h-12 flex-1 gap-2 bg-[rgba(255,86,48,0.16)] text-base text-m3-error-dark hover:bg-[rgba(255,86,48,0.24)] sm:flex-none sm:px-6"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>ลบรายการนี้</span>
            </button>

            <button
              type="button"
              disabled={hasUnscannedSlot || hasNoQty}
              onClick={() => {
                if (hasUnscannedSlot || hasNoQty) return;
                onToggleConfirm(index);
                setIsExpanded(false);
              }}
              className={`m3-btn h-12 flex-1 gap-2 text-base disabled:cursor-not-allowed ${
                hasUnscannedSlot || hasNoQty
                  ? "bg-[rgba(255,171,0,0.16)] text-m3-warning-dark"
                  : "m3-btn-dark active:scale-[.98]"
              }`}
            >
              {hasUnscannedSlot ? (
                <SolarDangerTriangle size={20} className="shrink-0" />
              ) : (
                <SolarCheckCircle size={20} className="shrink-0" />
              )}
              <span>{hasUnscannedSlot ? "สแกนตำแหน่งก่อน" : hasNoQty ? "ระบุจำนวนก่อน" : "ยืนยันรายการนี้"}</span>
            </button>
          </div>
        </div>
      )}

      {showCancelModal && (
        <M3Dialog
          title="ลบรายการนี้?"
          icon={<SolarDangerTriangle size={28} />}
          iconTone="error"
          widthClass="sm:max-w-[400px]"
          hint={
            <>
              ลบ <strong className="text-m3-grey-800">{name}</strong> (#{index + 1}){barcode ? ` บาร์โค้ด ${barcode}` : ""} ออกจากใบรับ?
            </>
          }
          footer={
            <>
              <button type="button" onClick={() => setShowCancelModal(false)} className={m3Cls.btnCancel}>
                ย้อนกลับ
              </button>
              <button
                type="button"
                onClick={() => { setShowCancelModal(false); onRemove(index); }}
                className={m3Cls.btnDanger}
              >
                ยืนยันลบ
              </button>
            </>
          }
        />
      )}

      <CameraBarcodeScannerModal
        feedbackHandledByCaller
        isOpen={cameraSlot !== null}
        onClose={() => setCameraSlot(null)}
        onScan={async (code, playSound) => {
          const clean = code.trim();
          if (!clean || !cameraSlot) return;
          if (cameraSlot.isPrimary) await handleLocScanSubmit(clean, playSound);
          else if (cameraSlot.extraIdx !== undefined) handleExtraLocScanSubmit(cameraSlot.extraIdx, clean, playSound);
        }}
      />
    </div>
  );
}
