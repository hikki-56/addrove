"use client";

import React, { useEffect, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { createPortal } from "react-dom";
import { type TransferNotification, updateTransferTaskProgress, getInStockSourceLocations, isUsableLocationCode } from "@/lib/transfer-notification-utils";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import type { Product } from "@/types/models";
import { M3Banner, m3Cls } from "@/components/ui/m3";
import { SolarBox, SolarCheckCircle, SolarClose } from "@/components/icons";

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
  const [cameraTarget, setCameraTarget] = useState<"PRODUCT" | "SOURCE_LOCATION" | "DEST_LOCATION" | null>(null);
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
      <div className="mx-auto flex min-h-full w-full max-w-lg min-w-0 flex-col bg-white pb-28 sm:pb-10">
        <div className="space-y-5">
          {/* Header (M14) */}
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[rgba(145,158,171,0.2)] bg-white/95 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่าง"
              title="ปิดหน้าต่าง"
              className="-ml-2 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-m3-grey-800 transition-colors hover:bg-[rgba(145,158,171,0.08)] active:scale-95"
            >
              <SolarClose size={24} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-bold tabular-nums text-m3-grey-800">เบิก {selectedTask.doc_no}</div>
              <div className="truncate text-xs text-m3-grey-500">
                ผู้สร้าง: {selectedTask.created_by_name || selectedTask.created_by || "ผู้ดูแลระบบ (Admin)"}
              </div>
            </div>
          </div>

          <div className="space-y-5 px-4 sm:px-6">
          {/* Step Indicator — บอกตำแหน่งปัจจุบันเป็นข้อความตามหลัก P3 (ขั้นที่ n จาก N) */}
          <div className="space-y-2">
            <p className="flex items-baseline gap-2">
              <span className="text-sm font-bold text-m3-primary-dark">
                {staffStep === 4 ? "ครบทุกขั้นตอนแล้ว" : `ขั้นที่ ${staffStep === 1 ? 1 : 2} จาก 2`}
              </span>
              <span className="text-xs text-m3-grey-500">{staffStep === 1 ? "สแกนสินค้า" : "ตำแหน่งปลายทาง"}</span>
            </p>
            <div className="grid grid-cols-2 gap-1.5" aria-hidden="true">
              <span className="h-1 rounded-full bg-m3-primary" />
              <span className={`h-1 rounded-full transition-colors duration-300 ${staffStep >= 3 ? "bg-m3-primary" : "bg-[rgba(145,158,171,0.24)]"}`} />
            </div>
          </div>

          {/* ช่องสแกนของขั้นปัจจุบัน */}
          {staffStep === 1 && (
            <div className="space-y-2">
              <label htmlFor="staff-scan-product" className="block text-sm font-bold text-m3-grey-800">
                สแกนบาร์โค้ดสินค้าบนตัวสินค้า:
              </label>
              <BarcodeScanInput
                id="staff-scan-product"
                value={staffScanProductInput}
                onChange={setStaffScanProductInput}
                onScanSubmit={onVerifyProductBarcode}
                onOpenScannerModal={() => setCameraTarget("PRODUCT")}
                inputRef={staffProductInputRef}
                placeholder={barcode ? `สแกนหรือพิมพ์ ${barcode}...` : "สแกนบาร์โค้ดสินค้า..."}
              />
            </div>
          )}

          {staffStep === 3 && (
            <div className="space-y-2">
              <label htmlFor="staff-scan-dest-location" className="block text-sm font-bold text-m3-grey-800">
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
                onOpenScannerModal={() => setCameraTarget("DEST_LOCATION")}
                inputRef={staffDestLocationInputRef}
                placeholder="สแกนตำแหน่งปลายทาง..."
              />
            </div>
          )}

          {/* Product & Route Summary Card (M14) */}
          <div className="space-y-4 rounded-2xl bg-m3-grey-100 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-white text-m3-grey-500">
                <SolarBox size={28} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold tabular-nums text-black">
                  SKU: {selectedTask.sku}
                  {barcode && barcode !== selectedTask.sku ? ` · บาร์โค้ด: ${barcode}` : ""}
                </p>
                <p className="mt-0.5 text-base leading-snug font-bold text-m3-grey-800">{selectedTask.product_name}</p>
              </div>
            </div>

            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-m3-grey-600">ต้องหยิบ</span>
              <span>
                <span className="font-m3-disp text-[32px] leading-none font-bold tabular-nums text-m3-grey-800">{selectedTask.qty.toLocaleString()}</span>
                <span className="ml-1 text-sm text-m3-grey-600">ชิ้น</span>
              </span>
            </div>

            <p className="text-sm text-m3-grey-700">
              จาก <span className="font-bold text-m3-grey-800">{selectedTask.from_warehouse_name}</span>
              {" "}ไป <span className="font-bold text-m3-grey-800">{selectedTask.to_warehouse_name}</span>
            </p>

            {/* ตำแหน่งปัจจุบัน ใต้ จาก...ไป... ตัวหนังสือใหญ่ชัดเจน */}
            <div className="flex items-baseline gap-2.5 border-t border-dashed border-[rgba(145,158,171,0.32)] pt-4">
              <span className="text-sm font-semibold text-m3-grey-600">ตำแหน่งปัจจุบัน:</span>
              <span className="text-2xl font-bold tabular-nums tracking-wide text-m3-grey-800">{fetchedLoc || "ไม่ระบุ"}</span>
            </div>
          </div>

          {/* Error Banner — 16px หนา ตามสเปก W4 (ข้อความที่พนักงานอ่านระหว่างถือของ) */}
          {staffStep !== 4 && staffError && (
            <M3Banner tone="error" role="alert" className="fade-in text-base whitespace-pre-line">
              {staffError}
            </M3Banner>
          )}

          {/* Success note (ข้อความเขียวสั้นตามสเปก S6) — ซ่อนเมื่อแผงยืนยันเขียวของขั้น 2 โชว์อยู่เพื่อไม่ซ้ำซ้อน */}
          {staffStep !== 4 && !staffError && staffSuccess && !(staffStep === 3 && scannedToLocation) && (
            <M3Banner tone="success" role="status" className="fade-in">
              {staffSuccess}
            </M3Banner>
          )}
          </div>

        {/* Step 2: Source Locations & Quantities */}
        {/*
        {staffStep === 2 && (
          <div className="space-y-3.5 pt-1">
            <div className="rounded-xl border border-[rgba(145,158,171,0.2)] bg-white p-4 space-y-3">
              <p className="text-sm font-bold text-m3-grey-600">
                ตำแหน่งต้นทาง ({selectedTask.from_warehouse_name})
              </p>

              {remainingNeeded > 0 ? (
                <p className="text-base font-bold text-m3-grey-800">
                  ยังขาดอีก{" "}
                  <span className="text-3xl tabular-nums font-bold text-m3-primary-darker align-middle">
                    {remainingNeeded.toLocaleString()}
                  </span>{" "}
                  ชิ้น
                </p>
              ) : (
                <p className="text-xl font-bold text-m3-primary-darker">หยิบครบแล้ว</p>
              )}

              <p className="text-sm text-m3-grey-600 tabular-nums">
                หยิบแล้ว {totalPickedQty.toLocaleString()} จาก {selectedTask.qty.toLocaleString()} ชิ้น
              </p>

              <div className="w-full h-3 bg-m3-grey-300 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${isCompleteAlloc ? "bg-m3-primary" : "bg-m3-primary"}`}
                  style={{ width: `${Math.min(100, (totalPickedQty / selectedTask.qty) * 100)}%` }}
                />
              </div>
            </div>

            {sourceAllocations.length > 0 && (
              <div className="space-y-2 max-h-[40dvh] overflow-y-auto pr-0.5">
                {sourceAllocations.map((alloc, idx) => (
                  <div key={`alloc-${idx}`} className="p-4 bg-white rounded-xl border border-[rgba(145,158,171,0.2)] shadow-xs space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-full bg-m3-primary text-white text-base font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="tabular-nums font-bold text-m3-grey-800 text-lg truncate">
                          {alloc.location_name || alloc.location_id}
                        </p>
                        {typeof alloc.max_qty === "number" && (
                          <p className="text-sm font-bold text-m3-grey-600">
                            ชั้นนี้มี {alloc.max_qty.toLocaleString()} ชิ้น
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[rgba(145,158,171,0.2)]">
                      <span className="text-sm text-m3-grey-700 font-bold">จำนวนที่หยิบ:</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onUpdateSourceAllocationQty && onUpdateSourceAllocationQty(idx, Math.max(1, alloc.qty - 100))}
                          className="w-11 h-11 rounded-xl bg-m3-grey-200 hover:bg-m3-grey-300 text-m3-grey-800 font-bold flex items-center justify-center cursor-pointer text-lg active:scale-95"
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
                          className="w-24 text-center tabular-nums font-bold text-lg bg-m3-grey-100 border border-[rgba(145,158,171,0.32)] rounded-xl px-2 py-2 text-m3-primary-darker focus:outline-none focus:ring-2 focus:ring-m3-primary"
                        />
                        <button
                          type="button"
                          onClick={() => onUpdateSourceAllocationQty && onUpdateSourceAllocationQty(idx, Math.min(alloc.max_qty || (alloc.qty + 100), alloc.qty + 100))}
                          className="w-11 h-11 rounded-xl bg-m3-grey-200 hover:bg-m3-grey-300 text-m3-grey-800 font-bold flex items-center justify-center cursor-pointer text-lg active:scale-95"
                          aria-label="เพิ่มจำนวน"
                        >
                          +
                        </button>
                        <span className="text-sm text-m3-grey-600 font-bold ml-1">ชิ้น</span>
                      </div>
                    </div>

                    {onRemoveSourceAllocation && (
                      <button
                        type="button"
                        onClick={() => onRemoveSourceAllocation(idx)}
                        className="w-full py-3 rounded-xl border border-[rgba(255,86,48,0.24)] text-m3-error-dark font-bold text-sm hover:bg-[rgba(255,86,48,0.08)] cursor-pointer transition-all"
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
                <div className="block text-base font-bold text-m3-grey-800">
                  {sourceAllocations.length === 0
                    ? "สแกนตำแหน่งต้นทาง:"
                    : `สแกนตำแหน่งที่ ${sourceAllocations.length + 1} (ยังขาดอีก ${remainingNeeded.toLocaleString()} ชิ้น):`}
                </div>
                <BarcodeScanInput
                  value={staffScanSourceLocationInput}
                  onChange={setStaffScanSourceLocationInput}
                  onScanSubmit={onVerifySourceLocationBarcode}
                  onOpenScannerModal={() => setCameraTarget("SOURCE_LOCATION")}
                  inputRef={staffSourceLocationInputRef}
                  placeholder={sourceAllocations.length === 0 ? "สแกนตำแหน่งต้นทาง..." : `สแกนตำแหน่งที่ ${sourceAllocations.length + 1}...`}
                />
              </div>
            )}

            {isCompleteAlloc && (
              <button
                type="button"
                onClick={onProceedToDestStep}
                className="w-full py-4 px-4 rounded-xl bg-m3-primary hover:bg-m3-primary-darker text-white font-bold text-base flex items-center justify-center gap-2 shadow-m3-dropdown shadow-m3-primary/20 cursor-pointer transition-all active:scale-95"
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

        {/* Step 3: Destination Location Confirmation (M16 — bottom sheet มือถือ / dialog จอใหญ่) */}
        {staffStep === 3 && scannedToLocation && (
          <div className="fixed inset-0 z-[100000] flex items-end justify-center bg-m3-grey-800/48 animate-in fade-in duration-200 sm:items-center sm:p-4">
            <div className="w-full space-y-4 rounded-t-3xl bg-white px-5 pt-3 pb-6 text-left shadow-m3-dropdown animate-in slide-in-from-bottom-4 duration-200 sm:max-w-md sm:rounded-2xl sm:p-6">
              <div className="mx-auto h-1 w-10 rounded-full bg-m3-grey-300 sm:hidden" aria-hidden="true" />
              {/* Header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <SolarCheckCircle size={26} className="shrink-0 text-m3-success" />
                  <span className="text-lg font-bold text-m3-grey-800">สแกนชั้นวางปลายทางสำเร็จ</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setScannedToLocation?.("");
                    setStaffScanDestLocationInput("");
                    setTimeout(() => staffDestLocationInputRef?.current?.focus(), 50);
                  }}
                  className="flex size-9 cursor-pointer items-center justify-center rounded-full text-m3-grey-500 transition-colors hover:bg-[rgba(145,158,171,0.08)] hover:text-m3-grey-800"
                  title="ปิด / สแกนใหม่"
                  aria-label="ปิด / สแกนใหม่"
                >
                  <SolarClose size={20} />
                </button>
              </div>

              {/* Target Shelf Box */}
              <div className="space-y-1 rounded-2xl border-2 border-m3-primary bg-[rgba(0,167,111,0.06)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-m3-grey-600">ตำแหน่งปลายทาง</span>
                  <span className="m3-label m3-label-primary">{selectedTask.to_warehouse_name}</span>
                </div>
                <div className="font-m3-disp text-[34px] leading-tight font-bold tabular-nums tracking-wide text-m3-primary-darker">{scannedToLocation}</div>
                <div className="text-sm text-m3-grey-700">
                  <span className="line-clamp-1">{selectedTask.product_name}</span>
                  <span className="tabular-nums text-m3-grey-500">SKU: {selectedTask.sku}</span> · จำนวน:{" "}
                  <strong className="text-base font-bold tabular-nums text-m3-grey-800">{selectedTask.qty.toLocaleString()}</strong> ชิ้น
                </div>
              </div>

              {/* Submit error — ปกติ staffError ถูก render อยู่หลัง overlay นี้มองไม่เห็น
                  ต้องโชว์ในป๊อปอัปด้วย ไม่งั้นพนักงานกดยืนยันแล้วเงียบจะคิดว่าเสร็จแล้ว */}
              {staffError && (
                <M3Banner tone="error" role="alert">
                  {staffError}
                </M3Banner>
              )}

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={isSubmittingTransfer}
                  onClick={onSubmitTransfer}
                  className="m3-btn m3-btn-primary h-14 w-full gap-2 text-base shadow-[0_8px_16px_rgba(0,167,111,0.24)] active:scale-[.98] disabled:opacity-48"
                >
                  {isSubmittingTransfer ? (
                    <>
                      <span className={m3Cls.spinner} />
                      <span>กำลังบันทึกข้อมูล...</span>
                    </>
                  ) : (
                    <span>ยืนยันส่งเบิก</span>
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
                  className="w-full cursor-pointer py-2.5 text-center text-sm font-semibold text-m3-grey-600 transition-colors hover:text-m3-grey-800"
                >
                  ต้องการเปลี่ยนตำแหน่ง / สแกนใหม่
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Submission to Admin Completion (M17) */}
        {staffStep === 4 && (
          <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-m3-grey-800/48 p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-6 text-center shadow-m3-dropdown animate-in zoom-in-95 duration-200 sm:max-w-md sm:p-8">
              <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-[rgba(0,167,111,0.12)]">
                <span className="flex size-14 items-center justify-center rounded-full bg-m3-primary text-white">
                  <SolarCheckCircle size={32} />
                </span>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-2xl font-bold text-m3-grey-800">ส่งรายการเบิกแล้ว</h4>
                <p className="text-sm text-m3-grey-600">รออนุมัติ</p>
              </div>

              <div className="rounded-xl bg-m3-grey-100 px-4 py-3 text-left text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-m3-grey-600">เลขที่เอกสาร</span>
                  <span className="font-bold tabular-nums text-m3-grey-800">{selectedTask.doc_no}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="m3-btn m3-btn-primary h-12 w-full text-base shadow-[0_8px_16px_rgba(0,167,111,0.24)] active:scale-[.98]"
              >
                กลับสู่รายการ
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
      <CameraBarcodeScannerModal
        isOpen={cameraTarget !== null}
        onClose={() => setCameraTarget(null)}
        onScanSuccess={(code) => {
          const target = cameraTarget;
          setCameraTarget(null);
          if (target === "PRODUCT") onVerifyProductBarcode(code);
          else if (target === "SOURCE_LOCATION") onVerifySourceLocationBarcode(code);
          else if (target === "DEST_LOCATION") onVerifyDestinationLocationBarcode(code);
        }}
      />
    </div>,
    document.body
  );
}
