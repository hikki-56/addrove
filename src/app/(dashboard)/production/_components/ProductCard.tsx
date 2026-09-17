"use client";

import { useState } from "react";
import type { EnrichedBomFormula } from "./types";

interface ProductCardProps {
  bom: EnrichedBomFormula;
  currentQty: number;
  maxProducible: number;
  onQuantityChange: (sku: string, val: number, max: number) => void;
  onAddToCart: () => void;
}

export default function ProductCard({
  bom,
  currentQty,
  maxProducible,
  onQuantityChange,
  onAddToCart,
}: ProductCardProps) {
  const [showBomDetails, setShowBomDetails] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-[#E8ECEA] shadow-xs hover:shadow-lg hover:border-[#8FB3A3] transition-all duration-200 flex flex-col justify-between p-4 sm:p-5 space-y-3 group relative overflow-hidden">
      {/* Product Image */}
      <div className="w-full h-40 sm:h-44 bg-[#EFF3F1] rounded-xl overflow-hidden flex items-center justify-center p-3 border border-[#EEF1EF] relative">
        <img
          src={bom.image || "/products/A002.jpg"}
          alt={bom.fg_name}
          className="max-h-full max-w-full object-contain drop-shadow-md"
          onError={(e) => {
            (e.target as HTMLElement).style.display = "none";
          }}
        />
        {typeof bom.fg_wh2_stock === "number" && (
          <span
            title={`ในคลัง: ${bom.fg_wh2_stock.toLocaleString()} ${bom.fg_unit}`}
            className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate px-2.5 py-1 rounded-lg bg-slate-900/85 backdrop-blur-xs text-sm font-bold text-white shadow-xs font-mono"
          >
            ในคลัง: {bom.fg_wh2_stock.toLocaleString()} {bom.fg_unit}
          </span>
        )}
      </div>

      {/* SKU, Barcode, and Name */}
      <div className="min-w-0 space-y-1 text-center">
        <div className="font-mono font-bold text-base text-slate-900 break-all" title={bom.fg_sku}>
          {bom.fg_sku}
        </div>
        {bom.fg_barcode && (
          <div className="text-sm font-mono font-medium text-slate-500 break-all" title={bom.fg_barcode}>
            {bom.fg_barcode}
          </div>
        )}
        <h3 className="text-base font-bold text-slate-900 line-clamp-2 leading-snug pt-0.5">
          {bom.fg_name}
        </h3>
      </div>

      {/* Producible Count & Stepper */}
      <div className="bg-slate-50 rounded-xl p-3.5 border border-[#E8ECEA]/90 space-y-3">
        <div className="flex items-center justify-between gap-1 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-slate-700">ผลิตได้สูงสุด:</span>
            {bom.has_primary_designated && (
              <span
                className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-[#EAF2EE] text-[#052B1F] border border-[#8FB3A3]"
                title="คำนวณจากชิ้นส่วนตัวหลัก"
              >
                อิงตัวหลัก
              </span>
            )}
          </div>
          {maxProducible > 0 ? (
            <span className="text-[#052B1F] bg-[#DFEDE6] border border-[#8FB3A3] px-2.5 py-0.5 rounded-lg text-sm font-bold font-mono">
              {maxProducible.toLocaleString()} {bom.fg_unit}
            </span>
          ) : (
            <span className="text-rose-800 bg-rose-100 border border-rose-300 px-2.5 py-0.5 rounded-lg text-sm font-bold">
              วัตถุดิบไม่พอ
            </span>
          )}
        </div>

        {/* Quantity Stepper — touch targets ≥ 44px */}
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={maxProducible <= 0}
            onClick={() => onQuantityChange(bom.fg_sku, currentQty - 1, maxProducible)}
            className="w-11 h-11 rounded-xl bg-white border border-[#D5DDD9] text-slate-800 hover:bg-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-xl transition-all shadow-2xs cursor-pointer select-none"
            aria-label="ลดจำนวน"
          >
            −
          </button>

          <div className="relative flex-1">
            <input
              type="number"
              min={1}
              max={maxProducible > 0 ? maxProducible : 1}
              disabled={maxProducible <= 0}
              value={maxProducible > 0 ? (currentQty === 0 ? "" : currentQty) : 0}
              onContextMenu={(e) => e.preventDefault()}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return;
                const val = parseInt(raw);
                if (!isNaN(val)) {
                  onQuantityChange(bom.fg_sku, val, maxProducible);
                }
              }}
              onBlur={() => {
                if (currentQty < 1) {
                  onQuantityChange(bom.fg_sku, 1, maxProducible);
                }
              }}
              className="w-full text-center h-11 px-2 bg-white border border-[#D5DDD9] rounded-xl font-mono text-base font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#0F5C3F] shadow-inner disabled:bg-slate-100 disabled:text-slate-400 cursor-text select-all"
            />
          </div>

          <button
            type="button"
            disabled={maxProducible <= 0}
            onClick={() => onQuantityChange(bom.fg_sku, currentQty + 1, maxProducible)}
            className="w-11 h-11 rounded-xl bg-white border border-[#D5DDD9] text-slate-800 hover:bg-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-xl transition-all shadow-2xs cursor-pointer select-none"
            aria-label="เพิ่มจำนวน"
          >
            +
          </button>

          {/* MAX Button */}
          <button
            type="button"
            disabled={maxProducible <= 0 || currentQty === maxProducible}
            onClick={() => onQuantityChange(bom.fg_sku, maxProducible, maxProducible)}
            className="h-11 px-2.5 rounded-xl bg-[#EAF2EE] border border-[#8FB3A3] text-[#052B1F] hover:bg-[#DFEDE6] active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-xs transition-all cursor-pointer select-none"
            aria-label="ใส่จำนวนสูงสุด"
            title="ใส่จำนวนสูงสุดที่ผลิตได้"
          >
            MAX
          </button>
        </div>

        {/* Collapsible BOM Formula items */}
        {bom.items && bom.items.length > 0 && (
          <div className="pt-1 border-t border-slate-200/70">
            <button
              type="button"
              onClick={() => setShowBomDetails((prev) => !prev)}
              className="w-full text-xs text-slate-500 hover:text-slate-800 flex items-center justify-between py-1 px-1 transition-colors cursor-pointer font-medium"
            >
              <span>สูตรวัตถุดิบ ({bom.items.length} รายการ)</span>
              <span className="flex items-center gap-1 text-[11px] text-[#052B1F] font-semibold">
                {showBomDetails ? "ซ่อน" : "ดูสูตร"}
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${showBomDetails ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>

            {showBomDetails && (
              <div className="mt-1.5 p-2 rounded-xl bg-white border border-slate-200 space-y-1.5 text-xs animate-in fade-in duration-150 shadow-inner">
                <div className="text-[10px] font-bold text-slate-500 pb-1 border-b border-slate-100 flex justify-between">
                  <span>วัตถุดิบ</span>
                  <span>มีในคลัง 2</span>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
                  {bom.items.map((item, idx) => {
                    const isPrimary = Number(item.is_primary) === 1;
                    const available = item.available_wh2_qty || 0;
                    const req = item.rm_qty_required || 1;
                    const hasEnough = available >= req;

                    return (
                      <div
                        key={item.rm_sku || idx}
                        className="flex items-center justify-between gap-1.5 py-0.5 text-[11px]"
                      >
                        <div className="flex items-center gap-1 min-w-0 flex-1">
                          <span
                            className={`px-1 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                              isPrimary
                                ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                                : "bg-slate-100 text-slate-600 border border-slate-200"
                            }`}
                          >
                            {isPrimary ? "หลัก" : "รอง"}
                          </span>
                          <span className="truncate text-slate-800" title={item.rm_name}>
                            {item.rm_name}
                          </span>
                        </div>
                        <span
                          className={`font-mono font-bold shrink-0 ${
                            hasEnough ? "text-slate-700" : isPrimary ? "text-rose-600" : "text-amber-600"
                          }`}
                          title={`ต้องใช้ ${req} ${item.rm_unit} ต่อชุด`}
                        >
                          {available.toLocaleString()} {item.rm_unit}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add to Cart Button — height ≥ 48px */}
      <button
        type="button"
        disabled={maxProducible <= 0}
        onClick={onAddToCart}
        className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer active:scale-[0.98] ${
          maxProducible > 0
            ? "bg-[#06402B] hover:bg-[#053425] text-white shadow-[#06402B]/20"
            : "bg-slate-200 text-slate-500 cursor-not-allowed shadow-none"
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
        <span>{maxProducible > 0 ? "เพิ่มในตะกร้า" : "วัตถุดิบในโกดัง 2 ไม่พอ"}</span>
      </button>
    </div>
  );
}
