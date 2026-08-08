"use client";

import React from "react";
import type { TransferNotification } from "@/lib/transfer-notification-utils";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";

export interface TransferStaffWorkflowModalProps {
  selectedTask: TransferNotification | null;
  onClose: () => void;
  staffStep: 1 | 2 | 3 | 4;
  setStaffStep: (step: 1 | 2 | 3 | 4) => void;
  staffScanProductInput: string;
  setStaffScanProductInput: (val: string) => void;
  staffScanWhInput: string;
  setStaffScanWhInput: (val: string) => void;
  staffScanLocationInput: string;
  setStaffScanLocationInput: (val: string) => void;
  staffError: string;
  staffSuccess: string;
  staffProductInputRef: React.RefObject<HTMLInputElement | null>;
  staffWhInputRef: React.RefObject<HTMLInputElement | null>;
  staffLocationInputRef: React.RefObject<HTMLInputElement | null>;
  onVerifyProductBarcode: (code: string) => void;
  onVerifyWarehouseBarcode: (code: string) => void;
  onVerifyLocationBarcode: (code: string) => void;
  onOpenStaffCamera: (target: "PRODUCT" | "WAREHOUSE" | "LOCATION") => void;
}

export default function TransferStaffWorkflowModal({
  selectedTask,
  onClose,
  staffStep,
  setStaffStep,
  staffScanProductInput,
  setStaffScanProductInput,
  staffScanWhInput,
  setStaffScanWhInput,
  staffScanLocationInput,
  setStaffScanLocationInput,
  staffError,
  staffSuccess,
  staffProductInputRef,
  staffWhInputRef,
  staffLocationInputRef,
  onVerifyProductBarcode,
  onVerifyWarehouseBarcode,
  onVerifyLocationBarcode,
  onOpenStaffCamera,
}: TransferStaffWorkflowModalProps) {
  if (!selectedTask) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-3xl p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold text-xs">
                {selectedTask.doc_no}
              </span>
              <h3 className="font-bold text-slate-100 text-base">ขั้นตอนการย้ายสินค้า</h3>
            </div>
            <p className="text-xs text-slate-400">
              ผู้รับผิดชอบ: <strong className="text-slate-200">{selectedTask.moved_by || "พนักงาน"}</strong>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between px-2 text-xs">
          <span className={`font-semibold ${staffStep >= 1 ? "text-emerald-400" : "text-slate-500"}`}>
            1. สแกนสินค้า
          </span>
          <span className="text-slate-600">➔</span>
          <span className={`font-semibold ${staffStep >= 2 ? "text-emerald-400" : "text-slate-500"}`}>
            2. สแกนโกดังปลายทาง
          </span>
          <span className="text-slate-600">➔</span>
          <span className={`font-semibold ${staffStep >= 3 ? "text-emerald-400" : "text-slate-500"}`}>
            3. สแกนชั้นวาง
          </span>
        </div>

        {/* Task Summary Card */}
        <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
          <div className="text-sm font-bold text-white">{selectedTask.product_name}</div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <span className="text-slate-400">SKU: <strong className="text-slate-200">{selectedTask.sku}</strong></span>
            <span className="text-amber-400 font-bold">จำนวน: {selectedTask.qty} ชิ้น</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 pt-1 border-t border-slate-800/80">
            <span>{selectedTask.from_warehouse_name}</span>
            <span className="text-slate-600">➔</span>
            <span className="text-emerald-300 font-semibold">{selectedTask.to_warehouse_name}</span>
          </div>
        </div>

        {/* Feedback Banners */}
        {staffError && (
          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium leading-relaxed">
            {staffError}
          </div>
        )}
        {staffSuccess && (
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium leading-relaxed">
            {staffSuccess}
          </div>
        )}

        {/* Step 1: Scan Product Barcode */}
        {staffStep === 1 && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              1. สแกนบาร์โค้ดสินค้าที่ต้องย้าย
            </label>
            <BarcodeScanInput
              value={staffScanProductInput}
              onChange={setStaffScanProductInput}
              onScanSubmit={onVerifyProductBarcode}
              onOpenScannerModal={() => onOpenStaffCamera("PRODUCT")}
              inputRef={staffProductInputRef}
              placeholder="สแกนบาร์โค้ดสินค้า..."
            />
          </div>
        )}

        {/* Step 2: Scan Destination Warehouse Barcode */}
        {staffStep === 2 && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              2. สแกนบาร์โค้ดโกดังปลายทาง ({selectedTask.to_warehouse_name})
            </label>
            <BarcodeScanInput
              value={staffScanWhInput}
              onChange={setStaffScanWhInput}
              onScanSubmit={onVerifyWarehouseBarcode}
              onOpenScannerModal={() => onOpenStaffCamera("WAREHOUSE")}
              inputRef={staffWhInputRef}
              placeholder={`สแกนบาร์โค้ด ${selectedTask.to_warehouse_name}...`}
            />
          </div>
        )}

        {/* Step 3: Scan Destination Shelf / Location Barcode */}
        {staffStep === 3 && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              3. สแกนบาร์โค้ด / QR Code ตำแหน่ง (ชั้นวาง) ใน {selectedTask.to_warehouse_name}
            </label>
            <BarcodeScanInput
              value={staffScanLocationInput}
              onChange={setStaffScanLocationInput}
              onScanSubmit={onVerifyLocationBarcode}
              onOpenScannerModal={() => onOpenStaffCamera("LOCATION")}
              inputRef={staffLocationInputRef}
              placeholder="สแกน QR Code ชั้นวางปลายทาง..."
            />
          </div>
        )}

        {/* Step 4: Completion */}
        {staffStep === 4 && (
          <div className="p-6 text-center space-y-3 bg-emerald-950/30 border border-emerald-500/30 rounded-2xl">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h4 className="text-base font-bold text-white">ย้ายสินค้าสำเร็จเรียบร้อย!</h4>
            <p className="text-xs text-slate-300">
              สินค้าถูกย้ายและบันทึกตำแหน่งใน {selectedTask.to_warehouse_name} สมบูรณ์แล้ว
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs cursor-pointer"
            >
              ปิดหน้าต่าง
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
