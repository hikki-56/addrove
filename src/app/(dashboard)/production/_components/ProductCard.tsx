"use client";

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
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:shadow-lg hover:border-emerald-300 transition-all duration-200 flex flex-col justify-between p-4 sm:p-5 space-y-3 group relative overflow-hidden">
      {/* Product Image */}
      <div className="w-full h-40 sm:h-44 bg-gradient-to-b from-slate-50 to-slate-100/70 rounded-xl overflow-hidden flex items-center justify-center p-3 border border-slate-100 relative">
        <img
          src={bom.image || "/products/A002.jpg"}
          alt={bom.fg_name}
          className="max-h-full max-w-full object-contain drop-shadow-md"
          onError={(e) => {
            (e.target as HTMLElement).style.display = "none";
          }}
        />
        {typeof bom.fg_wh2_stock === "number" && (
          <span className="absolute bottom-2 left-2 px-2.5 py-1 rounded-lg bg-slate-900/85 backdrop-blur-xs text-sm font-bold text-white shadow-xs font-mono">
            ในคลัง: {bom.fg_wh2_stock.toLocaleString()} {bom.fg_unit}
          </span>
        )}
      </div>

      {/* SKU, Barcode, and Name */}
      <div className="space-y-1 text-center">
        <div className="font-mono font-bold text-base text-slate-900">
          {bom.fg_sku}
        </div>
        {bom.fg_barcode && (
          <div className="text-sm font-mono font-medium text-slate-500">
            {bom.fg_barcode}
          </div>
        )}
        <h3 className="text-base font-bold text-slate-900 line-clamp-2 leading-snug pt-0.5">
          {bom.fg_name}
        </h3>
      </div>

      {/* Producible Count & Stepper */}
      <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/90 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-slate-700">ผลิตได้สูงสุด:</span>
          {maxProducible > 0 ? (
            <span className="text-emerald-800 bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-lg text-sm font-bold font-mono">
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
            className="w-11 h-11 rounded-xl bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-xl transition-all shadow-2xs cursor-pointer select-none"
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
              onFocus={(e) => e.target.select()}
              onClick={(e) => (e.target as HTMLInputElement).select()}
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
              className="w-full text-center h-11 px-2 bg-white border border-slate-300 rounded-xl font-mono text-base font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 shadow-inner disabled:bg-slate-100 disabled:text-slate-400 cursor-text select-all"
            />
          </div>

          <button
            type="button"
            disabled={maxProducible <= 0}
            onClick={() => onQuantityChange(bom.fg_sku, currentQty + 1, maxProducible)}
            className="w-11 h-11 rounded-xl bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-xl transition-all shadow-2xs cursor-pointer select-none"
            aria-label="เพิ่มจำนวน"
          >
            +
          </button>

          {/* MAX Button */}
          <button
            type="button"
            disabled={maxProducible <= 0 || currentQty === maxProducible}
            onClick={() => onQuantityChange(bom.fg_sku, maxProducible, maxProducible)}
            className="h-11 px-2.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-xs transition-all cursor-pointer select-none"
            aria-label="ใส่จำนวนสูงสุด"
            title="ใส่จำนวนสูงสุดที่ผลิตได้"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Add to Cart Button — height ≥ 48px */}
      <button
        type="button"
        disabled={maxProducible <= 0}
        onClick={onAddToCart}
        className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer active:scale-[0.98] ${
          maxProducible > 0
            ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20"
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
