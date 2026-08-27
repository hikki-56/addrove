"use client";

import React from "react";

export interface ScanFeedback {
  type: "success" | "error";
  title?: string;
  message: string;
  scannedCode?: string;
}

export interface ScanFeedbackBannerProps {
  feedback: ScanFeedback | null;
  onDismiss?: () => void;
  className?: string;
}

export default function ScanFeedbackBanner({
  feedback,
  onDismiss,
  className = "",
}: ScanFeedbackBannerProps) {
  if (!feedback) return null;

  const isSuccess = feedback.type === "success";

  return (
    <div
      className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border transition-all duration-300 flex items-start gap-2.5 sm:gap-3 shadow-xs ${
        isSuccess
          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : "bg-rose-50 border-rose-200 text-rose-800"
      } ${className}`}
    >
      <div
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 ${
          isSuccess ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
        }`}
      >
        {isSuccess ? (
          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        {feedback.title && <div className="font-bold text-sm mb-0.5">{feedback.title}</div>}
        <div className="text-xs sm:text-sm text-slate-700 leading-relaxed break-words">{feedback.message}</div>
        {feedback.scannedCode && (
          <div className="mt-1 inline-block px-2 py-0.5 rounded-md bg-white text-xs font-mono font-bold text-slate-700 border border-slate-200 shadow-2xs">
            Code: {feedback.scannedCode}
          </div>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200/50 transition-colors cursor-pointer"
          title="ปิด"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
