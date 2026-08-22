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
      className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border transition-all duration-300 flex items-start gap-2.5 sm:gap-3 shadow-lg ${
        isSuccess
          ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
          : "bg-rose-950/40 border-rose-500/30 text-rose-300"
      } ${className}`}
    >
      <div
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 ${
          isSuccess ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
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
        {feedback.title && <div className="font-semibold text-sm mb-0.5">{feedback.title}</div>}
        <div className="text-xs sm:text-sm text-slate-300 leading-relaxed break-words">{feedback.message}</div>
        {feedback.scannedCode && (
          <div className="mt-1 inline-block px-2 py-0.5 rounded bg-black/40 text-xs font-mono text-slate-400 border border-white/5">
            Code: {feedback.scannedCode}
          </div>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
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
