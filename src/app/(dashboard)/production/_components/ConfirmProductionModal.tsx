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
  // Escape = ยกเลิก ไม่ใช่ยืนยัน — หน้านี้สร้างใบผลิตที่พนักงานจะใช้ตรวจรับต่อ
  // ระหว่างส่งคำสั่งผลิต (isSubmitting) ปิด Escape ไว้ กันปิดหน้าต่างไปแต่ระบบยังสร้างใบผลิตต่อ
  useEscapeKey(!isSubmitting, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-[#E8ECEA] shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-5 sm:p-6 space-y-5">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900">
            ยืนยันการสั่งผลิตสินค้า
          </h2>
          <p className="text-sm text-slate-600">
            โปรดตรวจสอบรายการสินค้าและวัตถุดิบก่อนดำเนินการ
          </p>
        </div>

        {/* What will be produced (+) */}
        <div className="rounded-2xl bg-[#EAF2EE] border border-[#C9DFD4] p-4 space-y-2">
          <p className="text-sm font-bold text-[#052B1F] uppercase tracking-wider">
            + สินค้าสำเร็จรูปตามใบผลิต (ตามผลตรวจจริง)
          </p>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {cart.map((item) => (
              <div key={`${item.table_no}-${item.bom.fg_sku}`} className="flex items-baseline justify-between text-sm gap-2">
                <span className="flex items-baseline gap-1.5 min-w-0">
                  <span className="shrink-0 rounded bg-[#06402B] px-1.5 py-0.5 text-[10px] font-black text-white font-mono">
                    โต๊ะ {item.table_no}
                  </span>
                  <span className="font-semibold text-[#031B14] truncate">{item.bom.fg_name}</span>
                </span>
                <span className="font-mono font-bold text-[#04231A] shrink-0">
                  +{item.quantity.toLocaleString()} {item.bom.fg_unit}
                </span>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-[#C9DFD4] flex justify-between items-baseline font-bold">
            <span className="text-sm text-[#052B1F]">ยอดผลิตรวม</span>
            <span className="text-lg font-mono text-[#04231A]">
              +{totalCartUnits.toLocaleString()} ชิ้น
            </span>
          </div>
        </div>

        {/* Materials planned (-) */}
        <div className="rounded-2xl bg-amber-50 border border-amber-300 p-4 space-y-2">
          <p className="text-sm font-bold text-amber-800 uppercase tracking-wider">
            − วัตถุดิบตามแผน (จะถูกตัดเมื่อตรวจผลผลิตจริง)
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

        {/* Info */}
        <div className="rounded-xl bg-sky-50 border border-sky-200 p-3.5 flex items-center gap-2.5 text-sm text-sky-800 font-bold">
          <span className="text-base shrink-0">📋</span>
          <span>กดยืนยันแล้วจะสร้าง &quot;ใบผลิต&quot; — ยังไม่ตัดสต็อก รอพนักงานตรวจการผลิตและระบุผลิตได้จริงก่อน</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2.5 pt-1">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onConfirm}
            className="w-full py-4 rounded-xl bg-[#06402B] hover:bg-[#053425] active:scale-[0.98] text-white font-bold text-base transition-all shadow-lg shadow-[#06402B]/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>สร้างใบผลิต {totalCartUnits.toLocaleString()} ชิ้น</span>
            )}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="w-full py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-all cursor-pointer border border-[#E8ECEA] active:scale-95"
          >
            กลับไปตรวจอีกครั้ง
          </button>
        </div>
      </div>
    </div>
  );
}
