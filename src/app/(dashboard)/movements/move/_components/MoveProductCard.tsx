"use client";

import React from "react";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import type { Product } from "@/types/models";

export interface MoveProductCardProps {
  selectedProduct: Product | null;
  displayName: string;
  displaySku: string;
  displayBarcode: string;
  watchProduct: string;
  className?: string;
}

export default function MoveProductCard({
  selectedProduct,
  displayName,
  displaySku,
  displayBarcode,
  watchProduct,
  className = "",
}: MoveProductCardProps) {
  if (!watchProduct) return null;

  return (
    <div className={`p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-md ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 flex-1">
          <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
            สินค้าที่เลือก
          </div>
          <div className="font-bold text-slate-100 text-base">
            {displayName || selectedProduct?.product_name || displaySku || watchProduct}
          </div>
          <div className="text-xs text-slate-400 font-mono flex items-center gap-3">
            <span>SKU: <strong className="text-slate-200">{displaySku || watchProduct}</strong></span>
            {displayBarcode !== "-" && (
              <span>บาร์โค้ด: <strong className="text-slate-200">{displayBarcode}</strong></span>
            )}
          </div>
        </div>

        {displayBarcode !== "-" && (
          <div className="p-2 bg-white rounded-xl shadow-sm border border-slate-200 shrink-0">
            <BarcodeSvg value={displayBarcode} height={36} showText={false} />
          </div>
        )}
      </div>
    </div>
  );
}
