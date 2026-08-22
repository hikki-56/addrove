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
  activeColor?: "purple" | "rose";
}

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

  // Calculate height for exactly 4 items (each item ~38px)
  const itemHeight = 38;
  const maxHeight = maxVisibleItems * itemHeight + 8;

  const isRose = activeColor === "rose";

  return (
    <div ref={containerRef} className={`relative w-full min-w-0 ${className}`} title={title}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full px-3.5 py-2.5 min-h-[42px] bg-slate-50 border rounded-xl text-sm font-bold text-slate-800 flex items-center justify-between transition-all cursor-pointer shadow-2xs ${
          open
            ? isRose
              ? "border-rose-600 bg-white ring-2 ring-rose-100"
              : "border-purple-600 bg-white ring-2 ring-purple-100"
            : isRose
            ? "border-slate-300 hover:border-rose-400 hover:bg-white"
            : "border-slate-300 hover:border-purple-400 hover:bg-white"
        }`}
      >
        <span className="truncate pr-1 text-left">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? (isRose ? "rotate-180 text-rose-600" : "rotate-180 text-purple-600") : ""
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
          className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-xl shadow-xl overflow-y-auto py-1 divide-y divide-slate-50 min-w-[120px]"
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
                className={`w-full px-3.5 py-2.5 text-sm font-bold text-left flex items-center justify-between transition-colors cursor-pointer ${
                  isSelected
                    ? isRose
                      ? "bg-rose-50 text-rose-700"
                      : "bg-purple-50 text-purple-700"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && (
                  <span className={`font-bold ml-1 text-sm ${isRose ? "text-rose-600" : "text-purple-600"}`}>
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
