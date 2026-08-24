"use client";

import React, { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { to8DigitBarcode } from "@/lib/barcode-utils";

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
  width = 1.4,
  height = 42,
  showText = true,
  className = "",
  fontSize = 12,
  textPosition = "bottom",
}: BarcodeSvgProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const cleanValue = (to8DigitBarcode(value) || value || "").trim();

  useEffect(() => {
    if (!canvasRef.current || !cleanValue) return;
    try {
      JsBarcode(canvasRef.current, cleanValue, {
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
    } catch (err) {
      console.error("Barcode rendering error:", err);
    }
  }, [cleanValue, width, height, showText, fontSize, textPosition]);

  useEffect(() => {
    if (!isZoomed || !zoomCanvasRef.current || !cleanValue) return;
    try {
      JsBarcode(zoomCanvasRef.current, cleanValue, {
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
    } catch (err) {
      console.error("Zoom barcode rendering error:", err);
    }
  }, [isZoomed, cleanValue]);

  const hasCustomSize = className.includes("w-") || className.includes("h-") || className.includes("border-0");
  const sizeClasses = hasCustomSize ? "" : "w-[200px] min-w-[200px] max-w-[200px] h-[72px]";

  if (!cleanValue) {
    return (
      <div className={`flex flex-col items-center justify-center p-2 rounded-xl border border-dashed border-slate-300 text-slate-400 text-xs font-mono select-none bg-slate-50 ${sizeClasses} ${className}`}>
        <span>(ไม่มีข้อมูลบาร์โค้ด)</span>
      </div>
    );
  }

  return (
    <>
      <div
        onClick={() => setIsZoomed(true)}
        title="🔍 คลิกเพื่อขยายบาร์โค้ดขนาดใหญ่เต็มจอ สำหรับยิงสแกนง่ายขึ้น"
        className={`group relative flex flex-col items-center justify-center bg-white px-2 py-1 rounded-xl border border-slate-200 shadow-2xs hover:border-indigo-400 hover:shadow-md transition-all cursor-zoom-in select-none overflow-hidden ${sizeClasses} ${className}`}
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
        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800/80 text-white text-[9px] font-sans px-1.5 py-0.5 rounded flex items-center gap-0.5 pointer-events-none">
          <span>🔍</span> ขยาย
        </div>
      </div>

      {/* Giant Fullscreen Barcode Modal */}
      {isZoomed && (
        <div
          onClick={() => setIsZoomed(false)}
          className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl p-8 max-w-xl w-full shadow-2xl border border-slate-200 flex flex-col items-center gap-6 relative cursor-default"
          >
            <button
              type="button"
              onClick={() => setIsZoomed(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-2 rounded-full text-xl transition-all cursor-pointer"
            >
              ✕
            </button>

            <div className="text-center space-y-1">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold text-xs border border-emerald-200">
                🎯 ขนาดใหญ่พิเศษสำหรับเครื่องยิงบาร์โค้ด
              </span>
              <h3 className="text-lg font-black text-slate-800">
                บาร์โค้ด: <span className="font-mono text-indigo-700">{cleanValue}</span>
              </h3>
              <p className="text-xs text-slate-500">
                สามารถใช้เครื่องยิงบาร์โค้ดยิงที่กรอบสีขาวด้านล่างได้ทันที (ระยะยิง 10 - 50 ซม.)
              </p>
            </div>

            {/* Giant White Box Canvas */}
            <div className="bg-white p-6 rounded-2xl border-2 border-slate-300 shadow-inner flex flex-col items-center justify-center w-full overflow-x-auto">
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
                className="flex-1 py-3 px-4 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-sm border border-indigo-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>📋 คัดลอกเลขบาร์โค้ด</span>
              </button>
              <button
                type="button"
                onClick={() => setIsZoomed(false)}
                className="py-3 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm transition-all cursor-pointer"
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
