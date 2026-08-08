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
      <div className="glass-card rounded-2xl p-8 text-center border border-white/10 shadow-lg space-y-4">
        <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-200">ยังไม่มีรายการสินค้า</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            กรุณายิงสแกนบาร์โค้ดสินค้าที่กล่อง หรือคลิกปุ่มค้นหาเพื่อเพิ่มรายการรับสินค้า
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenProductSearch}
          className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-all cursor-pointer inline-flex items-center gap-2"
        >
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span>ค้นหาและเลือกสินค้า</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Counters Header */}
      <div className="glass-card rounded-2xl p-4 border border-white/10 shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-400">รายการ: </span>
            <strong className="text-white font-mono">{totalLines}</strong>
          </div>
          <div>
            <span className="text-slate-400">กล่องรวม: </span>
            <strong className="text-white font-mono">{totalBoxes}</strong>
          </div>
          <div>
            <span className="text-slate-400">จำนวนรวม: </span>
            <strong className="text-amber-400 font-mono font-bold text-sm">{totalQty} ชิ้น</strong>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenProductSearch}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-all cursor-pointer flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>เพิ่มสินค้า</span>
        </button>
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
            onToggleConfirm={onToggleConfirm}
            onAddLocationForProduct={onAddLocationForProduct}
            onRemove={onRemove}
            onOpenLocationCamera={onOpenLocationCamera}
            onScanLocation={onScanLocation}
          />
        ))}
      </div>

      {/* Final Action Button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={onOpenConfirmModal}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-xl shadow-emerald-950/40 transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>ตรวจสอบและบันทึกเอกสารรับสินค้า ({totalQty} ชิ้น)</span>
        </button>
      </div>
    </div>
  );
}
