"use client";

import React from "react";
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
    <div className={`p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5 flex-1">
          <div className="text-sm font-extrabold text-emerald-800 uppercase tracking-wider">
            สินค้าที่เลือก
          </div>
          <div className="font-extrabold text-slate-900 text-base sm:text-lg">
            {displayName || selectedProduct?.product_name || displaySku || watchProduct}
          </div>
          <div className="text-sm text-slate-600 font-mono flex items-center gap-3 flex-wrap">
            <span>SKU: <strong className="text-slate-900 font-bold">{displaySku || watchProduct}</strong></span>
            {displayBarcode !== "-" && (
              <span>บาร์โค้ด: <strong className="text-slate-900 font-bold">{displayBarcode}</strong></span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
