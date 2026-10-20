import { useTabAuth } from "@/context/TabAuthContext";
import type { UseFormReturn } from "react-hook-form";
import type { TransferFormInput, SelectedTransferItem } from "@/features/transfer/hooks/use-transfer-movement";
import type { Warehouse, Product } from "@/types/models";
import ProductSearchInput from "@/components/ui/ProductSearchInput";
import { M3Banner, M3Empty, M3Field, m3Cls } from "@/components/ui/m3";
import { SolarAddLine, SolarAltArrowDown, SolarArrowRight, SolarBox, SolarCalendarPlan, SolarMinusLine, SolarUsers } from "@/components/icons";

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
        <M3Banner tone="error" role="alert" className="fade-in whitespace-pre-line">
          {error}
        </M3Banner>
      )}

      {successMessage && <M3Banner tone="success" role="status">{successMessage}</M3Banner>}

      <div className="m3-card space-y-6 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-m3-grey-800">สร้างรายการเบิกสินค้าใหม่</h2>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-m3-grey-600">
            <SolarCalendarPlan size={16} className="text-m3-grey-500" />
            {new Date().toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })}
            <input type="hidden" {...register("document_date")} />
          </span>
        </div>

        {/* Warehouse From & To (D17) */}
        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4">
          <div>
            <M3Field label={<>โกดังต้นทาง <span className="text-m3-error-dark">*</span></>} error={Boolean(errors.from_warehouse_id)}>
              <div className="relative">
                <select id="transfer-from-wh" {...register("from_warehouse_id")} className={`${m3Cls.input} h-12 cursor-pointer appearance-none pr-10 text-base`}>
                  {warehouses.map((w) => (
                    <option key={`from-wh-${w.warehouse_id}`} value={w.warehouse_id}>
                      {w.warehouse_name}
                    </option>
                  ))}
                </select>
                <SolarAltArrowDown size={18} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-m3-grey-500" />
              </div>
            </M3Field>
            {errors.from_warehouse_id && (
              <p className="mt-1.5 text-xs font-semibold text-m3-error-dark">{errors.from_warehouse_id.message}</p>
            )}
          </div>

          <SolarArrowRight size={22} className="mx-auto hidden h-12 text-m3-primary sm:block" />

          <div>
            <M3Field label={<>โกดังปลายทาง <span className="text-m3-error-dark">*</span></>} error={Boolean(errors.to_warehouse_id)}>
              <div className="relative">
                <select id="transfer-to-wh" {...register("to_warehouse_id")} className={`${m3Cls.input} h-12 cursor-pointer appearance-none pr-10 text-base`}>
                  {warehouses
                    .filter((w) => w.warehouse_id !== watchFromWh)
                    .map((w) => (
                      <option key={`to-wh-${w.warehouse_id}`} value={w.warehouse_id}>
                        {w.warehouse_name}
                      </option>
                    ))}
                </select>
                <SolarAltArrowDown size={18} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-m3-grey-500" />
              </div>
            </M3Field>
            {errors.to_warehouse_id && (
              <p className="mt-1.5 text-xs font-semibold text-m3-error-dark">{errors.to_warehouse_id.message}</p>
            )}
          </div>
        </div>

        {/* Product Selection */}
        <div className="space-y-2">
          <div className="text-sm font-bold text-m3-grey-800">
            เลือกสินค้าที่จะเบิก <span className="text-m3-error-dark">*</span>
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
            placeholder="ค้นหาสินค้า / SKU / บาร์โค้ด"
          />
        </div>

        {/* Selected Items List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-m3-grey-800">
              รายการสินค้าที่จะเบิก {totalItemsCount > 0 && `(${totalItemsCount} รายการ / ${totalUnits.toLocaleString()} ชิ้น)`}
            </span>
            {totalItemsCount > 0 && clearItems && (
              <button type="button" onClick={clearItems} className="m3-btn m3-btn-sm m3-btn-text text-m3-error-dark hover:bg-[rgba(255,86,48,0.08)]">
                ล้างทั้งหมด
              </button>
            )}
          </div>

          {totalItemsCount === 0 ? (
            <M3Empty title="ยังไม่ได้เลือกสินค้า" icon={<SolarBox size={32} />} />
          ) : (
            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-0.5">
              {selectedItems.map((item, idx) => (
                <div
                  key={`sel-item-${item.product_id}-${idx}`}
                  className="flex flex-col gap-3 rounded-xl border border-[rgba(145,158,171,0.2)] p-4 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-m3-grey-200 text-m3-grey-500">
                      <SolarBox size={24} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm font-bold text-m3-grey-800">{item.product_name}</div>
                      <div className="mt-0.5 truncate text-xs tabular-nums text-m3-grey-500">
                        บาร์โค้ด {item.barcode || item.sku}
                        {item.sku && item.sku !== (item.barcode || item.sku) ? ` · SKU ${item.sku}` : ""}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-sm text-m3-grey-600 sm:text-right">
                      คงเหลือ: <span className="font-bold tabular-nums text-m3-grey-800">{(item.stock_qty ?? 0).toLocaleString()} ชิ้น</span>
                    </div>
                    <div className="flex items-center gap-2">
                    <div className="flex h-11 items-center overflow-hidden rounded-lg border border-[rgba(145,158,171,0.32)] bg-white">
                      <button
                        type="button"
                        aria-label="ลดจำนวน"
                        onClick={() => updateItemQty && updateItemQty(idx, Math.max(1, item.qty - 1))}
                        disabled={item.qty <= 1}
                        className="flex size-11 cursor-pointer items-center justify-center text-m3-grey-700 select-none transition-colors hover:bg-[rgba(145,158,171,0.08)] disabled:cursor-not-allowed disabled:opacity-32"
                      >
                        <SolarMinusLine size={18} />
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
                        className="h-full w-16 text-center text-base font-semibold tabular-nums text-m3-grey-800 focus:outline-none sm:w-20"
                      />
                      <button
                        type="button"
                        aria-label="เพิ่มจำนวน"
                        onClick={() => updateItemQty && updateItemQty(idx, (item.qty || 0) + 1)}
                        disabled={item.stock_qty !== undefined && item.stock_qty !== null && item.qty >= item.stock_qty}
                        className="flex size-11 cursor-pointer items-center justify-center text-m3-grey-700 select-none transition-colors hover:bg-[rgba(145,158,171,0.08)] disabled:cursor-not-allowed disabled:opacity-32"
                      >
                        <SolarAddLine size={18} />
                      </button>
                    </div>
                    {removeItem && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="m3-btn m3-btn-sm m3-btn-text shrink-0 text-m3-error-dark hover:bg-[rgba(255,86,48,0.08)]"
                        title="ลบรายการนี้"
                        aria-label={`ลบรายการ ${item.product_name}`}
                      >
                        ลบ
                      </button>
                    )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Creator Info Display */}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-m3-grey-100 px-4 py-3 select-none">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgba(0,167,111,0.16)] text-m3-primary-darker">
              <SolarUsers size={20} />
            </span>
            <div className="min-w-0">
              <div className="text-xs text-m3-grey-500">ผู้สร้างรายการ</div>
              <div className="truncate text-sm font-bold text-m3-grey-800">{currentUserName}</div>
            </div>
          </div>
          <span className="shrink-0 text-xs text-m3-grey-500">คนสร้างเอกสาร</span>
          <input type="hidden" {...register("moved_by")} value="" />
        </div>

        <M3Banner tone="info">ถ้าสินค้าอยู่หลายชั้นวางในโกดังต้นทาง พนักงานจะสแกนหยิบแยกตามตำแหน่งจนครบจำนวน</M3Banner>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="m3-btn m3-btn-primary h-12 w-full px-6 text-[15px] shadow-[0_8px_16px_rgba(0,167,111,0.24)] disabled:opacity-48 sm:w-auto"
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
