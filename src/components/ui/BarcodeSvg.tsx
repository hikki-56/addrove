"use client";

import React, { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { useEscapeKey } from "@/hooks/use-escape-key";

interface BarcodeSvgProps {
  value: string;
  width?: number;
  height?: number;
  showText?: boolean;
  className?: string;
  fontSize?: number;
  textPosition?: "top" | "bottom";
  disableZoom?: boolean;
}

function BarcodeSvgComponent({
  value,
  width = 1.4,
  height = 42,
  showText = true,
  className = "",
  fontSize = 12,
  textPosition = "bottom",
  disableZoom = false,
}: BarcodeSvgProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  useEscapeKey(isZoomed, () => setIsZoomed(false));
  const cleanValue = (to8DigitBarcode(value) || value || "").trim();
  // CODE128 requires printable ASCII (32-126)
  const isAscii = /^[\x20-\x7E]+$/.test(cleanValue);
  const asciiValue = isAscii ? cleanValue : cleanValue.replace(/[^\x20-\x7E]/g, "").trim();
  const renderableValue = isAscii ? cleanValue : (asciiValue.length >= 2 ? asciiValue : "");

  useEffect(() => {
    if (!canvasRef.current || !renderableValue) return;
    try {
      JsBarcode(canvasRef.current, renderableValue, {
        format: "CODE128",
        width: Math.max(1.3, width),
        height: Math.max(38, height),
        displayValue: showText,
        textPosition: textPosition,
        font: "monospace",
        fontOptions: "bold",
        fontSize: fontSize,
        textMargin: 2,
        margin: 6,
        background: "#FFFFFF",
        lineColor: "#000000",
      });
    } catch {
      // Gracefully ignore barcode render errors for non-standard inputs
    }
  }, [renderableValue, width, height, showText, fontSize, textPosition]);

  useEffect(() => {
    if (!isZoomed || !zoomCanvasRef.current || !renderableValue) return;
    try {
      JsBarcode(zoomCanvasRef.current, renderableValue, {
        format: "CODE128",
        width: 3.5,
        height: 125,
        displayValue: true,
        textPosition: "bottom",
        font: "monospace",
        fontOptions: "bold",
        fontSize: 22,
        textMargin: 8,
        margin: 20,
        background: "#FFFFFF",
        lineColor: "#000000",
      });
    } catch {
      // Gracefully ignore zoom barcode render errors
    }
  }, [isZoomed, renderableValue]);

  const hasCustomSize = className.includes("w-") || className.includes("h-") || className.includes("border-0");
  const sizeClasses = hasCustomSize ? "" : "w-[200px] min-w-[200px] max-w-[200px] h-[72px]";

  if (!cleanValue) {
    return (
      <div className={`flex flex-col items-center justify-center p-2 rounded-xl border border-dashed border-[rgba(145,158,171,0.32)] text-m3-grey-500 text-xs tabular-nums select-none bg-m3-grey-100 ${sizeClasses} ${className}`}>
        <span>(ไม่มีข้อมูลบาร์โค้ด)</span>
      </div>
    );
  }

  return (
    <>
      <div
        onClick={() => {
          if (!disableZoom) setIsZoomed(true);
        }}
        title={disableZoom ? "" : "ขยายบาร์โค้ด"}
        className={`group relative flex flex-col items-center justify-center bg-white px-2 py-1 rounded-xl border border-[rgba(145,158,171,0.2)] shadow-2xs ${
          disableZoom ? "" : "hover:border-m3-primary-dark hover:shadow-md cursor-zoom-in"
        } transition-all select-none overflow-hidden ${sizeClasses} ${className}`}
      >
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            display: "block",
            margin: "0 auto",
          }}
        />
        {!disableZoom && (
          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-m3-grey-800/80 text-white text-xs font-sans px-1.5 py-0.5 rounded flex items-center gap-0.5 pointer-events-none">
            <span>🔍</span> ขยาย
          </div>
        )}
      </div>

      {/* Giant Fullscreen Barcode Modal */}
      {!disableZoom && isZoomed && (
        <div
          onClick={() => setIsZoomed(false)}
          className="fixed inset-0 z-50 bg-m3-grey-800/70 flex items-center justify-center p-4 cursor-pointer animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-8 max-w-xl w-full shadow-m3-dropdown border border-[rgba(145,158,171,0.2)] flex flex-col items-center gap-6 relative cursor-default"
          >
            <button
              type="button"
              onClick={() => setIsZoomed(false)}
              className="absolute top-4 right-4 text-m3-grey-500 hover:text-m3-grey-700 hover:bg-m3-grey-200 p-2 rounded-full text-xl transition-all cursor-pointer"
            >
              ✕
            </button>

            <div className="text-center space-y-1">
              <h3 className="text-lg font-extrabold text-m3-grey-800">
                บาร์โค้ด: <span className="tabular-nums text-m3-primary-darker">{cleanValue}</span>
              </h3>
            </div>

            {/* Giant White Box Canvas */}
            <div className="bg-white p-6 rounded-xl border border-[rgba(145,158,171,0.32)] shadow-inner flex flex-col items-center justify-center w-full overflow-x-auto">
              <canvas
                ref={zoomCanvasRef}
                style={{
                  maxWidth: "100%",
                  height: "auto",
                  display: "block",
                }}
              />
            </div>

            <div className="flex items-center gap-3 w-full">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(cleanValue);
                }}
                className="flex-1 py-3 px-4 rounded-xl bg-[rgba(0,167,111,0.08)] hover:bg-[rgba(0,167,111,0.16)] text-m3-primary-darker font-bold text-sm border border-[rgba(0,167,111,0.24)] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>📋 คัดลอกเลขบาร์โค้ด</span>
              </button>
              <button
                type="button"
                onClick={() => setIsZoomed(false)}
                className="py-3 px-6 rounded-xl bg-m3-grey-800 hover:bg-m3-grey-800 text-white font-bold text-sm transition-all cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const BarcodeSvg = React.memo(BarcodeSvgComponent);
export default BarcodeSvg;
