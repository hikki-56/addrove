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
    <div className={`p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-md ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 flex-1">
          <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
            สินค้าที่เลือกโอน
          </div>
          <div className="font-bold text-slate-100 text-base">{name}</div>
          <div className="text-xs text-slate-400 font-mono flex items-center gap-3">
            <span>SKU: <strong className="text-slate-200">{sku}</strong></span>
            {barcode && (
              <span>บาร์โค้ด: <strong className="text-slate-200">{barcode}</strong></span>
            )}
          </div>
        </div>

        {barcode && (
          <div className="p-2 bg-white rounded-xl shadow-sm border border-slate-200 shrink-0">
            <BarcodeSvg value={barcode} height={36} showText={false} />
          </div>
        )}
      </div>
    </div>
  );
}
