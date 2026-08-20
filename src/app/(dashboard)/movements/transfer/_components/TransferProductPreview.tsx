"use client";

import React from "react";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import type { Product } from "@/types/models";

export interface TransferProductPreviewProps {
  selectedProduct: Product | null;
  watchProduct: string;
  className?: string;
}

export default function TransferProductPreview({
  selectedProduct,
  watchProduct,
  className = "",
}: TransferProductPreviewProps) {
  if (!watchProduct || !selectedProduct) return null;

  const sku = selectedProduct.sku || watchProduct;
  const name = selectedProduct.product_name || `สินค้า ${sku}`;
  const barcode = selectedProduct.barcode && selectedProduct.barcode.trim() !== "-" ? selectedProduct.barcode.trim() : "";

  return (
    <div className={`p-4 rounded-xl bg-emerald-50/80 border border-emerald-200/80 shadow-xs ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 flex-1">
          <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            <span>สินค้าที่เลือกโอน</span>
          </div>
          <div className="font-bold text-slate-900 text-sm sm:text-base">{name}</div>
          <div className="text-xs text-slate-600 font-mono flex items-center gap-3">
            <span>SKU: <strong className="text-slate-900 font-semibold">{sku}</strong></span>
            {barcode && (
              <span>บาร์โค้ด: <strong className="text-slate-900 font-semibold">{barcode}</strong></span>
            )}
          </div>
        </div>

        {barcode && (
          <div className="p-1.5 bg-white rounded-xl shadow-xs border border-slate-200 shrink-0">
            <BarcodeSvg value={barcode} height={36} showText={false} />
          </div>
        )}
      </div>
    </div>
  );
}
