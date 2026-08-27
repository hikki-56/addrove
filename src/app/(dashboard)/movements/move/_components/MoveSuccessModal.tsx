"use client";

import React from "react";

export interface MoveSuccessModalProps {
  onReset: () => void;
}

export default function MoveSuccessModal({ onReset }: MoveSuccessModalProps) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-3xl p-10 text-center border border-slate-200 shadow-xl space-y-4">
        <div className="w-16 h-16 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center mx-auto text-emerald-700 shadow-md">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">จัดตำแหน่งสินค้าสำเร็จ!</h2>
        <p className="text-slate-600 text-sm sm:text-base max-w-md mx-auto font-medium">
          ระบบได้อัปเดตตำแหน่งจัดเก็บสินค้าเข้าสู่ Google Sheets และฐานข้อมูลเรียบร้อยแล้ว
        </p>
        <div className="pt-4">
          <button
            type="button"
            onClick={onReset}
            className="px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-base shadow-lg shadow-emerald-600/20 cursor-pointer active:scale-95 transition-all"
          >
            จัดตำแหน่งรายการถัดไป
          </button>
        </div>
      </div>
    </div>
  );
}
