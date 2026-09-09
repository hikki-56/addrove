"use client";

import { useState, useRef, useEffect } from "react";

export interface ScrollSelectOption {
  value: string;
  label: string;
}

interface ScrollSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: ScrollSelectOption[];
  placeholder?: string;
  className?: string;
  maxVisibleItems?: number; // default: 4
  title?: string;
  activeColor?: "purple" | "rose" | "emerald";
}

// สี accent ของ trigger/รายการที่เลือก — เก็บไว้เป็นชุดเดียวกันทั้ง component
const ACCENTS = {
  purple: {
    open: "border-purple-600 bg-white ring-2 ring-purple-100",
    closed: "border-[#D5DDD9] hover:border-purple-400 hover:bg-white",
    item: "bg-purple-50 text-purple-700",
    check: "text-purple-600",
  },
  rose: {
    open: "border-rose-600 bg-white ring-2 ring-rose-100",
    closed: "border-[#D5DDD9] hover:border-rose-400 hover:bg-white",
    item: "bg-rose-50 text-rose-700",
    check: "text-rose-600",
  },
  emerald: {
    open: "border-[#06402B] bg-white ring-2 ring-[#DFEDE6]",
    closed: "border-[#D5DDD9] hover:border-[#5B8A74] hover:bg-white",
    item: "bg-[#EAF2EE] text-[#053425]",
    check: "text-[#053425]",
  },
} as const;

export default function ScrollSelect({
  value,
  onChange,
  options,
  placeholder = "เลือก...",
  className = "",
  maxVisibleItems = 4,
  title,
  activeColor = "purple",
}: ScrollSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calculate height for exactly 4 items (each item ~46px)
  const itemHeight = 46;
  const maxHeight = maxVisibleItems * itemHeight + 8;

  const accent = ACCENTS[activeColor];

  return (
    <div ref={containerRef} className={`relative w-full min-w-0 ${className}`} title={title}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full px-4 py-2.5 min-h-[46px] bg-slate-50 border rounded-xl text-base font-bold text-slate-800 flex items-center justify-between transition-all cursor-pointer shadow-2xs ${
          open ? accent.open : accent.closed
        }`}
      >
        <span className="truncate pr-1 text-left">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? `rotate-180 ${accent.check}` : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu (Fixed to 4 visible items, scrollable for more) */}
      {open && (
        <div
          style={{ maxHeight: `${maxHeight}px` }}
          className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-[#E8ECEA] rounded-xl shadow-xl overflow-y-auto py-1 divide-y divide-slate-50 min-w-[120px]"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-4 py-3 text-base font-bold text-left flex items-center justify-between transition-colors cursor-pointer ${
                  isSelected ? accent.item : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && (
                  <span className={`font-bold ml-1 text-base ${accent.check}`}>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
