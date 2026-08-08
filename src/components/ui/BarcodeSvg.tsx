"use client";

import React from "react";
import { to8DigitBarcode } from "@/lib/barcode-utils";

// Standard Code 128 Encoding patterns (0..106)
// Each pattern string represents widths of [bar, space, bar, space, bar, space]
const CODE128_PATTERNS: Record<number, string> = {
  0: "212222", 1: "222122", 2: "222221", 3: "121223", 4: "121322",
  5: "131222", 6: "122213", 7: "122312", 8: "132212", 9: "221213",
  10: "221312", 11: "231212", 12: "112232", 13: "122132", 14: "122231",
  15: "113222", 16: "123122", 17: "123221", 18: "223211", 19: "221132",
  20: "221231", 21: "213212", 22: "223112", 23: "312131", 24: "311222",
  25: "321122", 26: "321221", 27: "312212", 28: "322112", 29: "322211",
  30: "212123", 31: "212321", 32: "232121", 33: "111323", 34: "131123",
  35: "131321", 36: "112313", 37: "132113", 38: "132311", 39: "211313",
  40: "231113", 41: "231311", 42: "112133", 43: "112331", 44: "132131",
  45: "113123", 46: "113321", 47: "133121", 48: "313121", 49: "211331",
  50: "231131", 51: "213113", 52: "213311", 53: "213131", 54: "311123",
  55: "311321", 56: "331121", 57: "312113", 58: "312311", 59: "332111",
  60: "314111", 61: "221411", 62: "431111", 63: "111224", 64: "111422",
  65: "121124", 66: "121421", 67: "141122", 68: "141221", 69: "112214",
  70: "112412", 71: "142112", 72: "142211", 73: "241211", 74: "221114",
  75: "413111", 76: "241112", 77: "134111", 78: "111242", 79: "121142",
  80: "121241", 81: "114212", 82: "124112", 83: "124211", 84: "411212",
  85: "421112", 86: "421211", 87: "212141", 88: "214121", 89: "412121",
  90: "111143", 91: "111341", 92: "131141", 93: "114113", 94: "114311",
  95: "411113", 96: "411311", 97: "113141", 98: "114131", 99: "311141",
  100: "411131", 101: "211412", 102: "211214", 103: "211232",
  104: "211214", // Start B
  105: "211232", // Start C
  106: "2331112", // Stop
};

interface BarcodeSvgProps {
  value: string;
  width?: number;
  height?: number;
  showText?: boolean;
  className?: string;
}

export default function BarcodeSvg({
  value,
  width = 2,
  height = 55,
  showText = true,
  className = "",
}: BarcodeSvgProps) {
  const cleanValue = to8DigitBarcode(value);

  // Build Code 128-B bar sequences
  const codeValues: number[] = [104]; // Start Code B (104)
  let checksum = 104;

  for (let i = 0; i < cleanValue.length; i++) {
    const charCode = cleanValue.charCodeAt(i);
    // Code 128-B maps ASCII 32..126 directly (val = charCode - 32)
    let val = charCode - 32;
    if (val < 0 || val > 95) val = 0; // Fallback space
    codeValues.push(val);
    checksum += val * (i + 1);
  }

  const checksumVal = checksum % 103;
  codeValues.push(checksumVal);
  codeValues.push(106); // Stop symbol

  // Convert codeValues to widths of alternating bar (black) / space (white)
  const modules: { isBar: boolean; width: number }[] = [];

  codeValues.forEach((code) => {
    const pattern = CODE128_PATTERNS[code] || "212222";
    let isBar = true;
    for (let j = 0; j < pattern.length; j++) {
      const w = parseInt(pattern[j], 10) || 1;
      modules.push({ isBar, width: w });
      isBar = !isBar;
    }
  });

  // Calculate total barcode width
  let totalUnits = 0;
  modules.forEach((m) => {
    totalUnits += m.width;
  });

  // Include quiet zone (10 units on left & right)
  const quietZone = 10;
  const fullUnits = totalUnits + quietZone * 2;
  const svgWidth = fullUnits * width;
  const textHeight = showText ? 22 : 0;
  const svgHeight = height + textHeight;

  let currentX = quietZone * width;
  const rects: React.JSX.Element[] = [];

  modules.forEach((m, idx) => {
    const barW = m.width * width;
    if (m.isBar) {
      rects.push(
        <rect
          key={idx}
          x={currentX}
          y={0}
          width={barW}
          height={height}
          fill="#000000"
        />
      );
    }
    currentX += barW;
  });

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
              y={height + 16}
              textAnchor="middle"
              fontSize="13"
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
