"use client";

import React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import BarcodeSvg from "@/components/ui/BarcodeSvg";

export interface ReceiveLineItemProps {
  index: number;
  fieldId: string;
  form: UseFormReturn<ReceiveDocumentInput>;
  line: { product_id: string; location_id?: string; boxes?: number; qty?: number };
  locations: Location[];
  products: Product[];
  activeWhId: string;
  isConfirmed: boolean;
  onToggleConfirm: (index: number) => void;
  onAddLocationForProduct: (index: number) => void;
  onRemove: (index: number) => void;
  onOpenLocationCamera: (index: number) => void;
  onScanLocation: (index: number, code: string) => void;
}

export default function ReceiveLineItem({
  index,
  fieldId,
  form,
  line,
  locations,
  products,
  activeWhId,
  isConfirmed,
  onToggleConfirm,
  onAddLocationForProduct,
  onRemove,
  onOpenLocationCamera,
  onScanLocation,
}: ReceiveLineItemProps) {
  const { register, watch, setValue } = form;

  const currentProductId = (line.product_id || "").trim().toLowerCase();
  const matchedProd = products.find(
    (p) =>
      p.product_id.toLowerCase() === currentProductId ||
      p.sku.toLowerCase() === currentProductId ||
      (p.barcode && p.barcode.trim().toLowerCase() === currentProductId) ||
      p.product_id.toLowerCase() === `prod-${currentProductId}`
  );

  const sku = matchedProd?.sku || line.product_id;
  const name = matchedProd?.product_name || "สินค้าใหม่";
  const barcode = matchedProd?.barcode && matchedProd.barcode.trim() !== "-" ? matchedProd.barcode.trim() : "";
  const category = matchedProd?.category || "ทั่วไป";

  const currentBoxes = watch(`lines.${index}.boxes`) || 1;
  const currentQty = watch(`lines.${index}.qty`) || 1;
  const currentLocation = watch(`lines.${index}.location_id`) || "";

  return (
    <div
      key={fieldId}
      className={`p-4 rounded-2xl border transition-all duration-200 ${
        isConfirmed
          ? "bg-emerald-950/20 border-emerald-500/40 shadow-emerald-950/20"
          : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700/80"
      } shadow-md space-y-3.5`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono text-xs font-bold border border-indigo-500/30">
              #{index + 1}
            </span>
            <span className="font-mono font-bold text-white text-sm sm:text-base">{sku}</span>
            {category && (
              <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-medium border border-slate-700">
                {category}
              </span>
            )}
          </div>
          <div className="font-semibold text-slate-200 text-sm">{name}</div>
          {barcode && (
            <div className="text-xs text-slate-400 font-mono flex items-center gap-1.5">
              <span>บาร์โค้ด:</span>
              <strong className="text-slate-300">{barcode}</strong>
            </div>
          )}
        </div>

        {barcode && (
          <div className="p-1.5 bg-white rounded-xl shadow-sm border border-slate-200 shrink-0 hidden sm:block">
            <BarcodeSvg value={barcode} height={30} showText={false} />
          </div>
        )}

        <button
          type="button"
          onClick={() => onRemove(index)}
          className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer"
          title="ลบรายการ"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-slate-800/80">
        {/* Location selection */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">ตำแหน่งจัดเก็บ *</label>
          <div className="flex items-center gap-1.5">
            <select
              {...register(`lines.${index}.location_id`)}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500"
            >
              <option value="">เลือกตำแหน่งจัดเก็บ</option>
              {locations.map((loc, idx) => {
                const shelfName = (loc as unknown as { shelf_name?: string }).shelf_name;
                const val = loc.location_code || loc.location_id;
                return (
                  <option key={`loc-opt-${val}-${idx}`} value={val}>
                    {loc.location_code} {shelfName ? `(${shelfName})` : ""}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={() => onOpenLocationCamera(index)}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs flex items-center justify-center cursor-pointer"
              title="สแกน QR Code ตำแหน่ง"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Box count */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">จำนวนกล่อง / ลัง</label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setValue(`lines.${index}.boxes`, Math.max(1, currentBoxes - 1), { shouldValidate: true })}
              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm flex items-center justify-center cursor-pointer"
            >
              -
            </button>
            <input
              type="number"
              min="1"
              {...register(`lines.${index}.boxes`, { valueAsNumber: true })}
              className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-center text-slate-100 text-xs font-mono"
            />
            <button
              type="button"
              onClick={() => setValue(`lines.${index}.boxes`, currentBoxes + 1, { shouldValidate: true })}
              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm flex items-center justify-center cursor-pointer"
            >
              +
            </button>
          </div>
        </div>

        {/* Quantity */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">จำนวนชิ้นรวม *</label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setValue(`lines.${index}.qty`, Math.max(1, currentQty - 1), { shouldValidate: true })}
              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm flex items-center justify-center cursor-pointer"
            >
              -
            </button>
            <input
              type="number"
              min="1"
              {...register(`lines.${index}.qty`, { valueAsNumber: true })}
              className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-center text-slate-100 text-xs font-mono font-bold text-amber-300"
            />
            <button
              type="button"
              onClick={() => setValue(`lines.${index}.qty`, currentQty + 1, { shouldValidate: true })}
              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm flex items-center justify-center cursor-pointer"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 gap-2">
        <button
          type="button"
          onClick={() => onAddLocationForProduct(index)}
          className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>แยกเก็บหลายตำแหน่ง</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleConfirm(index)}
          className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
            isConfirmed
              ? "bg-emerald-500 text-white shadow-sm"
              : "bg-slate-800 hover:bg-slate-700 text-slate-300"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{isConfirmed ? "ยืนยันแล้ว" : "ระบุตำแหน่งแล้ว"}</span>
        </button>
      </div>
    </div>
  );
}
