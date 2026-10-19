"use client";

import React from "react";
import { SolarCheckCircle, SolarClose, SolarDangerCircle } from "@/components/icons";

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
      role={isSuccess ? "status" : "alert"}
      className={`flex items-start gap-3 rounded-xl p-4 transition-all duration-300 ${
        isSuccess ? "bg-[rgba(34,197,94,0.12)] text-m3-success-dark" : "bg-[rgba(255,86,48,0.12)] text-m3-error-dark"
      } ${className}`}
    >
      <span className={`mt-px shrink-0 ${isSuccess ? "text-m3-success" : "text-m3-error"}`}>
        {isSuccess ? <SolarCheckCircle size={22} /> : <SolarDangerCircle size={22} />}
      </span>

      <div className="min-w-0 flex-1">
        {feedback.title && <div className="mb-0.5 text-sm font-bold">{feedback.title}</div>}
        <div className="text-sm leading-relaxed break-words text-m3-grey-700">{feedback.message}</div>
        {feedback.scannedCode && (
          <div className="mt-1.5 inline-flex h-6 items-center rounded-md bg-white/72 px-2 text-xs font-semibold tabular-nums text-m3-grey-700">
            Code: {feedback.scannedCode}
          </div>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="ปิด"
          className="-mt-1 -mr-1 cursor-pointer rounded-lg p-1.5 text-current opacity-64 transition-opacity hover:opacity-100"
          title="ปิด"
        >
          <SolarClose size={18} />
        </button>
      )}
    </div>
  );
}
