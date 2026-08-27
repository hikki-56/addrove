"use client";

import React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import ReceiveLineItem from "./ReceiveLineItem";

export interface ReceiveLinesTableProps {
  form: UseFormReturn<ReceiveDocumentInput, any, any>;
  fields: { id: string; product_id: string; location_id?: string; boxes?: number; qty?: number }[];
  locations: Location[];
  products: Product[];
  activeWhId: string;
  confirmedLines: Record<number, boolean>;
  onToggleConfirm: (index: number) => void;
  onAddLocationForProduct: (index: number) => void;
  onRemove: (index: number) => void;
  onOpenLocationCamera: (index: number) => void;
  onScanLocation: (index: number, code: string) => void;
  onOpenProductSearch: () => void;
  onOpenConfirmModal: () => void;
}

export default function ReceiveLinesTable({
  form,
  fields,
  locations,
  products,
  activeWhId,
  confirmedLines,
  onToggleConfirm,
  onAddLocationForProduct,
  onRemove,
  onOpenLocationCamera,
  onScanLocation,
  onOpenProductSearch,
  onOpenConfirmModal,
}: ReceiveLinesTableProps) {
  const watchLines = form.watch("lines") || [];

  const totalLines = fields.length;
  const totalBoxes = watchLines.reduce((acc, curr) => acc + (Number(curr.boxes) || 1), 0);
  const totalQty = watchLines.reduce((acc, curr) => acc + (Number(curr.qty) || 1), 0);

  if (totalLines === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center border border-slate-200/90 shadow-md shadow-slate-200/60 space-y-4">
        <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto text-emerald-400">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-800">ยังไม่มีรายการสินค้า</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            กรุณายิงสแกนบาร์โค้ดสินค้าที่กล่องเพื่อเพิ่มรายการรับสินค้า
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Counters Header - 3 Grid Cards */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
        {/* Card 1: รายการ */}
        <div className="bg-white rounded-2xl p-2 sm:p-3.5 border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row items-center sm:items-center text-center sm:text-left gap-1 sm:gap-3">
          <div className="w-8 h-8 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center shrink-0 shadow-2xs">
            <svg className="w-4 h-4 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] sm:text-[11px] text-slate-500 font-semibold leading-tight whitespace-nowrap">รายการ</div>
            <div className="text-sm sm:text-xl font-extrabold text-slate-900 leading-tight mt-0.5">{totalLines.toLocaleString()}</div>
          </div>
        </div>

        {/* Card 2: กล่องรวม */}
        <div className="bg-white rounded-2xl p-2 sm:p-3.5 border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row items-center sm:items-center text-center sm:text-left gap-1 sm:gap-3">
          <div className="w-8 h-8 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0 shadow-2xs">
            <svg className="w-4 h-4 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] sm:text-[11px] text-slate-500 font-semibold leading-tight whitespace-nowrap">กล่องรวม</div>
            <div className="text-sm sm:text-xl font-extrabold text-slate-900 leading-tight mt-0.5">{totalBoxes.toLocaleString()}</div>
          </div>
        </div>

        {/* Card 3: จำนวนรวม */}
        <div className="bg-white rounded-2xl p-2 sm:p-3.5 border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row items-center sm:items-center text-center sm:text-left gap-1 sm:gap-3">
          <div className="w-8 h-8 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-teal-50 text-teal-600 border border-teal-100 flex items-center justify-center shrink-0 shadow-2xs">
            <svg className="w-4 h-4 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] sm:text-[11px] text-slate-500 font-semibold leading-tight whitespace-nowrap">จำนวนรวม</div>
            <div className="text-sm sm:text-xl font-extrabold text-emerald-600 leading-tight mt-0.5">
              {totalQty.toLocaleString()} <span className="text-[10px] sm:text-sm font-bold text-emerald-600">ชิ้น</span>
            </div>
          </div>
        </div>
      </div>

      {/* List of Line Items */}
      <div className="space-y-3">
        {fields.map((field, index) => (
          <ReceiveLineItem
            key={field.id}
            index={index}
            fieldId={field.id}
            form={form}
            line={field}
            locations={locations}
            products={products}
            activeWhId={activeWhId}
            isConfirmed={Boolean(confirmedLines[index])}
            isLocked={index > 0 && !confirmedLines[index - 1]}
            onToggleConfirm={onToggleConfirm}
            onAddLocationForProduct={onAddLocationForProduct}
            onRemove={onRemove}
            onOpenLocationCamera={onOpenLocationCamera}
            onScanLocation={onScanLocation}
          />
        ))}
      </div>

      {/* Final Action Button - Shown only when all line items have been confirmed */}
      {(() => {
        const allConfirmed = fields.length > 0 && fields.every((_, idx) => Boolean(confirmedLines[idx]));
        if (!allConfirmed) return null;

        return (
          <div className="pt-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <button
              type="button"
              onClick={onOpenConfirmModal}
              className="w-full py-4 rounded-3xl font-extrabold text-sm sm:text-base bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/25 active:scale-98 cursor-pointer transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>ตรวจสอบและบันทึกเอกสารรับสินค้า</span>
            </button>
          </div>
        );
      })()}
    </div>
  );
}
