"use client";

import React, { useRef, useEffect } from "react";

export interface BarcodeScanInputProps {
  value: string;
  onChange: (val: string) => void;
  onScanSubmit: (code: string) => void;
  onOpenScannerModal: () => void;
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
      <div className="relative flex-1">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
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
          className="w-full pl-11 pr-24 py-3.5 bg-slate-900/80 border border-slate-700/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 rounded-2xl text-slate-100 placeholder-slate-500 text-sm md:text-base outline-none transition-all shadow-inner disabled:opacity-50 disabled:cursor-not-allowed"
        />

        <div className="absolute inset-y-0 right-1.5 flex items-center pr-1 gap-1">
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                if (refToUse.current) refToUse.current.focus();
              }}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
              title="ล้างข้อมูล"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenScannerModal}
            disabled={disabled || isProcessing}
            className="px-3 py-2 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-950/40 transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="hidden sm:inline">กล้อง</span>
          </button>
        </div>
      </div>
    </div>
  );
}
