"use client";

import React, { useRef, useEffect } from "react";
import { SolarClose, SolarTagBarcode } from "@/components/icons";
import { prepareFeedbackAudio } from "@/client/feedback";

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
  /** id ของ input — ใส่เมื่อมี <label htmlFor> กำกับช่องสแกนจากภายนอก */
  id?: string;
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
  id,
}: BarcodeScanInputProps) {
  const internalRef = useRef<HTMLInputElement>(null);
  const refToUse = inputRef || internalRef;

  useEffect(() => {
    if (!isProcessing && autoFocus && refToUse.current) {
      refToUse.current.focus();
    }
  }, [isProcessing, autoFocus, refToUse]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Read from DOM directly — hardware barcode scanners type faster than React async state re-render
      const raw = (e.currentTarget.value ?? value).trim();
      if (raw) {
        onScanSubmit(raw);
      }
    }
  };

  // มือถือ: ปุ่ม Enter/Go บนคีย์บอร์ดเสมือนบางเครื่อง (Android IME = keyCode 229) ไม่ส่ง keydown "Enter"
  // แต่จะ submit ฟอร์มแทน — รับทางนี้ด้วย (เดสก์ท็อป/สแกนเนอร์ยังผ่าน keydown + preventDefault เหมือนเดิม จึงไม่ยิงซ้ำ)
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled || isProcessing) return;
    const raw = (refToUse.current?.value ?? value).trim();
    if (raw) onScanSubmit(raw);
  };

  return (
    <div className={`relative flex items-center gap-2 ${className}`}>
      <form noValidate onSubmit={handleSubmit} className="relative flex-1 overflow-hidden rounded-xl border border-[rgba(145,158,171,0.32)] bg-white shadow-m3-card transition-colors focus-within:border-m3-grey-800 focus-within:ring-1 focus-within:ring-m3-grey-800">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-m3-grey-600">
          <SolarTagBarcode size={24} />
        </div>

        <input
          ref={refToUse as React.RefObject<HTMLInputElement>}
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          enterKeyHint="go"
          autoComplete="off"
          placeholder={placeholder}
          readOnly={disabled || isProcessing}
          aria-busy={isProcessing}
          className={`h-14 w-full bg-transparent pr-12 pl-13 text-sm font-semibold text-m3-grey-800 placeholder:font-normal placeholder:text-m3-grey-500 outline-none sm:h-16 sm:pr-28 sm:text-base read-only:cursor-default disabled:opacity-50 disabled:cursor-not-allowed ${
            isProcessing ? "opacity-50" : ""
          }`}
        />

        <div className="absolute inset-y-0 right-2 flex items-center gap-1.5 pr-1">
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                if (refToUse.current) refToUse.current.focus();
              }}
              aria-label="ล้างข้อมูล"
              className="cursor-pointer rounded-lg p-1.5 text-m3-grey-500 transition-colors hover:bg-[rgba(145,158,171,0.08)] hover:text-m3-grey-700"
              title="ล้างข้อมูล"
            >
              <SolarClose size={18} />
            </button>
          )}
          <kbd aria-hidden className="hidden h-7 items-center rounded-md bg-m3-grey-200 px-2 font-sans text-xs font-semibold text-m3-grey-600 sm:inline-flex">
            Enter
          </kbd>

          {onOpenScannerModal && (
            <button
              type="button"
              onClick={() => {
                prepareFeedbackAudio();
                onOpenScannerModal();
              }}
              disabled={disabled || isProcessing}
              aria-label="เปิดกล้องสแกน"
              className="flex size-10 cursor-pointer items-center justify-center rounded-lg bg-m3-grey-800 text-white transition-transform hover:bg-m3-grey-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-48"
              title="เปิดกล้องสแกน"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
