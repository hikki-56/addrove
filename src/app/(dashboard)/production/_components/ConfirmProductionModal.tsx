"use client";

import type { CartItem, ConsumedMaterial } from "./types";
import { useEscapeKey } from "@/hooks/use-escape-key";

interface ConfirmProductionModalProps {
  cart: CartItem[];
  consumedMaterials: ConsumedMaterial[];
  totalCartUnits: number;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmProductionModal({
  cart,
  consumedMaterials,
  totalCartUnits,
  isSubmitting,
  onConfirm,
  onCancel,
}: ConfirmProductionModalProps) {
  // Escape = ยกเลิก ไม่ใช่ยืนยัน — หน้านี้หักวัตถุดิบถาวร
  useEscapeKey(true, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-5 sm:p-6 space-y-5">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900">
            ยืนยันการสั่งผลิตสินค้า
          </h2>
          <p className="text-sm text-slate-600">
            โปรดตรวจสอบรายการสินค้าและวัตถุดิบก่อนดำเนินการ
          </p>
        </div>

        {/* What will be added (+) */}
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 space-y-2">
          <p className="text-sm font-bold text-emerald-800 uppercase tracking-wider">
            + สินค้าสำเร็จรูปที่จะเพิ่มเข้าโกดัง 2
          </p>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {cart.map((item) => (
              <div key={item.bom.fg_sku} className="flex items-baseline justify-between text-sm">
                <span className="font-semibold text-emerald-950 truncate">{item.bom.fg_name}</span>
                <span className="font-mono font-bold text-emerald-900 shrink-0">
                  +{item.quantity.toLocaleString()} {item.bom.fg_unit}
                </span>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-emerald-200 flex justify-between items-baseline font-bold">
            <span className="text-sm text-emerald-800">ยอดผลิตรวม</span>
            <span className="text-lg font-mono text-emerald-900">
              +{totalCartUnits.toLocaleString()} ชิ้น
            </span>
          </div>
        </div>

        {/* What will be deducted (-) */}
        <div className="rounded-2xl bg-amber-50 border border-amber-300 p-4 space-y-2">
          <p className="text-sm font-bold text-amber-800 uppercase tracking-wider">
            − วัตถุดิบที่จะถูกตัดออกจากโกดัง 2 ทันที
          </p>
          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {consumedMaterials.map((c) => (
              <div key={c.rm_sku} className="flex items-baseline justify-between text-sm">
                <span className="font-semibold text-amber-950 truncate">{c.rm_name}</span>
                <span className="font-mono font-bold text-amber-900 shrink-0">
                  −{Math.ceil(c.total_required).toLocaleString()} {c.rm_unit}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Critical Warning */}
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 flex items-center gap-2.5 text-sm text-rose-800 font-bold">
          <span className="text-base shrink-0">⚠️</span>
          <span>กดยืนยันแล้วระบบจะตัดสต็อกวัตถุดิบทันทีและไม่สามารถเรียกคืนได้</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2.5 pt-1">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onConfirm}
            className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-base transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>ยืนยัน ผลิต {totalCartUnits.toLocaleString()} ชิ้น</span>
            )}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="w-full py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-all cursor-pointer border border-slate-200 active:scale-95"
          >
            กลับไปตรวจอีกครั้ง
          </button>
        </div>
      </div>
    </div>
  );
}
