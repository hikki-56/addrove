"use client";

import { useEscapeKey } from "@/hooks/use-escape-key";

interface PlanExitConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  lineCount: number;
  planNo: string;
}

// กันแตะ "ออกจากโหมดแผน" พลาด — ถ้ามีรายการที่สแกนอยู่ต้องยืนยันก่อนจึงจะล้างเซสชันได้
export default function PlanExitConfirmModal({ isOpen, onClose, onConfirm, lineCount, planNo }: PlanExitConfirmModalProps) {
  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs fade-in">
      <div className="w-full max-w-md bg-white rounded-[20px] border border-[#E8ECEA] shadow-xl p-4 sm:p-6 space-y-4 scale-in">
        <div className="flex items-center justify-between border-b border-[#EEF1EF] pb-3">
          <h3 className="font-extrabold text-[#111827] text-lg sm:text-xl leading-tight">ออกจากโหมดแผน?</h3>
          <button
            type="button"
            aria-label="ปิดหน้าต่าง"
            onClick={onClose}
            className="w-11 h-11 shrink-0 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-xl hover:bg-black/[.04] cursor-pointer transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-3.5 text-sm text-rose-700 font-semibold">
          รายการที่สแกนไว้ในแผน {planNo} จำนวน {lineCount} รายการจะถูกล้างทั้งหมด
          และไม่สามารถกู้คืนกลับมาได้ — หากยังไม่บันทึก กรุณากดยืนยันการรับก่อนออก
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-12 px-4 rounded-xl bg-black/[.04] hover:bg-black/[.07] text-slate-700 font-bold text-sm transition-colors cursor-pointer"
          >
            ยกเลิก — สแกนต่อ
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className="flex-1 min-h-12 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-sm transition-colors cursor-pointer shadow-xs"
          >
            ออกและล้างรายการ
          </button>
        </div>
      </div>
    </div>
  );
}
