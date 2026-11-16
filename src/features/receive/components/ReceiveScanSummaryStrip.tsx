"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  buildScanStripTotals,
  scanStripSegments,
  type ReceiveScanLine,
} from "@/features/receive/scan-summary";

export default function ReceiveScanSummaryStrip({
  lines,
}: {
  lines: ReceiveScanLine[] | null | undefined;
}) {
  const totals = buildScanStripTotals(lines);
  const empty = totals.lineCount <= 0;
  const [flash, setFlash] = useState(false);
  const prevKey = useRef("");

  useEffect(() => {
    const key = `${totals.lineCount}:${totals.boxCount}:${totals.pieceCount ?? "x"}`;
    if (prevKey.current && prevKey.current !== key) {
      setFlash(true);
      const timer = window.setTimeout(() => setFlash(false), 700);
      prevKey.current = key;
      return () => window.clearTimeout(timer);
    }
    prevKey.current = key;
  }, [totals.lineCount, totals.boxCount, totals.pieceCount]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex h-9 items-center justify-center px-3 text-[13px] font-semibold tracking-tight transition-colors duration-300 ${
        empty
          ? "bg-m3-grey-200 text-m3-grey-600"
          : flash
            ? "bg-[rgba(0,167,111,0.16)] text-m3-primary-dark"
            : "bg-[rgba(0,167,111,0.08)] text-m3-primary-dark"
      }`}
    >
      <p className="m-0 whitespace-nowrap">
        {scanStripSegments(totals).map((part, index) =>
          part.isNumber ? (
            <span key={index} className="font-m3-disp text-[14px] font-bold tabular-nums">
              {part.text}
            </span>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
    </div>
  );
}
