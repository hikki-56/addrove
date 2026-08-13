import React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { TransferFormInput, SelectedTransferItem } from "../_hooks/use-transfer-movement";
import type { Warehouse, Product } from "@/types/models";
import ProductSearchInput from "@/components/ui/ProductSearchInput";

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
  selectedItems?: SelectedTransferItem[];
  addTransferItem?: (prod: Product) => void;
  updateItemQty?: (index: number, newQty: number) => void;
  removeItem?: (index: number) => void;
  clearItems?: () => void;
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
  selectedItems = [],
  addTransferItem,
  updateItemQty,
  removeItem,
  clearItems,
}: TransferFormProps) {
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = form;

  const totalItemsCount = selectedItems.length;
  const totalUnits = selectedItems.reduce((acc, curr) => acc + curr.qty, 0);

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

      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <h3 className="font-extrabold text-slate-800 text-base sm:text-lg">สร้างรายการโอนสินค้าใหม่</h3>
          <div className="flex items-center gap-2 text-slate-600 text-xs sm:text-sm font-bold bg-slate-100/80 px-3.5 py-1.5 rounded-xl border border-slate-200/80">
            <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2v12a2 2 0 002 2z" />
            </svg>
            <span>
              {new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}
            </span>
            <input type="hidden" {...register("document_date")} />
          </div>
        </div>

        {/* Warehouse From & To */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">โกดังต้นทาง *</label>
            <select
              {...register("from_warehouse_id")}
              className="w-full px-4 py-3 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm font-semibold focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            >
              {warehouses.map((w) => (
                <option key={`from-wh-${w.warehouse_id}`} value={w.warehouse_id}>
                  {w.warehouse_name}
                </option>
              ))}
            </select>
            {errors.from_warehouse_id && (
              <p className="mt-1 text-xs text-rose-500 font-medium">{errors.from_warehouse_id.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">โกดังปลายทาง *</label>
            <select
              {...register("to_warehouse_id")}
              className="w-full px-4 py-3 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm font-semibold focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            >
              {warehouses
                .filter((w) => w.warehouse_id !== watchFromWh)
                .map((w) => (
                  <option key={`to-wh-${w.warehouse_id}`} value={w.warehouse_id}>
                    {w.warehouse_name}
                  </option>
                ))}
            </select>
            {errors.to_warehouse_id && (
              <p className="mt-1 text-xs text-rose-500 font-medium">{errors.to_warehouse_id.message}</p>
            )}
          </div>
        </div>

        {/* Product Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">เลือกสินค้าที่จะโอน *</label>
          <ProductSearchInput
            products={products}
            value={watchProduct}
            onChange={(val) => setValue("product_id", val, { shouldValidate: true })}
            onSelectProduct={(prod) => {
              if (addTransferItem) {
                addTransferItem(prod);
                setValue("product_id", "");
              }
            }}
            placeholder="ค้นหาชื่อสินค้า SKU หรือ บาร์โค้ด แล้วคลิกเพื่อเพิ่มรายการ..."
          />
        </div>

        {/* Selected Items List */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
              รายการสินค้าที่จะโอน {totalItemsCount > 0 && `(${totalItemsCount} รายการ / ${totalUnits} ชิ้น)`}
            </span>
            {totalItemsCount > 0 && clearItems && (
              <button
                type="button"
                onClick={clearItems}
                className="text-xs font-bold text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
              >
                ล้างทั้งหมด
              </button>
            )}
          </div>

          {totalItemsCount === 0 ? (
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 text-center text-slate-500 text-xs font-medium space-y-1">
              <div>📦 ยังไม่ได้เลือกสินค้า</div>
              <div className="text-slate-400">ค้นหาและคลิกเลือกสินค้าในช่องด้านบน สามารถเลือกได้หลายรายการ</div>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {selectedItems.map((item, idx) => (
                <div
                  key={`sel-item-${item.product_id}-${idx}`}
                  className="p-3.5 rounded-2xl bg-slate-50/90 border border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-xs hover:border-indigo-300 transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold text-slate-900 text-sm sm:text-base">{item.product_name}</div>
                    <div className="text-xs text-slate-500 font-mono flex flex-wrap items-center gap-3 pt-0.5">
                      <span>SKU: <strong className="text-slate-900 font-bold">{item.sku}</strong></span>
                      {item.barcode && (
                        <span>บาร์โค้ด: <strong className="text-slate-900 font-bold">{item.barcode}</strong></span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3.5 shrink-0">
                    <div className="flex items-center border border-slate-300 rounded-xl bg-white overflow-hidden shadow-2xs">
                      <button
                        type="button"
                        onClick={() => updateItemQty && updateItemQty(idx, item.qty - 1)}
                        disabled={item.qty <= 1}
                        className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed font-extrabold text-base cursor-pointer select-none transition-colors"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="1"
                        max={item.stock_qty !== undefined && item.stock_qty !== null ? item.stock_qty : undefined}
                        value={item.qty}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value) || 1;
                          const maxQty = item.stock_qty !== undefined && item.stock_qty !== null ? item.stock_qty : Infinity;
                          const val = Math.min(Math.max(1, parsed), maxQty);
                          updateItemQty && updateItemQty(idx, val);
                        }}
                        className="w-14 text-center text-sm font-extrabold font-mono text-slate-900 focus:outline-none border-x border-slate-200 py-1"
                      />
                      <button
                        type="button"
                        onClick={() => updateItemQty && updateItemQty(idx, item.qty + 1)}
                        disabled={item.stock_qty !== undefined && item.stock_qty !== null && item.qty >= item.stock_qty}
                        className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed font-extrabold text-base cursor-pointer select-none transition-colors"
                      >
                        +
                      </button>
                    </div>

                    {/* Right Side: Warehouse Stock Balance Text */}
                    <div className="flex flex-col items-end shrink-0 text-right min-w-[65px]">
                      <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">คงเหลือ</span>
                      <span className="text-xs sm:text-sm font-extrabold font-mono text-slate-900">
                        {(item.stock_qty ?? 0).toLocaleString()} ชิ้น
                      </span>
                    </div>

                    {removeItem && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="p-2 text-slate-400 hover:text-rose-600 rounded-xl hover:bg-rose-50 cursor-pointer transition-all"
                        title="ลบรายการนี้"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assigned Staff */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">ผู้ได้รับมอบหมาย (คนไปย้าย) *</label>
          <select
            {...register("moved_by")}
            className="w-full px-4 py-3 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm font-semibold focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">เลือกพนักงานคลังสินค้า</option>
            {staffList.map((s) => (
              <option key={`staff-${s.id}`} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
          {errors.moved_by && <p className="mt-1 text-xs text-rose-500 font-medium">{errors.moved_by.message}</p>}
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 cursor-pointer transition-all active:scale-95 disabled:opacity-50"
          >
            {isSubmitting
              ? "กำลังบันทึก..."
              : totalItemsCount > 0
              ? `สร้างรายการโอนสินค้า (${totalItemsCount} รายการ / ${totalUnits} ชิ้น)`
              : "สร้างรายการโอนสินค้า"}
          </button>
        </div>
      </div>
    </form>
  );
}
