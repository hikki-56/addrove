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
        className={`w-full h-10 px-3.5 rounded-xl text-left text-xs sm:text-sm font-medium flex items-center justify-between transition-all duration-150 border cursor-pointer ${
          disabled
            ? "bg-slate-100 opacity-50 cursor-not-allowed border-slate-200 text-slate-400"
            : open
            ? "bg-white border-indigo-500 text-slate-900 ring-2 ring-indigo-500/20 shadow-xs"
            : "bg-slate-50 border-slate-200 text-slate-900 hover:bg-slate-100/80 hover:border-slate-300"
        }`}
      >
        <span className="truncate pr-2">
          {selectedOption ? selectedOption.label : <span className="text-slate-400">{placeholder}</span>}
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? "rotate-180 text-indigo-600" : ""
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
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 w-full max-w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden py-1 max-h-56 overflow-y-auto scale-in duration-100">
          <div
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`px-3.5 py-2 text-xs sm:text-sm cursor-pointer transition-colors ${
              !value ? "bg-indigo-50 text-indigo-700 font-bold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
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
              className={`px-3.5 py-2 text-xs sm:text-sm cursor-pointer transition-colors truncate ${
                opt.value === value
                  ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600"
                  : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-rose-600 font-medium">{error}</p>}
    </div>
  );
}
