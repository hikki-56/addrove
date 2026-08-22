"use client";

import React, { useRef, useEffect } from "react";

export interface BarcodeScanInputProps {
  value: string;
  onChange: (val: string) => void;
  onScanSubmit: (code: string) => void;
  onOpenScannerModal?: () => void;
  placeholder?: string;
  disabled?: boolean;
  isProcessing?: boolean;
  autoFocus?: boolean;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function BarcodeScanInput({
  value,
  onChange,
  onScanSubmit,
  onOpenScannerModal,
  placeholder = "สแกนบาร์โค้ด หรือ พิมพ์รหัสสินค้า/ตำแหน่ง...",
  disabled = false,
  isProcessing = false,
  autoFocus = true,
  className = "",
  inputRef,
}: BarcodeScanInputProps) {
  const internalRef = useRef<HTMLInputElement>(null);
  const refToUse = inputRef || internalRef;

  useEffect(() => {
    if (autoFocus && refToUse.current) {
      refToUse.current.focus();
    }
  }, [autoFocus, refToUse]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
        onScanSubmit(trimmed);
      }
    }
  };

  return (
    <div className={`relative flex items-center gap-2 ${className}`}>
      <div className="relative flex-1 bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 shadow-sm transition-all focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 overflow-hidden">
        <div className="absolute inset-y-0 left-0 pl-3.5 sm:pl-4.5 flex items-center pointer-events-none text-emerald-600">
          {/* Green QR/Barcode Viewfinder Icon */}
          <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7V5a2 2 0 012-2h2m12 0h2a2 2 0 012 2v2m0 10v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 8v8m3-8v8m4-8v8m3-8v8" />
          </svg>
        </div>

        <input
          ref={refToUse as React.RefObject<HTMLInputElement>}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isProcessing}
          className="w-full pl-10 sm:pl-13 pr-10 sm:pr-12 py-3 sm:py-4 bg-transparent text-slate-900 font-bold placeholder-slate-400 text-xs sm:text-base outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />

        <div className="absolute inset-y-0 right-1.5 sm:right-2 flex items-center pr-1 gap-1">
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                if (refToUse.current) refToUse.current.focus();
              }}
              className="p-1 sm:p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              title="ล้างข้อมูล"
            >
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          {onOpenScannerModal && (
            <button
              type="button"
              onClick={onOpenScannerModal}
              disabled={disabled || isProcessing}
              className="p-1.5 sm:p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="เปิดกล้องสแกน"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
