"use client";

import { useState, useRef, useEffect } from "react";

export interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "เลือก...",
  error,
  disabled = false,
  className = "",
}: CustomSelectProps) {
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

  return (
    <div ref={containerRef} className={`relative w-full min-w-0 max-w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`w-full h-10 px-3 rounded-xl text-left text-xs sm:text-sm font-medium flex items-center justify-between transition-all duration-150 border ${
          disabled
            ? "bg-white/[0.03] opacity-50 cursor-not-allowed border-white/[0.06] text-slate-500"
            : open
            ? "bg-white/[0.06] border-indigo-500/50 text-slate-100 ring-2 ring-indigo-500/20"
            : "bg-white/[0.04] border-white/[0.09] text-slate-100 hover:border-white/[0.15]"
        }`}
      >
        <span className="truncate pr-2">
          {selectedOption ? selectedOption.label : <span className="text-slate-500">{placeholder}</span>}
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? "rotate-180 text-indigo-400" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Custom Dropdown List */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 w-full max-w-full bg-[#111118] border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden py-1 max-h-56 overflow-y-auto scale-in duration-100">
          <div
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`px-3.5 py-2 text-sm cursor-pointer transition-colors ${
              !value ? "bg-indigo-500/15 text-indigo-300 font-semibold" : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
            }`}
          >
            {placeholder}
          </div>
          {options.map((opt) => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`px-3.5 py-2 text-sm cursor-pointer transition-colors truncate ${
                opt.value === value
                  ? "bg-indigo-500/15 text-indigo-300 font-semibold border-l-2 border-indigo-500"
                  : "text-slate-300 hover:bg-white/[0.06] hover:text-slate-100"
              }`}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-400 font-medium">{error}</p>}
    </div>
  );
}
