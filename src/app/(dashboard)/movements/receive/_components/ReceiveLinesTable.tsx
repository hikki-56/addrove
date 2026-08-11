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
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
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
      {/* Summary Counters Header */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-md shadow-slate-200/60 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-500 font-semibold">รายการ: </span>
            <strong className="text-slate-900 font-mono font-bold text-sm">{totalLines}</strong>
          </div>
          <div>
            <span className="text-slate-500 font-semibold">กล่องรวม: </span>
            <strong className="text-slate-900 font-mono font-bold text-sm">{totalBoxes}</strong>
          </div>
          <div>
            <span className="text-slate-500 font-semibold">จำนวนรวม: </span>
            <strong className="text-emerald-600 font-mono font-bold text-sm">{totalQty} ชิ้น</strong>
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

      {/* Final Action Button */}
      {(() => {
        const allConfirmed = fields.length > 0 && fields.every((_, idx) => Boolean(confirmedLines[idx]));
        return (
          <div className="pt-2">
            <button
              type="button"
              disabled={!allConfirmed}
              onClick={allConfirmed ? onOpenConfirmModal : undefined}
              className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                allConfirmed
                  ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-xl shadow-emerald-950/40 active:scale-95 cursor-pointer"
                  : "bg-slate-200 text-slate-400 border border-slate-300/80 cursor-not-allowed opacity-80"
              }`}
            >
              {allConfirmed ? (
                <>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>ตรวจสอบและบันทึกเอกสารรับสินค้า</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>🔒 กรุณายืนยันตำแหน่งสินค้าทุกรายการก่อนบันทึก</span>
                </>
              )}
            </button>
          </div>
        );
      })()}
    </div>
  );
}
