"use client";

import { useState, useRef, useEffect, useId } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";

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
  /** จำกัดจำนวนตัวเลือกที่มองเห็นในลิสต์ (ที่เหลือเลื่อนดู) */
  visibleOptions?: number;
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "เลือก...",
  error,
  disabled = false,
  className = "",
  visibleOptions,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  // ตัวเลือกทั้งหมดรวมช่อง "ทั้งหมด" (placeholder) เป็นรายการแรก
  const allOptions: CustomSelectOption[] = [{ value: "", label: placeholder }, ...options];
  const selectedIndex = allOptions.findIndex((o) => o.value === value);

  const selectedOption = options.find((o) => o.value === value);
  const listStyle = visibleOptions ? { maxHeight: visibleOptions * 40 + 4 } : undefined;

  const openList = () => {
    setOpen(true);
    setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
  };

  const selectIndex = (i: number) => {
    onChange(allOptions[i].value);
    setOpen(false);
  };

  const moveHighlight = (delta: number) => {
    setHighlightIndex((h) => Math.min(Math.max(h + delta, 0), allOptions.length - 1));
  };

  // ปิดด้วย Esc (Esc = ยกเลิกเสมอ ตาม design system)
  useEscapeKey(open, () => setOpen(false));

  // เลื่อนตัวเลือกที่ไฮไลต์ให้เห็นในลิสต์
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`#${CSS.escape(`${listId}-opt-${highlightIndex}`)}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open, listId]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openList();
        else moveHighlight(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openList();
        else moveHighlight(-1);
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setHighlightIndex(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setHighlightIndex(allOptions.length - 1);
        }
        break;
      case "Enter":
      case " ":
        if (open) {
          e.preventDefault();
          selectIndex(highlightIndex);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full min-w-0 max-w-full ${className}`}>
      {/* Trigger Button — โฟกัสค้างบนปุ่มแล้วเลื่อนตัวเลือกด้วยลูกศร activedescendant บน trigger คือ pattern มาตรฐานให้ screen reader ประกาศตัวเลือกที่ไฮไลต์ */}
      {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(highlightIndex) : undefined}
        className={`w-full h-10 px-3.5 rounded-xl text-left text-xs sm:text-sm font-medium flex items-center justify-between transition-all duration-150 border cursor-pointer ${
          disabled
            ? "bg-m3-grey-200 opacity-50 cursor-not-allowed border-[rgba(145,158,171,0.2)] text-m3-grey-500"
            : open
            ? "bg-white border-m3-primary text-m3-grey-800 ring-2 ring-m3-primary/20 shadow-xs"
            : "bg-m3-grey-100 border-[rgba(145,158,171,0.2)] text-m3-grey-800 hover:bg-m3-grey-200/80 hover:border-[rgba(145,158,171,0.32)]"
        }`}
      >
        <span className="truncate pr-2">
          {selectedOption ? selectedOption.label : <span className="text-m3-grey-600">{placeholder}</span>}
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 text-m3-grey-500 transition-transform duration-200 ${
            open ? "rotate-180 text-m3-primary-dark" : ""
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
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={placeholder}
          className="absolute left-0 right-0 top-full mt-1.5 z-50 w-full max-w-full bg-white border border-[rgba(145,158,171,0.2)] rounded-xl shadow-m3-dropdown overflow-hidden py-1 max-h-56 overflow-y-auto scale-in duration-100"
          style={listStyle}
        >
          {allOptions.map((opt, i) => {
            const isSelected = opt.value === value;
            const isHighlighted = i === highlightIndex;
            return (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                id={optionId(i)}
                key={opt.value || "opt-all"}
                onClick={() => selectIndex(i)}
                className={`w-full text-left px-3.5 py-2 text-xs sm:text-sm cursor-pointer transition-colors truncate ${
                  isSelected
                    ? "bg-[rgba(0,167,111,0.08)] text-m3-primary-darker font-bold border-l-2 border-m3-primary"
                    : i === 0
                    ? `text-m3-grey-600 ${isHighlighted ? "bg-m3-grey-100 text-m3-grey-800" : "hover:bg-m3-grey-100 hover:text-m3-grey-800"}`
                    : isHighlighted
                    ? "bg-m3-grey-100 text-m3-grey-800"
                    : "text-m3-grey-700 hover:bg-m3-grey-100 hover:text-m3-grey-800"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-m3-error-dark font-medium">{error}</p>}
    </div>
  );
}
