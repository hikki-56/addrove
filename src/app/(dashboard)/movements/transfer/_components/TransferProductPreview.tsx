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
    <div className={`p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200/80 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 flex-1">
          <div className="text-xs font-extrabold text-emerald-700 uppercase tracking-wider">
            ✓ สินค้าที่เลือกโอน
          </div>
          <div className="font-extrabold text-slate-900 text-base">{name}</div>
          <div className="text-xs text-slate-600 font-mono flex items-center gap-3">
            <span>SKU: <strong className="text-slate-900 font-bold">{sku}</strong></span>
            {barcode && (
              <span>บาร์โค้ด: <strong className="text-slate-900 font-bold">{barcode}</strong></span>
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
