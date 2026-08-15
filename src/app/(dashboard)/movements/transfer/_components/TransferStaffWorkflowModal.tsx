"use client";

import React, { useEffect } from "react";
import { type TransferNotification, updateTransferTaskProgress } from "@/lib/transfer-notification-utils";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";

export interface TransferStaffWorkflowModalProps {
  selectedTask: TransferNotification | null;
  onClose: () => void;
  staffStep: number;
  setStaffStep: (step: number) => void;
  staffScanProductInput: string;
  setStaffScanProductInput: (val: string) => void;
  staffScanSourceLocationInput: string;
  setStaffScanSourceLocationInput: (val: string) => void;
  staffScanDestLocationInput: string;
  setStaffScanDestLocationInput: (val: string) => void;
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
  onOpenStaffCamera: (target: "PRODUCT" | "SOURCE_LOCATION" | "DEST_LOCATION") => void;
}

export default function TransferStaffWorkflowModal({
  selectedTask,
  onClose,
  staffStep,
  setStaffStep,
  staffScanProductInput,
  setStaffScanProductInput,
  staffScanSourceLocationInput,
  setStaffScanSourceLocationInput,
  staffScanDestLocationInput,
  setStaffScanDestLocationInput,
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
  onOpenStaffCamera,
}: TransferStaffWorkflowModalProps) {
  useEffect(() => {
    if (selectedTask?.id && staffStep) {
      updateTransferTaskProgress(selectedTask.id, staffStep);
    }
  }, [selectedTask?.id, staffStep]);

  if (!selectedTask) return null;

  const totalPickedQty = sourceAllocations.reduce((sum, a) => sum + (a.qty || 0), 0);
  const remainingNeeded = Math.max(0, selectedTask.qty - totalPickedQty);
  const isCompleteAlloc = totalPickedQty === selectedTask.qty;
  const rawBarcode = selectedTask.barcode && selectedTask.barcode.trim() !== "-" ? selectedTask.barcode.trim() : "";
  const barcode = rawBarcode || selectedTask.sku || "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-white border border-slate-200/90 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[94vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-mono font-bold text-xs border border-indigo-200/80">
              {selectedTask.doc_no}
            </span>
            <span className="text-xs text-slate-500 font-medium truncate max-w-[150px] sm:max-w-[220px]">
              {selectedTask.moved_by || "พนักงาน"}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-all"
          >
            ✕
          </button>
        </div>

        {/* Circular Green Step Indicator */}
        <div className="relative flex items-center justify-between px-6 sm:px-10 py-1.5">
          {/* Connector Line */}
          <div className="absolute left-12 right-12 top-[18px] h-0.5 bg-slate-200 -z-0">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{
                width: staffStep === 1 ? "0%" : staffStep === 2 ? "50%" : "100%",
              }}
            />
          </div>

          {/* Step 1 */}
          <div className="flex flex-col items-center gap-1 z-10">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold transition-all duration-200 ${
                staffStep === 1
                  ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30 ring-4 ring-emerald-100 scale-105"
                  : staffStep > 1
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-slate-400 border-2 border-slate-200"
              }`}
            >
              {staffStep > 1 ? "✓" : "1"}
            </div>
            <span
              className={`text-xs transition-colors ${
                staffStep === 1
                  ? "text-emerald-700 font-extrabold"
                  : staffStep > 1
                  ? "text-emerald-600 font-bold"
                  : "text-slate-400 font-medium"
              }`}
            >
              สแกนสินค้า
            </span>
          </div>

          {/* Step 2 */}
          <div className="flex flex-col items-center gap-1 z-10">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold transition-all duration-200 ${
                staffStep === 2
                  ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30 ring-4 ring-emerald-100 scale-105"
                  : staffStep > 2
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-slate-400 border-2 border-slate-200"
              }`}
            >
              {staffStep > 2 ? "✓" : "2"}
            </div>
            <span
              className={`text-xs transition-colors ${
                staffStep === 2
                  ? "text-emerald-700 font-extrabold"
                  : staffStep > 2
                  ? "text-emerald-600 font-bold"
                  : "text-slate-400 font-medium"
              }`}
            >
              ต้นทาง
            </span>
          </div>

          {/* Step 3 */}
          <div className="flex flex-col items-center gap-1 z-10">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold transition-all duration-200 ${
                staffStep === 3
                  ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30 ring-4 ring-emerald-100 scale-105"
                  : staffStep > 3
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-slate-400 border-2 border-slate-200"
              }`}
            >
              {staffStep > 3 ? "✓" : "3"}
            </div>
            <span
              className={`text-xs transition-colors ${
                staffStep === 3
                  ? "text-emerald-700 font-extrabold"
                  : staffStep > 3
                  ? "text-emerald-600 font-bold"
                  : "text-slate-400 font-medium"
              }`}
            >
              ปลายทาง
            </span>
          </div>
        </div>

        {/* Compact Product & Route Summary */}
        <div className="p-3.5 rounded-2xl bg-slate-50/90 border border-slate-200/80 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-extrabold text-slate-900 text-sm sm:text-base leading-snug line-clamp-1">
              {selectedTask.product_name}
            </h4>
            <span className="shrink-0 px-2.5 py-0.5 rounded-lg bg-indigo-100/70 text-indigo-800 font-mono font-extrabold text-xs">
              {selectedTask.qty.toLocaleString()} ชิ้น
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-500 font-medium">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span>SKU: <strong className="font-mono text-slate-800">{selectedTask.sku}</strong></span>
              {barcode && (
                <span>บาร์โค้ด: <strong className="font-mono text-slate-800">{barcode}</strong></span>
              )}
            </div>
            <div className="flex items-center gap-1.5 font-bold">
              <span className="text-slate-600">{selectedTask.from_warehouse_name}</span>
              <span className="text-slate-400">➔</span>
              <span className="text-emerald-700">{selectedTask.to_warehouse_name}</span>
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {staffStep !== 4 && staffError && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs font-semibold leading-relaxed animate-in fade-in">
            {staffError}
          </div>
        )}

        {/* Step 1: Scan Product Barcode */}
        {staffStep === 1 && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700">สแกนบาร์โค้ดสินค้าบนตัวสินค้า:</span>
              {barcode && (
                <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200/80">
                  บาร์โค้ด: {barcode}
                </span>
              )}
            </div>

            <BarcodeScanInput
              value={staffScanProductInput}
              onChange={setStaffScanProductInput}
              onScanSubmit={onVerifyProductBarcode}
              inputRef={staffProductInputRef}
              placeholder={barcode ? `สแกนหรือพิมพ์ ${barcode}...` : "สแกนบาร์โค้ดสินค้า..."}
            />
          </div>
        )}

        {/* Step 2: Source Locations & Quantities */}
        {staffStep === 2 && (
          <div className="space-y-3.5 pt-1">
            
            {/* Simple Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-slate-700">ตำแหน่งต้นทาง ({selectedTask.from_warehouse_name})</span>
                <span className={isCompleteAlloc ? "text-emerald-600" : "text-indigo-600 font-mono"}>
                  {totalPickedQty.toLocaleString()} / {selectedTask.qty.toLocaleString()} ชิ้น
                </span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${isCompleteAlloc ? "bg-emerald-500" : "bg-indigo-600"}`}
                  style={{ width: `${Math.min(100, (totalPickedQty / selectedTask.qty) * 100)}%` }}
                />
              </div>
            </div>

            {/* Picked Location Cards */}
            {sourceAllocations.length > 0 && (
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-0.5">
                {sourceAllocations.map((alloc, idx) => (
                  <div key={`alloc-${idx}`} className="p-3 bg-white rounded-2xl border border-indigo-100 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          {alloc.location_name || alloc.location_id}
                        </span>
                        {typeof alloc.max_qty === "number" && (
                          <span className="text-[11px] font-medium text-slate-500">
                            (มี {alloc.max_qty.toLocaleString()})
                          </span>
                        )}
                      </div>

                      {onRemoveSourceAllocation && (
                        <button
                          type="button"
                          onClick={() => onRemoveSourceAllocation(idx)}
                          className="text-rose-500 hover:text-rose-700 text-xs font-bold px-2 py-0.5 rounded hover:bg-rose-50 cursor-pointer"
                        >
                          ลบ
                        </button>
                      )}
                    </div>

                    {/* Numeric Quantity Stepper */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                      <span className="text-xs text-slate-500 font-medium">จำนวนที่หยิบ:</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onUpdateSourceAllocationQty && onUpdateSourceAllocationQty(idx, Math.max(1, alloc.qty - 100))}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer text-xs active:scale-95"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={alloc.max_qty || undefined}
                          value={alloc.qty}
                          onChange={(e) => onUpdateSourceAllocationQty && onUpdateSourceAllocationQty(idx, parseInt(e.target.value) || 0)}
                          className="w-20 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-indigo-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => onUpdateSourceAllocationQty && onUpdateSourceAllocationQty(idx, Math.min(alloc.max_qty || (alloc.qty + 100), alloc.qty + 100))}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer text-xs active:scale-95"
                        >
                          +
                        </button>
                        <span className="text-xs text-slate-400 font-medium ml-1">ชิ้น</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Scan Next Slot when still needing more items */}
            {remainingNeeded > 0 && (
              <div className="space-y-1.5 pt-1">
                <label className="block text-xs font-bold text-slate-700">
                  {sourceAllocations.length === 0
                    ? "สแกนตำแหน่งต้นทาง:"
                    : `➕ สแกนตำแหน่งที่ ${sourceAllocations.length + 1} (ขาดอีก ${remainingNeeded.toLocaleString()} ชิ้น):`}
                </label>
                <BarcodeScanInput
                  value={staffScanSourceLocationInput}
                  onChange={setStaffScanSourceLocationInput}
                  onScanSubmit={onVerifySourceLocationBarcode}
                  inputRef={staffSourceLocationInputRef}
                  placeholder={sourceAllocations.length === 0 ? "สแกนตำแหน่งต้นทาง..." : `สแกนตำแหน่งที่ ${sourceAllocations.length + 1}...`}
                />
              </div>
            )}

            {/* Proceed Button when ready */}
            {isCompleteAlloc && (
              <button
                type="button"
                onClick={onProceedToDestStep}
                className="w-full py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 cursor-pointer transition-all active:scale-98"
              >
                <span>ถัดไป: สแกนตำแหน่งปลายทาง ➔</span>
              </button>
            )}
          </div>
        )}

        {/* Step 3: Scan Destination Location Barcode */}
        {staffStep === 3 && (
          <div className="space-y-3 pt-1">
            <label className="block text-xs font-bold text-slate-700">
              สแกนตำแหน่งปลายทางใน {selectedTask.to_warehouse_name}:
            </label>
            <BarcodeScanInput
              value={staffScanDestLocationInput}
              onChange={setStaffScanDestLocationInput}
              onScanSubmit={onVerifyDestinationLocationBarcode}
              inputRef={staffDestLocationInputRef}
              placeholder="สแกนตำแหน่งปลายทาง..."
            />
          </div>
        )}

        {/* Step 4: Completion */}
        {staffStep === 4 && (
          <div className="p-6 text-center space-y-3 bg-emerald-50 border border-emerald-200/80 rounded-2xl animate-in zoom-in-95">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-xl">
              ✓
            </div>
            <h4 className="text-base font-extrabold text-slate-900">ย้ายสินค้าสำเร็จ!</h4>
            <p className="text-xs text-slate-600">
              ตัดยอดต้นทางและเพิ่มเข้าปลายทางเรียบร้อยแล้ว
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer shadow-md shadow-emerald-600/20 active:scale-95 transition-all"
            >
              เสร็จสิ้น
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
