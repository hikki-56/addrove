"use client";

import React from "react";
import { to8DigitBarcode, encodeCode128Modules } from "@/lib/barcode-utils";

interface BarcodeSvgProps {
  value: string;
  width?: number;
  height?: number;
  showText?: boolean;
  className?: string;
  fontSize?: number;
  textPosition?: "top" | "bottom";
}

export default function BarcodeSvg({
  value,
  width = 2,
  height = 55,
  showText = true,
  className = "",
  fontSize = 13,
  textPosition = "bottom",
}: BarcodeSvgProps) {
  const cleanValue = (to8DigitBarcode(value) || value || "").trim();
  if (!cleanValue) {
    return (
      <div className={`inline-flex flex-col items-center justify-center p-3 rounded-lg border border-dashed border-slate-300 text-slate-400 text-xs font-mono select-none ${className}`}>
        <span>(ไม่มีข้อมูลบาร์โค้ด)</span>
      </div>
    );
  }

  const modules = encodeCode128Modules(cleanValue);

  // Calculate total barcode width
  let totalUnits = 0;
  modules.forEach((m) => {
    totalUnits += m.width;
  });

  // Include quiet zone (10 units on left & right)
  const quietZone = 10;
  const fullUnits = totalUnits + quietZone * 2;
  const svgWidth = fullUnits * width;
  const textHeight = showText ? Math.max(22, fontSize + 8) : 0;
  const svgHeight = height + textHeight;

  const barStartY = showText && textPosition === "top" ? textHeight : 0;

  let currentX = quietZone * width;
  const rects: React.JSX.Element[] = [];

  modules.forEach((m, idx) => {
    const barW = m.width * width;
    if (m.isBar) {
      rects.push(
        <rect
          key={idx}
          x={currentX}
          y={barStartY}
          width={barW}
          height={height}
          fill="#000000"
        />
      );
    }
    currentX += barW;
  });

  const textY = textPosition === "top" ? fontSize + 2 : height + fontSize + 2;

  return (
    <div className={`inline-flex flex-col items-center bg-white p-2.5 rounded-lg border border-slate-300 shadow-xs select-none ${className}`}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width={svgWidth}
        height={svgHeight}
        style={{ maxWidth: "100%", height: "auto" }}
        xmlns="http://www.w3.org/2000/svg"
        shapeRendering="crispEdges"
      >
        {/* Background White for 100% barcode scanner contrast */}
        <rect width={svgWidth} height={svgHeight} fill="#FFFFFF" />
        <g fill="#000000">
          {rects}
          {showText && (
            <text
              x={svgWidth / 2}
              y={textY}
              textAnchor="middle"
              fontSize={fontSize}
              fontWeight="bold"
              fontFamily="monospace, Courier, sans-serif"
              fill="#000000"
              letterSpacing="1"
            >
              {cleanValue}
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}

