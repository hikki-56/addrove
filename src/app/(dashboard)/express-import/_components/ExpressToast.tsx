"use client";

import { useEffect } from "react";

export type ExpressToastTone = "success" | "error" | "syncing";

export interface ExpressToastState {
  message: string;
  tone?: ExpressToastTone;
  id?: string | number;
}

interface ExpressToastProps {
  toast: ExpressToastState | null;
  onClose: () => void;
  duration?: number;
}

export default function ExpressToast({
  toast,
  onClose,
  duration = 3500,
}: ExpressToastProps) {
  useEffect(() => {
    if (!toast || toast.tone === "syncing") return;

    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [toast, duration, onClose]);

  if (!toast) return null;

  const tone = toast.tone || "success";

  const toneStyles: Record<
    ExpressToastTone,
    {
      container: string;
      iconBg: string;
      iconColor: string;
      textColor: string;
    }
  > = {
    success: {
      container: "bg-white border-[#8FB3A3] text-[#052B1F] shadow-[0_10px_30px_rgba(6,64,43,0.12)]",
      iconBg: "bg-[#EAF2EE] border border-[#C9DFD4]",
      iconColor: "text-[#06402B]",
      textColor: "text-[#052B1F]",
    },
    error: {
      container: "bg-white border-[#F3C4BA] text-[#9B1C1C] shadow-[0_10px_30px_rgba(155,28,28,0.12)]",
      iconBg: "bg-[#FDF3F1] border border-[#FAD7D0]",
      iconColor: "text-[#9B1C1C]",
      textColor: "text-[#9B1C1C]",
    },
    syncing: {
      container: "bg-white border-[#D0DDD6] text-slate-800 shadow-[0_10px_30px_rgba(16,24,40,0.1)]",
      iconBg: "bg-slate-100 border border-slate-200",
      iconColor: "text-[#06402B]",
      textColor: "text-slate-800",
    },
  };

  const currentStyle = toneStyles[tone];

  return (
    <aside
      aria-label="การแจ้งเตือนระบบ Express"
      className="fixed top-5 right-5 z-50 max-w-md w-[calc(100vw-2.5rem)] pointer-events-none"
    >
      <div
        role={tone === "error" ? "alert" : "status"}
        aria-live="polite"
        className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border ${currentStyle.container} backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200 transition-all`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${currentStyle.iconBg} ${currentStyle.iconColor}`}
            aria-hidden="true"
          >
            {tone === "syncing" ? (
              <svg
                className="w-4 h-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <circle cx="12" cy="12" r="9" strokeOpacity={0.25} />
                <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
              </svg>
            ) : tone === "error" ? (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4.5 12.5l5 5L19.5 7" />
              </svg>
            )}
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-bold leading-snug ${currentStyle.textColor}`}>
              {toast.message}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดการแจ้งเตือน"
          className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-black/[0.05] grid place-items-center shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06402B]"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
