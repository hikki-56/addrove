"use client";

import React, { useEffect, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { createPortal } from "react-dom";
import { type TransferNotification, updateTransferTaskProgress, getInStockSourceLocations, isUsableLocationCode } from "@/lib/transfer-notification-utils";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import type { Product } from "@/types/models";

export interface TransferStaffWorkflowModalProps {
  selectedTask: TransferNotification | null;
  products?: Product[];
  onClose: () => void;
  staffStep: number;
  setStaffStep: (step: number) => void;
  staffScanProductInput: string;
  setStaffScanProductInput: (val: string) => void;
  staffScanSourceLocationInput: string;
  setStaffScanSourceLocationInput: (val: string) => void;
  staffScanDestLocationInput: string;
  setStaffScanDestLocationInput: (val: string) => void;
  scannedToLocation?: string;
  setScannedToLocation?: (val: string) => void;
  isSubmittingTransfer?: boolean;
  onSubmitTransfer?: () => void;
  sourceAllocations?: Array<{ location_id: string; location_name?: string; max_qty?: number; qty: number }>;
  onUpdateSourceAllocationQty?: (index: number, newQty: number) => void;
  onRemoveSourceAllocation?: (index: number) => void;
  onProceedToDestStep?: () => void;
  staffError: string;
  staffSuccess: string;
  staffProductInputRef: React.RefObject<HTMLInputElement | null>;
  staffSourceLocationInputRef: React.RefObject<HTMLInputElement | null>;
  staffDestLocationInputRef: React.RefObject<HTMLInputElement | null>;
  onVerifyProductBarcode: (code: string) => void;
  onVerifySourceLocationBarcode: (code: string) => void;
  onVerifyDestinationLocationBarcode: (code: string) => void;
}

export default function TransferStaffWorkflowModal({
  selectedTask,
  products,
  onClose,
  staffStep,
  setStaffStep,
  staffScanProductInput,
  setStaffScanProductInput,
  staffScanSourceLocationInput,
  setStaffScanSourceLocationInput,
  staffScanDestLocationInput,
  setStaffScanDestLocationInput,
  scannedToLocation = "",
  setScannedToLocation,
  isSubmittingTransfer = false,
  onSubmitTransfer,
  sourceAllocations = [],
  onUpdateSourceAllocationQty,
  onRemoveSourceAllocation,
  onProceedToDestStep,
  staffError,
  staffSuccess,
  staffProductInputRef,
  staffSourceLocationInputRef,
  staffDestLocationInputRef,
  onVerifyProductBarcode,
  onVerifySourceLocationBarcode,
  onVerifyDestinationLocationBarcode,
}: TransferStaffWorkflowModalProps) {
  const [mounted, setMounted] = useState(false);
  const [fetchedLoc, setFetchedLoc] = useState<string>("");

  useEffect(() => {
    if (!selectedTask) return;

    // แสดงเฉพาะชั้นวางที่ยังมีสต็อกเหลืออยู่จริง (ตัดชั้นวางที่เคยสแกน/หยิบจนหมดไปแล้วออก)
    const liveLocs = getInStockSourceLocations(selectedTask, products);
    if (liveLocs) {
      setFetchedLoc(liveLocs.join(", "));
      return;
    }

    // Check direct on task
    const taskLoc = (selectedTask.from_location_id || selectedTask.location_code || "").trim();
    if (isUsableLocationCode(taskLoc)) {
      setFetchedLoc(taskLoc.replace(/^loc-/, ""));
      return;
    }

    // Check matched in products prop
    const normSku = (selectedTask.sku || "").trim().toLowerCase().replace(/^prod-/, "");
    const normPid = (selectedTask.product_id || "").trim().toLowerCase().replace(/^prod-/, "");
    const matched = products?.find((p) => {
      const pSku = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
      const pId = (p.product_id || "").trim().toLowerCase().replace(/^prod-/, "");
      return (normSku && (pSku === normSku || pId === normSku)) || (normPid && (pId === normPid || pSku === normPid));
    });

    if (matched) {
      if (matched.locations_breakdown && matched.locations_breakdown.length > 0) {
        const normFromWh = (selectedTask.from_warehouse_id || "").toLowerCase();
        const normFromWhName = (selectedTask.from_warehouse_name || "").toLowerCase();
        const found = matched.locations_breakdown.find((b) => {
          const bId = (b.warehouse_id || "").toLowerCase();
          const bName = (b.warehouse_name || "").toLowerCase();
          return (normFromWh && bId === normFromWh) || (normFromWhName && bName === normFromWhName);
        });
        const bLoc = (found?.location || "").trim();
        if (bLoc && bLoc !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(bLoc) && bLoc !== "A1") {
          setFetchedLoc(bLoc.replace(/^loc-/, ""));
          return;
        }
      }
      const pLoc = (matched.location || "").trim();
      if (pLoc && pLoc !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(pLoc) && pLoc !== "A1") {
        const whNumMatch = (selectedTask.from_warehouse_name || selectedTask.from_warehouse_id || "").match(/[1-9]/);
        if (whNumMatch && pLoc.includes(",")) {
          const whNum = whNumMatch[0];
          const parts = pLoc.split(",").map((s) => s.trim());
          const matchedPart = parts.find((part) => part.startsWith(whNum) || part.toLowerCase().startsWith(`wh${whNum}`) || part.toLowerCase().startsWith(`loc-${whNum}`));
          if (matchedPart) {
            setFetchedLoc(matchedPart.replace(/^loc-/, ""));
            return;
          }
        }
        setFetchedLoc(pLoc.replace(/^loc-/, ""));
        return;
      }
    }

    // Auto-fetch if not found
    const term = (selectedTask.sku || selectedTask.product_id || "").trim();
    if (!term) return;

    let active = true;
    fetch(`/api/products?search=${encodeURIComponent(term)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!active || !json.success || !Array.isArray(json.data)) return;
        const normTerm = term.toLowerCase().replace(/^prod-/, "");
        const foundProd = json.data.find((p: Product) => {
          const pSku = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
          const pId = (p.product_id || "").trim().toLowerCase().replace(/^prod-/, "");
          return pSku === normTerm || pId === normTerm;
        });
        if (foundProd) {
          // ใช้เฉพาะชั้นวางที่ยังมีสต็อกเหลืออยู่จริงจากข้อมูลล่าสุด
          const liveFetchedLocs = getInStockSourceLocations(selectedTask, [foundProd]);
          if (liveFetchedLocs) {
            setFetchedLoc(liveFetchedLocs.join(", "));
            return;
          }
          if (foundProd.locations_breakdown && foundProd.locations_breakdown.length > 0) {
            const normFromWh = (selectedTask.from_warehouse_id || "").toLowerCase();
            const normFromWhName = (selectedTask.from_warehouse_name || "").toLowerCase();
            const foundBreakdown = foundProd.locations_breakdown.find((b: any) => {
              const bId = (b.warehouse_id || "").toLowerCase();
              const bName = (b.warehouse_name || "").toLowerCase();
              return (normFromWh && bId === normFromWh) || (normFromWhName && bName === normFromWhName);
            });
            if (foundBreakdown?.location && foundBreakdown.location !== "-") {
              setFetchedLoc(foundBreakdown.location.replace(/^loc-/, ""));
              return;
            }
          }
          const loc = (foundProd.location || "").trim();
          if (loc && loc !== "-") {
            const whNumMatch = (selectedTask.from_warehouse_name || selectedTask.from_warehouse_id || "").match(/[1-9]/);
            if (whNumMatch && loc.includes(",")) {
              const whNum = whNumMatch[0];
              const parts = loc.split(",").map((s: string) => s.trim());
              const matchedPart = parts.find((part: string) => part.startsWith(whNum) || part.toLowerCase().startsWith(`loc-${whNum}`));
              if (matchedPart) {
                setFetchedLoc(matchedPart.replace(/^loc-/, ""));
                return;
              }
            }
            setFetchedLoc(loc.replace(/^loc-/, ""));
          }
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [selectedTask, products]);

  useEffect(() => {
    setMounted(true);
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, []);

  useEffect(() => {
    // step 4 ถูกบันทึกพร้อมข้อความ canonical จาก handleSubmitTransfer แล้ว —
    // ห้ามเขียนทับด้วยการเรียกซ้ำที่ไม่มี stepText
    if (selectedTask?.id && staffStep && staffStep !== 4) {
      updateTransferTaskProgress(selectedTask.id, staffStep);
    }
  }, [selectedTask?.id, staffStep]);

  useEscapeKey(!!selectedTask && mounted, onClose);

  if (!selectedTask || !mounted) return null;

  const totalPickedQty = sourceAllocations.reduce((sum, a) => sum + (a.qty || 0), 0);
  const remainingNeeded = Math.max(0, selectedTask.qty - totalPickedQty);
  const isCompleteAlloc = totalPickedQty === selectedTask.qty;
  const rawBarcode = selectedTask.barcode && selectedTask.barcode.trim() !== "-" ? selectedTask.barcode.trim() : "";
  const barcode = rawBarcode || selectedTask.sku || "";

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] bg-white overflow-y-auto overscroll-y-contain flex flex-col w-full h-[100dvh]"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="w-full max-w-lg mx-auto min-h-full flex flex-col justify-between p-3.5 sm:p-6 pb-28 sm:pb-10 space-y-4 min-w-0 bg-white">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[#E8ECEA] gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="px-2.5 sm:px-3 py-1 rounded-xl bg-[#EAF2EE] text-[#053425] font-mono font-bold text-sm border border-[#C9DFD4] shrink-0">
                {selectedTask.doc_no}
              </span>
              <span className="text-sm text-slate-600 font-medium truncate max-w-[160px] sm:max-w-[280px]">
                ผู้สร้าง: <strong className="text-slate-900 font-semibold">{selectedTask.created_by_name || selectedTask.created_by || "ผู้ดูแลระบบ (Admin)"}</strong>
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่าง"
              className="w-11 h-11 rounded-xl flex items-center justify-center text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 cursor-pointer transition-colors active:scale-95 shrink-0"
              title="ปิดหน้าต่าง"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Step Indicator — บอกตำแหน่งปัจจุบันเป็นข้อความตามหลัก P3 (ขั้นที่ n จาก N) */}
          <div className="space-y-1">
            <p className="text-center text-sm font-bold text-slate-600">
              {staffStep === 4 ? "ครบทุกขั้นตอนแล้ว" : `ขั้นที่ ${staffStep === 1 ? 1 : 2} จาก 2`}
            </p>
            <div className="relative flex items-center justify-between px-6 sm:px-12 py-3">
              {/* Connector Line */}
              <div className="absolute left-14 right-14 top-[32px] h-1 bg-slate-200 rounded-full -z-0">
                <div
                  className="h-full bg-[#0F5C3F] rounded-full transition-all duration-300"
                  style={{
                    width: staffStep === 1 ? "0%" : "100%",
                  }}
                />
              </div>

              {/* Step 1 */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-extrabold transition-all duration-200 ${
                    staffStep === 1
                      ? "bg-[#06402B] text-white shadow-md shadow-[#06402B]/30 ring-4 ring-[#0F5C3F]/10 scale-105"
                      : staffStep > 1
                      ? "bg-[#06402B] text-white"
                      : "bg-slate-100 text-slate-600 border border-[#D5DDD9]"
                  }`}
                >
                  {staffStep > 1 ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    "1"
                  )}
                </div>
                <span
                  className={`text-sm font-bold transition-colors ${
                    staffStep >= 1 ? "text-[#052B1F] font-extrabold" : "text-slate-600"
                  }`}
                >
                  สแกนสินค้า
                </span>
              </div>

              {/* Step 3 (แสดงเป็นขั้นตอนปลายทาง) */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-extrabold transition-all duration-200 ${
                    staffStep >= 3
                      ? "bg-[#06402B] text-white shadow-md shadow-[#06402B]/30 ring-4 ring-[#0F5C3F]/10 scale-105"
                      : "bg-slate-100 text-slate-600 border border-[#D5DDD9]"
                  }`}
                >
                  {staffStep > 3 ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    "2"
                  )}
                </div>
                <span
                  className={`text-sm font-bold transition-colors ${
                    staffStep >= 3 ? "text-[#052B1F] font-extrabold" : "text-slate-600"
                  }`}
                >
                  ตำแหน่งปลายทาง
                </span>
              </div>
            </div>
          </div>

          {/* Product & Route Summary Card (Readable formula from issue-flow.md) */}
          <div className="rounded-2xl border border-[#E8ECEA] bg-white p-4 sm:p-5 space-y-3 shadow-xs">
            {/* ช่องสแกนของขั้นปัจจุบัน — ไว้บนสุดของการ์ดรายละเอียดสินค้าให้พนักงานเห็นทันที */}
            {staffStep === 1 && (
              <div className="space-y-2">
                <label htmlFor="staff-scan-product" className="flex items-center text-base font-bold text-slate-900">
                  สแกนบาร์โค้ดสินค้าบนตัวสินค้า:
                </label>
                <BarcodeScanInput
                  id="staff-scan-product"
                  value={staffScanProductInput}
                  onChange={setStaffScanProductInput}
                  onScanSubmit={onVerifyProductBarcode}
                  inputRef={staffProductInputRef}
                  placeholder={barcode ? `สแกนหรือพิมพ์ ${barcode}...` : "สแกนบาร์โค้ดสินค้า..."}
                />
              </div>
            )}

            {staffStep === 3 && (
              <div className="space-y-2">
                <label htmlFor="staff-scan-dest-location" className="block text-base font-bold text-slate-900">
                  สแกนตำแหน่งปลายทางใน {selectedTask.to_warehouse_name}:
                </label>
                <BarcodeScanInput
                  id="staff-scan-dest-location"
                  value={staffScanDestLocationInput}
                  onChange={(val) => {
                    setStaffScanDestLocationInput(val);
                    if (scannedToLocation && val !== scannedToLocation) {
                      setScannedToLocation?.("");
                    }
                  }}
                  onScanSubmit={onVerifyDestinationLocationBarcode}
                  inputRef={staffDestLocationInputRef}
                  placeholder="สแกนตำแหน่งปลายทาง..."
                />
              </div>
            )}

            <div className={`space-y-3 ${staffStep === 1 || staffStep === 3 ? "pt-3 border-t border-[#E8ECEA]" : ""}`}>
              <p className="text-lg sm:text-xl font-bold text-slate-900 leading-snug">{selectedTask.product_name}</p>
              <div className="flex items-center gap-3 flex-wrap font-mono text-sm">
                <span className="font-bold text-slate-700">SKU: <strong className="text-slate-900">{selectedTask.sku}</strong></span>
                {barcode && barcode !== selectedTask.sku && (
                  <span className="font-bold text-slate-700">บาร์โค้ด: <strong className="text-slate-900">{barcode}</strong></span>
                )}
              </div>

              <div className="flex items-baseline gap-2 pt-2 border-t border-[#E8ECEA]">
                <span className="text-sm font-bold text-slate-600">ต้องหยิบ</span>
                <span className="text-3xl font-mono font-bold text-slate-900">{selectedTask.qty.toLocaleString()}</span>
                <span className="text-sm font-bold text-slate-600">ชิ้น</span>
              </div>

              <p className="text-base text-slate-700 font-medium">
                จาก <span className="font-bold text-slate-950">{selectedTask.from_warehouse_name}</span>
                {" "}ไป <span className="font-bold text-slate-950">{selectedTask.to_warehouse_name}</span>
              </p>

              {/* ตำแหน่งปัจจุบัน ใต้ จาก...ไป... ตัวหนังสือใหญ่ชัดเจน */}
              <div className="flex items-baseline gap-2.5 pt-2.5 border-t border-[#E8ECEA]">
                <span className="text-base sm:text-lg font-bold text-slate-700">ตำแหน่งปัจจุบัน:</span>
                <span className="text-2xl sm:text-3xl font-mono font-black text-slate-950 tracking-wide">
                  {fetchedLoc || "ไม่ระบุ"}
                </span>
              </div>
            </div>
          </div>

          {/* Error Banner — 16px หนา ตามสเปก W4 (ข้อความที่พนักงานอ่านระหว่างถือของ) */}
          {staffStep !== 4 && staffError && (
            <div
              role="alert"
              className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-base font-bold leading-relaxed fade-in flex items-start gap-2.5 whitespace-pre-line"
            >
              <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z" />
              </svg>
              <span>{staffError}</span>
            </div>
          )}

          {/* Success note (ข้อความเขียวสั้นตามสเปก S6) — ซ่อนเมื่อแผงยืนยันเขียวของขั้น 2 โชว์อยู่เพื่อไม่ซ้ำซ้อน */}
          {staffStep !== 4 && !staffError && staffSuccess && !(staffStep === 3 && scannedToLocation) && (
            <div
              role="status"
              className="p-3.5 rounded-2xl bg-[#EAF2EE] border border-[#C9DFD4] text-[#052B1F] text-sm font-bold leading-relaxed fade-in flex items-start gap-2.5"
            >
              <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>{staffSuccess}</span>
            </div>
          )}

        {/* Step 2: Source Locations & Quantities */}
        {/*
        {staffStep === 2 && (
          <div className="space-y-3.5 pt-1">
            <div className="rounded-2xl border border-[#E8ECEA] bg-white p-4 space-y-3">
              <p className="text-sm font-bold text-slate-600">
                ตำแหน่งต้นทาง ({selectedTask.from_warehouse_name})
              </p>

              {remainingNeeded > 0 ? (
                <p className="text-base font-bold text-slate-900">
                  ยังขาดอีก{" "}
                  <span className="text-3xl font-mono font-bold text-[#053425] align-middle">
                    {remainingNeeded.toLocaleString()}
                  </span>{" "}
                  ชิ้น
                </p>
              ) : (
                <p className="text-xl font-bold text-[#053425]">หยิบครบแล้ว</p>
              )}

              <p className="text-sm text-slate-600 font-mono">
                หยิบแล้ว {totalPickedQty.toLocaleString()} จาก {selectedTask.qty.toLocaleString()} ชิ้น
              </p>

              <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${isCompleteAlloc ? "bg-[#06402B]" : "bg-[#06402B]"}`}
                  style={{ width: `${Math.min(100, (totalPickedQty / selectedTask.qty) * 100)}%` }}
                />
              </div>
            </div>

            {sourceAllocations.length > 0 && (
              <div className="space-y-2 max-h-[40dvh] overflow-y-auto pr-0.5">
                {sourceAllocations.map((alloc, idx) => (
                  <div key={`alloc-${idx}`} className="p-4 bg-white rounded-2xl border border-[#E8ECEA] shadow-xs space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-full bg-[#06402B] text-white text-base font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono font-bold text-slate-900 text-lg truncate">
                          {alloc.location_name || alloc.location_id}
                        </p>
                        {typeof alloc.max_qty === "number" && (
                          <p className="text-sm font-bold text-slate-600">
                            ชั้นนี้มี {alloc.max_qty.toLocaleString()} ชิ้น
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#EEF1EF]">
                      <span className="text-sm text-slate-700 font-bold">จำนวนที่หยิบ:</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onUpdateSourceAllocationQty && onUpdateSourceAllocationQty(idx, Math.max(1, alloc.qty - 100))}
                          className="w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center cursor-pointer text-lg active:scale-95"
                          aria-label="ลดจำนวน"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={alloc.max_qty || undefined}
                          value={alloc.qty}
                          onContextMenu={(e) => e.preventDefault()}
                          onChange={(e) => onUpdateSourceAllocationQty && onUpdateSourceAllocationQty(idx, parseInt(e.target.value) || 0)}
                          className="w-24 text-center font-mono font-bold text-lg bg-slate-50 border border-[#D5DDD9] rounded-xl px-2 py-2 text-[#04231A] focus:outline-none focus:ring-2 focus:ring-[#0F5C3F]"
                        />
                        <button
                          type="button"
                          onClick={() => onUpdateSourceAllocationQty && onUpdateSourceAllocationQty(idx, Math.min(alloc.max_qty || (alloc.qty + 100), alloc.qty + 100))}
                          className="w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center cursor-pointer text-lg active:scale-95"
                          aria-label="เพิ่มจำนวน"
                        >
                          +
                        </button>
                        <span className="text-sm text-slate-600 font-bold ml-1">ชิ้น</span>
                      </div>
                    </div>

                    {onRemoveSourceAllocation && (
                      <button
                        type="button"
                        onClick={() => onRemoveSourceAllocation(idx)}
                        className="w-full py-3 rounded-xl border border-rose-200 text-rose-700 font-bold text-sm hover:bg-rose-50 cursor-pointer transition-all"
                      >
                        เอาชั้นนี้ออกจากรายการ
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {remainingNeeded > 0 && (
              <div className="space-y-2 pt-1">
                <div className="block text-base font-bold text-slate-900">
                  {sourceAllocations.length === 0
                    ? "สแกนตำแหน่งต้นทาง:"
                    : `สแกนตำแหน่งที่ ${sourceAllocations.length + 1} (ยังขาดอีก ${remainingNeeded.toLocaleString()} ชิ้น):`}
                </div>
                <BarcodeScanInput
                  value={staffScanSourceLocationInput}
                  onChange={setStaffScanSourceLocationInput}
                  onScanSubmit={onVerifySourceLocationBarcode}
                  inputRef={staffSourceLocationInputRef}
                  placeholder={sourceAllocations.length === 0 ? "สแกนตำแหน่งต้นทาง..." : `สแกนตำแหน่งที่ ${sourceAllocations.length + 1}...`}
                />
              </div>
            )}

            {isCompleteAlloc && (
              <button
                type="button"
                onClick={onProceedToDestStep}
                className="w-full py-4 px-4 rounded-2xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-[#06402B]/20 cursor-pointer transition-all active:scale-95"
              >
                <span>ถัดไป: สแกนตำแหน่งปลายทาง</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            )}
          </div>
        )}
        */}

        {/* Step 3: Destination Location Confirmation (เด้งมาตรงกลางจอเมื่อสแกนสำเร็จ) */}
        {staffStep === 3 && scannedToLocation && (
          <div className="fixed inset-0 z-[100000] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-sm sm:max-w-md bg-white rounded-3xl p-5 sm:p-6 shadow-2xl border-2 border-[#06402B] space-y-4 animate-in zoom-in-95 duration-200 text-left">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[#E8ECEA]">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-full bg-[#EAF2EE] text-[#053425] flex items-center justify-center text-sm font-bold shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="text-base font-extrabold text-slate-900">สแกนชั้นวางปลายทางสำเร็จ</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setScannedToLocation?.("");
                    setStaffScanDestLocationInput("");
                    setTimeout(() => staffDestLocationInputRef?.current?.focus(), 50);
                  }}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  title="ปิด / สแกนใหม่"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Target Shelf Box */}
              <div className="bg-[#F7F9F8] p-4 rounded-2xl border border-[#C9DFD4] shadow-xs flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#EAF2EE] text-[#053425] flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-[#053425]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-xs text-slate-600 font-bold uppercase tracking-wider">ตำแหน่งปลายทาง</div>
                    <div className="font-mono font-black text-2xl sm:text-3xl text-[#031B14] tracking-wider">
                      {scannedToLocation}
                    </div>
                  </div>
                </div>
                <span className="text-xs sm:text-sm font-bold text-[#052B1F] bg-[#DFEDE6] px-3 py-1.5 rounded-xl border border-[#C9DFD4] shrink-0">
                  {selectedTask.to_warehouse_name}
                </span>
              </div>

              {/* Product Summary Mini Card */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-sm space-y-1">
                <div className="font-bold text-slate-800 line-clamp-1">{selectedTask.product_name}</div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-mono">SKU: <strong className="text-slate-900">{selectedTask.sku}</strong></span>
                  <span>จำนวน: <strong className="text-slate-900 font-mono text-sm font-bold">{selectedTask.qty.toLocaleString()}</strong> ชิ้น</span>
                </div>
              </div>

              {/* Submit error — ปกติ staffError ถูก render อยู่หลัง overlay นี้มองไม่เห็น
                  ต้องโชว์ในป๊อปอัปด้วย ไม่งั้นพนักงานกดยืนยันแล้วเงียบจะคิดว่าเสร็จแล้ว */}
              {staffError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold leading-relaxed" role="alert">
                  {staffError}
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={isSubmittingTransfer}
                  onClick={onSubmitTransfer}
                  className="w-full py-4 px-4 rounded-2xl bg-[#06402B] hover:bg-[#053425] active:scale-95 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-[#06402B]/30 cursor-pointer transition-all disabled:opacity-50"
                >
                  {isSubmittingTransfer ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                      <span>กำลังบันทึกข้อมูล...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>ยืนยันการเบิก (ส่งให้ Admin อนุมัติ)</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isSubmittingTransfer}
                  onClick={() => {
                    setScannedToLocation?.("");
                    setStaffScanDestLocationInput("");
                    setTimeout(() => staffDestLocationInputRef?.current?.focus(), 50);
                  }}
                  className="w-full py-2.5 text-center text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  ต้องการเปลี่ยนตำแหน่ง / สแกนใหม่
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Submission to Admin Completion Popup (เด้งมาตรงกลางจอ) */}
        {staffStep === 4 && (
          <div className="fixed inset-0 z-[100000] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-sm sm:max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-[#C9DFD4] text-center space-y-4 animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-full bg-[#EAF2EE] text-[#053425] flex items-center justify-center mx-auto shadow-sm ring-8 ring-[#EAF2EE]/50">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div className="space-y-1">
                <span className="px-3 py-1 rounded-full bg-[#EAF2EE] text-[#053425] font-mono font-bold text-xs border border-[#C9DFD4] inline-block">
                  {selectedTask.doc_no}
                </span>
                <h4 className="text-xl sm:text-2xl font-extrabold text-slate-900 pt-1">
                  เบิกสินค้าและส่งข้อมูลเรียบร้อยแล้ว
                </h4>
              </div>

              <p className="text-sm text-slate-600 leading-relaxed max-w-xs mx-auto">
                การเบิกสินค้าเสร็จสิ้น ข้อมูลถูกส่งไปให้ <strong>ผู้ดูแลระบบ (Admin)</strong> กดอนุมัติเพื่อบันทึกข้อมูลเข้าระบบเรียบร้อยแล้ว
              </p>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-4 px-6 rounded-2xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-base cursor-pointer shadow-lg shadow-[#06402B]/20 active:scale-95 transition-all"
              >
                ปิดหน้าต่าง / กลับสู่รายการ
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>,
    document.body
  );
}
