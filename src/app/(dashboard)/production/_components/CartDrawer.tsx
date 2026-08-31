"use client";

import type { CartItem, ConsumedMaterial } from "./types";
import { useEscapeKey } from "@/hooks/use-escape-key";

interface CartDrawerProps {
  cart: CartItem[];
  consumedMaterials: ConsumedMaterial[];
  totalCartUnits: number;
  onClose: () => void;
  onUpdateQty: (sku: string, newQty: number) => void;
  onRemove: (sku: string) => void;
  onConfirm: () => void;
}

export default function CartDrawer({
  cart,
  consumedMaterials,
  totalCartUnits,
  onClose,
  onUpdateQty,
  onRemove,
  onConfirm,
}: CartDrawerProps) {
  useEscapeKey(true, onClose);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel — full-screen on mobile, side panel on sm+ */}
      <div className="relative w-full sm:max-w-lg bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🛒</span>
            <div>
              <h3 className="text-base font-bold text-slate-900">ตะกร้าสั่งผลิตสินค้า</h3>
              <p className="text-sm text-slate-600">ตรวจสอบรายการก่อนยืนยันผลิต</p>
            </div>
            <span className="ml-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-sm">
              {cart.length} รายการ
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center font-bold text-base transition-all cursor-pointer"
            aria-label="ปิดตะกร้า"
          >
            ✕
          </button>
        </div>

        {/* Cart Items & Materials List */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {cart.length === 0 ? (
            <div className="py-20 text-center text-slate-500 space-y-3">
              <span className="text-5xl block">🛒</span>
              <p className="text-base font-bold text-slate-700">ยังไม่มีสินค้าในตะกร้า</p>
              <p className="text-sm text-slate-600">เลือกสินค้าและกด &quot;เพิ่มในตะกร้า&quot; เพื่อเริ่มผลิต</p>
            </div>
          ) : (
            <>
              {/* Cart Items */}
              <div className="space-y-3">
                <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                  สินค้าสำเร็จรูปที่สั่งผลิต
                </p>
                {cart.map((item) => (
                  <div
                    key={item.bom.fg_sku}
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center p-1 shrink-0">
                        <img
                          src={item.bom.image || "/products/A002.jpg"}
                          alt={item.bom.fg_name}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono font-bold text-sm">
                            {item.bom.fg_sku}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-900 truncate mt-1">
                          {item.bom.fg_name}
                        </h4>
                        <p className="text-sm text-slate-600 font-medium pt-0.5">
                          ปลายทาง: <span className="text-emerald-800 font-bold">โกดัง 2</span>
                        </p>
                      </div>
                      <button
                        onClick={() => onRemove(item.bom.fg_sku)}
                        className="px-2.5 py-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg font-bold text-sm cursor-pointer border border-transparent hover:border-rose-200 transition-all"
                        title="ลบรายการนี้"
                      >
                        ลบ
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 border-t border-slate-200">
                      <span className="text-sm font-bold text-slate-700">จำนวนที่ผลิต:</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onUpdateQty(item.bom.fg_sku, item.quantity - 1)}
                          className="w-11 h-11 rounded-xl bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 flex items-center justify-center font-bold text-xl cursor-pointer active:scale-95 transition-all shadow-2xs select-none"
                          aria-label="ลดจำนวน"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={item.bom.maxProducible || 9999}
                          value={item.quantity === 0 ? "" : item.quantity}
                          onFocus={(e) => e.target.select()}
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") {
                              onUpdateQty(item.bom.fg_sku, 0);
                              return;
                            }
                            const val = parseInt(raw);
                            if (!isNaN(val)) {
                              onUpdateQty(item.bom.fg_sku, val);
                            }
                          }}
                          onBlur={() => {
                            if (item.quantity < 1) {
                              onUpdateQty(item.bom.fg_sku, 1);
                            }
                          }}
                          className="font-mono font-bold text-base text-slate-900 w-20 h-11 text-center py-1 px-1 bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-emerald-500 cursor-text select-all"
                        />
                        <button
                          onClick={() => onUpdateQty(item.bom.fg_sku, item.quantity + 1)}
                          className="w-11 h-11 rounded-xl bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 flex items-center justify-center font-bold text-xl cursor-pointer active:scale-95 transition-all shadow-2xs select-none"
                          aria-label="เพิ่มจำนวน"
                        >
                          +
                        </button>
                        <span className="text-sm font-bold text-slate-600 ml-1">{item.bom.fg_unit}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Consumed Raw Materials Warning Box */}
              {consumedMaterials.length > 0 && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-3 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">⚠️</span>
                    <div>
                      <p className="text-sm font-bold text-amber-950">
                        วัตถุดิบที่จะถูกตัดออกจากโกดัง 2
                      </p>
                      <p className="text-sm text-amber-800">
                        ระบบจะหักสต็อกวัตถุดิบเหล่านี้ทันทีเมื่อยืนยัน และย้อนคืนไม่ได้
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 divide-y divide-amber-200/80 pt-1">
                    {consumedMaterials.map((c) => (
                      <div key={c.rm_sku} className="flex items-baseline justify-between gap-3 pt-1.5 first:pt-0">
                        <span className="text-sm font-semibold text-slate-900 min-w-0 truncate">
                          {c.rm_name}
                        </span>
                        <span className="text-base font-mono font-bold text-amber-900 shrink-0">
                          −{Math.ceil(c.total_required).toLocaleString()} {c.rm_unit}
                        </span>
                      </div>
                    ))}
                  </div>

                  <p className="text-sm text-slate-600 pt-1">
                    ตรวจรายการนี้กับของจริงก่อนกดยืนยันการสั่งผลิต
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer / Submit */}
        {cart.length > 0 && (
          <div className="p-5 sm:p-6 border-t border-slate-200 bg-slate-50 space-y-4 shrink-0">
            <div className="flex items-center justify-between text-sm font-bold text-slate-700">
              <span>ยอดผลิตรวมทั้งหมด:</span>
              <span className="text-xl font-bold text-emerald-800 font-mono">
                +{totalCartUnits.toLocaleString()} ชิ้น
              </span>
            </div>

            <button
              type="button"
              onClick={onConfirm}
              className="w-full py-4 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-base flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-600/20 cursor-pointer"
            >
              <span>ตรวจสอบและยืนยันการสั่งผลิต</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
