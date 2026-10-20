"use client";

import { useState, useRef, useEffect } from "react";

// Custom Scrollable Dropdown
export default function CompactSelect({
  value,
  options,
  onChange,
  title,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
  title?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentOption = options.find((o) => o.value === value);

  return (
    <div className="relative flex-1 min-w-0" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={title}
        className="w-full flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl bg-m3-grey-100 hover:bg-m3-grey-200/80 border border-[rgba(145,158,171,0.2)] text-m3-grey-800 text-sm font-semibold transition-all cursor-pointer shadow-2xs focus:outline-none focus:border-m3-grey-800 focus:bg-white"
      >
        <span className="truncate">{currentOption ? currentOption.label : value}</span>
        <svg
          className={`w-3.5 h-3.5 text-m3-grey-500 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-full min-w-[150px] bg-white border border-[rgba(145,158,171,0.2)] rounded-xl shadow-m3-dropdown z-50 max-h-[160px] overflow-y-auto divide-y divide-[rgba(145,158,171,0.2)] py-1">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? "bg-[rgba(0,167,111,0.08)] text-m3-primary-darker font-bold"
                    : "text-m3-grey-700 hover:bg-m3-grey-100"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <span className="text-m3-primary-dark text-sm font-bold ml-1.5 shrink-0">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
