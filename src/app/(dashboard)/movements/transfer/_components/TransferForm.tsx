import { useTabAuth } from "@/context/TabAuthContext";
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
  successMessage?: string;
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
  successMessage = "",
  selectedItems = [],
  addTransferItem,
  updateItemQty,
  removeItem,
  clearItems,
}: TransferFormProps) {
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = form;
  const { user: tabUser } = useTabAuth();
  const currentUserName = tabUser?.name || "พนักงานคลังสินค้า";

  const totalItemsCount = selectedItems.length;
  const totalUnits = selectedItems.reduce((acc, curr) => acc + curr.qty, 0);

  return (
    <form
      onSubmit={handleSubmit(onSubmit, (formErrors) => {
        const firstMsg = Object.values(formErrors)[0]?.message;
        onErrorPrompt(typeof firstMsg === "string" ? firstMsg : "กรุณากรอกข้อมูลให้ครบถ้วนก่อนสร้างรายการเบิก");
      })}
      className="space-y-4"
    >
      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-xs font-medium">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs sm:text-sm font-bold flex items-center gap-2 shadow-xs">
          <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>{successMessage}</span>
        </div>
      )}

      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-lg space-y-4 sm:space-y-5">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <h3 className="font-extrabold text-slate-800 text-base sm:text-lg">สร้างรายการเบิกสินค้าใหม่</h3>
          <div className="flex items-center gap-1.5 text-slate-600 text-xs font-bold bg-slate-100/90 px-3 py-1.5 rounded-xl border border-slate-200/80 shrink-0">
            <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2v12a2 2 0 002 2z" />
            </svg>
            <span>
              {new Date().toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })}
            </span>
            <input type="hidden" {...register("document_date")} />
          </div>
        </div>

        {/* Warehouse From & To */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-5">
          <div className="space-y-1">
            <label className="block text-sm sm:text-base font-extrabold text-slate-800 tracking-wide">
              โกดังต้นทาง <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <select
                {...register("from_warehouse_id")}
                className="w-full px-4 sm:px-5 py-3.5 sm:py-4 rounded-2xl bg-white border-2 border-slate-300 text-slate-900 text-base sm:text-lg font-bold focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 shadow-sm transition-all cursor-pointer appearance-none pr-10"
              >
                {warehouses.map((w) => (
                  <option key={`from-wh-${w.warehouse_id}`} value={w.warehouse_id} className="text-base font-bold py-2">
                    {w.warehouse_name}
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            {errors.from_warehouse_id && (
              <p className="mt-1 text-xs text-rose-500 font-medium">{errors.from_warehouse_id.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-sm sm:text-base font-extrabold text-slate-800 tracking-wide">
              โกดังปลายทาง <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <select
                {...register("to_warehouse_id")}
                className="w-full px-4 sm:px-5 py-3.5 sm:py-4 rounded-2xl bg-white border-2 border-slate-300 text-slate-900 text-base sm:text-lg font-bold focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 shadow-sm transition-all cursor-pointer appearance-none pr-10"
              >
                {warehouses
                  .filter((w) => w.warehouse_id !== watchFromWh)
                  .map((w) => (
                    <option key={`to-wh-${w.warehouse_id}`} value={w.warehouse_id} className="text-base font-bold py-2">
                      {w.warehouse_name}
                    </option>
                  ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            {errors.to_warehouse_id && (
              <p className="mt-1 text-xs text-rose-500 font-medium">{errors.to_warehouse_id.message}</p>
            )}
          </div>
        </div>

        {/* Product Selection */}
        <div className="space-y-1.5">
          <label className="block text-sm sm:text-base font-extrabold text-slate-800 tracking-wide">
            เลือกสินค้าที่จะเบิก <span className="text-rose-500">*</span>
          </label>
          <ProductSearchInput
            size="lg"
            products={products}
            value={watchProduct}
            onChange={(val) => setValue("product_id", val, { shouldValidate: true })}
            onSelectProduct={(prod) => {
              if (addTransferItem) {
                addTransferItem(prod);
                setValue("product_id", "");
              }
            }}
            placeholder="ค้นหาชื่อสินค้า SKU หรือ บาร์โค้ด แล้วคลิกเพื่อเพิ่ม..."
          />
        </div>

        {/* Selected Items List */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
              รายการสินค้าที่จะเบิก {totalItemsCount > 0 && `(${totalItemsCount} รายการ / ${totalUnits} ชิ้น)`}
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
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-slate-500 text-xs font-normal space-y-1">
              <div className="font-semibold text-slate-700">ยังไม่ได้เลือกสินค้า</div>
              <div className="text-slate-400">ค้นหาและคลิกเลือกสินค้าในช่องด้านบน สามารถเลือกได้หลายรายการ</div>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-0.5">
              {selectedItems.map((item, idx) => (
                <div
                  key={`sel-item-${item.product_id}-${idx}`}
                  className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col gap-3 hover:border-slate-300 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      {/* Barcode */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md shrink-0">
                          บาร์โค้ด
                        </span>
                        <span className="font-mono font-bold text-base sm:text-lg text-slate-900 tracking-wide truncate">
                          {item.barcode || item.sku}
                        </span>
                      </div>

                      {/* SKU */}
                      <div className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
                        <span>SKU:</span>
                        <strong className="text-slate-700 font-semibold">{item.sku}</strong>
                      </div>

                      {/* Product Name */}
                      <div className="text-xs sm:text-sm text-slate-800 font-medium leading-normal line-clamp-2">
                        {item.product_name}
                      </div>
                    </div>

                    {removeItem && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer transition-all shrink-0 active:scale-95"
                        title="ลบรายการนี้"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-slate-100">
                    <div className="flex items-center border border-slate-200 rounded-xl bg-white overflow-hidden shadow-xs">
                      <button
                        type="button"
                        onClick={() => updateItemQty && updateItemQty(idx, Math.max(1, item.qty - 1))}
                        disabled={item.qty <= 1}
                        className="w-12 sm:w-14 h-12 sm:h-14 flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed font-black text-2xl cursor-pointer select-none transition-colors"
                      >
                        -
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={item.qty === 0 ? "" : item.qty}
                        onFocus={(e) => e.target.select()}
                        onClick={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          const rawVal = e.target.value.replace(/[^0-9]/g, "");
                          if (rawVal === "") {
                            updateItemQty && updateItemQty(idx, 0);
                            return;
                          }
                          const parsed = parseInt(rawVal, 10);
                          if (!isNaN(parsed)) {
                            const maxQty = item.stock_qty !== undefined && item.stock_qty !== null ? item.stock_qty : Infinity;
                            updateItemQty && updateItemQty(idx, Math.min(parsed, maxQty));
                          }
                        }}
                        onBlur={(e) => {
                          const rawVal = e.target.value.replace(/[^0-9]/g, "");
                          const parsed = parseInt(rawVal, 10);
                          if (isNaN(parsed) || parsed < 1) {
                            updateItemQty && updateItemQty(idx, 1);
                          }
                        }}
                        className="w-16 sm:w-20 text-center text-lg sm:text-xl font-black font-mono text-slate-900 focus:outline-none border-x-2 border-slate-200 py-2 selection:bg-indigo-200"
                      />
                      <button
                        type="button"
                        onClick={() => updateItemQty && updateItemQty(idx, (item.qty || 0) + 1)}
                        disabled={item.stock_qty !== undefined && item.stock_qty !== null && item.qty >= item.stock_qty}
                        className="w-12 sm:w-14 h-12 sm:h-14 flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed font-black text-2xl cursor-pointer select-none transition-colors"
                      >
                        +
                      </button>
                    </div>

                    <div className="text-right">
                      <span className="text-sm font-bold text-slate-500 mr-2">คงเหลือ:</span>
                      <span className="text-base sm:text-lg font-black font-mono text-slate-950">
                        {(item.stock_qty ?? 0).toLocaleString()} ชิ้น
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Creator Info Display */}
        <div className="space-y-1.5">
          <label className="block text-sm sm:text-base font-extrabold text-slate-800 tracking-wide">
            ผู้สร้างรายการ
          </label>
          <div className="flex items-center justify-between px-5 py-3.5 sm:py-4 rounded-2xl bg-slate-100/90 border-2 border-slate-200 text-slate-900 text-base sm:text-lg font-bold shadow-2xs select-none">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-extrabold text-sm shrink-0">
                👤
              </div>
              <span className="truncate text-slate-900 font-extrabold">
                {currentUserName}
              </span>
            </div>
            <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-xl border border-purple-200 shadow-2xs shrink-0 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>คนสร้างเอกสาร</span>
            </span>
          </div>
          <input type="hidden" {...register("moved_by")} value="" />
        </div>

        <div className="pt-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 sm:py-4.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-extrabold text-base sm:text-lg shadow-lg shadow-emerald-600/25 cursor-pointer transition-all active:scale-98 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting
              ? "กำลังสร้างใบเบิกสินค้า..."
              : totalItemsCount > 0
              ? `สร้างรายการเบิกสินค้า (${totalItemsCount} รายการ / ${totalUnits} ชิ้น)`
              : "สร้างรายการเบิกสินค้า"}
          </button>
        </div>
      </div>
    </form>
  );
}
