"use client";

import React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { TransferFormInput } from "../_hooks/use-transfer-movement";
import type { Warehouse, Product } from "@/types/models";
import ProductSearchInput from "@/components/ui/ProductSearchInput";
import TransferProductPreview from "./TransferProductPreview";

export interface TransferFormProps {
  form: UseFormReturn<TransferFormInput>;
  warehouses: Warehouse[];
  products: Product[];
  selectedProduct: Product | null;
  staffList: { id: string; full_name: string; role: string }[];
  watchProduct: string;
  watchFromWh: string;
  watchToWh: string;
  error: string;
  onSubmit: (data: TransferFormInput) => void;
  onErrorPrompt: (msg: string) => void;
}

export default function TransferForm({
  form,
  warehouses,
  products,
  selectedProduct,
  staffList,
  watchProduct,
  watchFromWh,
  watchToWh,
  error,
  onSubmit,
  onErrorPrompt,
}: TransferFormProps) {
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = form;

  return (
    <form
      onSubmit={handleSubmit(onSubmit, (formErrors) => {
        const firstMsg = Object.values(formErrors)[0]?.message;
        onErrorPrompt(typeof firstMsg === "string" ? firstMsg : "กรุณากรอกข้อมูลให้ครบถ้วนก่อนสร้างรายการโอน");
      })}
      className="space-y-4"
    >
      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
          {error}
        </div>
      )}

      <div className="glass-card rounded-2xl p-5 border border-white/10 shadow-xl space-y-4">
        <h3 className="font-bold text-slate-100 text-base">สร้างรายการโอนสินค้าใหม่</h3>

        {/* Warehouse From & To */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">โกดังต้นทาง *</label>
            <select
              {...register("from_warehouse_id")}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-100 text-sm font-medium focus:outline-none focus:border-indigo-500"
            >
              {warehouses.map((w) => (
                <option key={`from-wh-${w.warehouse_id}`} value={w.warehouse_id} className="bg-[#111118] text-white">
                  {w.warehouse_name}
                </option>
              ))}
            </select>
            {errors.from_warehouse_id && (
              <p className="mt-1 text-xs text-rose-400">{errors.from_warehouse_id.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">โกดังปลายทาง *</label>
            <select
              {...register("to_warehouse_id")}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-100 text-sm font-medium focus:outline-none focus:border-indigo-500"
            >
              {warehouses
                .filter((w) => w.warehouse_id !== watchFromWh)
                .map((w) => (
                  <option key={`to-wh-${w.warehouse_id}`} value={w.warehouse_id} className="bg-[#111118] text-white">
                    {w.warehouse_name}
                  </option>
                ))}
            </select>
            {errors.to_warehouse_id && (
              <p className="mt-1 text-xs text-rose-400">{errors.to_warehouse_id.message}</p>
            )}
          </div>
        </div>

        {/* Product Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-300">เลือกสินค้าที่จะโอน *</label>
          <ProductSearchInput
            products={products}
            value={watchProduct}
            onChange={(val) => setValue("product_id", val, { shouldValidate: true })}
            placeholder="ค้นหาชื่อสินค้า หรือ SKU..."
          />
          {errors.product_id && (
            <p className="mt-1 text-xs text-rose-400">{errors.product_id.message}</p>
          )}
        </div>

        {/* Product Preview Card */}
        <TransferProductPreview selectedProduct={selectedProduct} watchProduct={watchProduct} />

        {/* Quantity & Moved By */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">จำนวนที่ต้องการโอน *</label>
            <input
              type="number"
              min="1"
              {...register("qty", { valueAsNumber: true })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-100 text-sm font-mono focus:outline-none focus:border-indigo-500"
            />
            {errors.qty && <p className="mt-1 text-xs text-rose-400">{errors.qty.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">ผู้ได้รับมอบหมาย (คนไปย้าย) *</label>
            <select
              {...register("moved_by")}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-100 text-sm font-medium focus:outline-none focus:border-indigo-500"
            >
              <option value="" className="bg-[#111118] text-white">เลือกพนักงานคลังสินค้า</option>
              {staffList.map((s) => (
                <option key={`staff-${s.id}`} value={s.full_name} className="bg-[#111118] text-white">
                  {s.full_name}
                </option>
              ))}
            </select>
            {errors.moved_by && <p className="mt-1 text-xs text-rose-400">{errors.moved_by.message}</p>}
          </div>
        </div>

        {/* Date & Note */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">วันที่เอกสาร *</label>
            <input
              type="date"
              {...register("document_date")}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">หมายเลขอ้างอิง (ถ้ามี)</label>
            <input
              type="text"
              {...register("reference_no")}
              placeholder="เช่น PO-1234, INV-5678"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-xl shadow-emerald-950/40 cursor-pointer transition-all active:scale-95 disabled:opacity-50"
          >
            {isSubmitting ? "กำลังบันทึก..." : "สร้างรายการโอนสินค้า"}
          </button>
        </div>
      </div>
    </form>
  );
}
