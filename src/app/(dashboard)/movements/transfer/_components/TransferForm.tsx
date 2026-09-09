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
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold whitespace-pre-line fade-in flex items-start gap-2.5"
        >
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-2xl bg-[#EAF2EE] border border-[#C9DFD4] text-[#052B1F] text-sm sm:text-base font-bold flex items-center gap-2.5 shadow-xs">
          <svg className="w-5 h-5 text-[#053425] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>{successMessage}</span>
        </div>
      )}

      <div className="bg-white rounded-[20px] p-4 sm:p-6 border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)] space-y-4 sm:space-y-5">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#EEF1EF]">
          <h3 className="font-extrabold text-slate-900 text-base sm:text-lg">สร้างรายการเบิกสินค้าใหม่</h3>
          <div className="flex items-center gap-1.5 text-slate-700 text-sm font-bold bg-slate-100 px-3 py-1.5 rounded-xl border border-[#E8ECEA] shrink-0">
            <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <div className="space-y-1.5">
            <label htmlFor="transfer-from-wh" className="block text-sm sm:text-base font-extrabold text-slate-800 tracking-wide">
              โกดังต้นทาง <span className="text-rose-600">*</span>
            </label>
            <div className="relative">
              <select
                id="transfer-from-wh"
                {...register("from_warehouse_id")}
                className="w-full px-4 sm:px-5 py-3.5 sm:py-4 rounded-2xl bg-white border-2 border-[#D5DDD9] text-slate-900 text-base sm:text-lg font-bold focus:outline-none focus:border-[#0F5C3F] focus:ring-4 focus:ring-[#0F5C3F]/20 shadow-sm transition-colors cursor-pointer appearance-none pr-10"
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
              <p className="mt-1.5 text-sm text-rose-700 font-bold">{errors.from_warehouse_id.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="transfer-to-wh" className="block text-sm sm:text-base font-extrabold text-slate-800 tracking-wide">
              โกดังปลายทาง <span className="text-rose-600">*</span>
            </label>
            <div className="relative">
              <select
                id="transfer-to-wh"
                {...register("to_warehouse_id")}
                className="w-full px-4 sm:px-5 py-3.5 sm:py-4 rounded-2xl bg-white border-2 border-[#D5DDD9] text-slate-900 text-base sm:text-lg font-bold focus:outline-none focus:border-[#0F5C3F] focus:ring-4 focus:ring-[#0F5C3F]/20 shadow-sm transition-colors cursor-pointer appearance-none pr-10"
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
              <p className="mt-1.5 text-sm text-rose-700 font-bold">{errors.to_warehouse_id.message}</p>
            )}
          </div>
        </div>

        {/* Product Selection */}
        <div className="space-y-1.5">
          <div className="block text-sm sm:text-base font-extrabold text-slate-800 tracking-wide">
            เลือกสินค้าที่จะเบิก <span className="text-rose-600">*</span>
          </div>
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
            <span className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">
              รายการสินค้าที่จะเบิก {totalItemsCount > 0 && `(${totalItemsCount} รายการ / ${totalUnits.toLocaleString()} ชิ้น)`}
            </span>
            {totalItemsCount > 0 && clearItems && (
              <button
                type="button"
                onClick={clearItems}
                className="text-sm font-bold text-rose-700 hover:text-rose-900 transition-colors cursor-pointer"
              >
                ล้างทั้งหมด
              </button>
            )}
          </div>

          {totalItemsCount === 0 ? (
            <div className="p-5 rounded-2xl bg-slate-50 border border-[#E8ECEA] text-center text-slate-600 text-sm font-medium space-y-1.5">
              <div className="font-bold text-slate-800 text-base">ยังไม่ได้เลือกสินค้า</div>
              <div>ค้นหาและคลิกเลือกสินค้าในช่องด้านบน สามารถเลือกได้หลายรายการ</div>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-0.5">
              {selectedItems.map((item, idx) => (
                <div
                  key={`sel-item-${item.product_id}-${idx}`}
                  className="p-4 sm:p-5 rounded-2xl bg-white border border-[#E8ECEA] shadow-xs flex flex-col gap-3 hover:border-[#D5DDD9] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {/* Barcode */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-bold text-slate-700 bg-slate-100 border border-[#E8ECEA] px-2 py-0.5 rounded-md shrink-0">
                          บาร์โค้ด
                        </span>
                        <span className="font-mono font-bold text-lg sm:text-xl text-slate-900 tracking-wide truncate">
                          {item.barcode || item.sku}
                        </span>
                      </div>

                      {/* SKU */}
                      <div className="text-sm text-slate-600 font-mono flex items-center gap-2">
                        <span>SKU:</span>
                        <strong className="text-slate-900 font-bold">{item.sku}</strong>
                      </div>

                      {/* Product Name */}
                      <div className="text-sm sm:text-base text-slate-900 font-bold leading-normal line-clamp-2">
                        {item.product_name}
                      </div>
                    </div>

                    {removeItem && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="px-3 min-h-[44px] rounded-xl text-slate-600 hover:text-rose-700 hover:bg-rose-50 flex items-center justify-center gap-1.5 cursor-pointer transition-colors shrink-0 active:scale-95 border border-[#E8ECEA] hover:border-rose-200 text-sm font-bold"
                        title="ลบรายการนี้"
                        aria-label={`ลบรายการ ${item.product_name}`}
                      >
                        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>ลบ</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-[#EEF1EF]">
                    <div className="flex items-center border border-[#E8ECEA] rounded-xl bg-white overflow-hidden shadow-xs">
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
                        className="w-16 sm:w-20 text-center text-xl font-black font-mono text-slate-900 focus:outline-none border-x-2 border-[#E8ECEA] py-2 selection:bg-[#C9DFD4]"
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
                      <span className="text-sm font-bold text-slate-600 mr-2">คงเหลือ:</span>
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
          <div className="block text-sm sm:text-base font-extrabold text-slate-800 tracking-wide">
            ผู้สร้างรายการ
          </div>
          <div className="flex items-center justify-between px-5 py-3.5 sm:py-4 rounded-2xl bg-slate-100/90 border-2 border-[#E8ECEA] text-slate-900 text-base sm:text-lg font-bold shadow-2xs select-none">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-full bg-[#DFEDE6] text-[#053425] flex items-center justify-center font-extrabold text-sm shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <span className="truncate text-slate-900 font-extrabold">
                {currentUserName}
              </span>
            </div>
            <span className="text-sm font-bold text-[#053425] bg-[#EAF2EE] px-3 py-1 rounded-xl border border-[#C9DFD4] shadow-2xs shrink-0 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-[#053425]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            className="w-full py-4 sm:py-4.5 rounded-2xl bg-[#06402B] hover:bg-[#053425] active:bg-[#052B1F] text-white font-extrabold text-base sm:text-lg shadow-lg shadow-[#06402B]/25 cursor-pointer transition-colors active:scale-[.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting
              ? "กำลังสร้างใบเบิกสินค้า..."
              : totalItemsCount > 0
              ? `สร้างรายการเบิกสินค้า (${totalItemsCount} รายการ / ${totalUnits.toLocaleString()} ชิ้น)`
              : "สร้างรายการเบิกสินค้า"}
          </button>
        </div>
      </div>
    </form>
  );
}
