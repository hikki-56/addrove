"use client";

import React from "react";

export interface ReceiveSuccessCardProps {
  onReset: () => void;
}

export default function ReceiveSuccessCard({ onReset }: ReceiveSuccessCardProps) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="glass-card rounded-2xl p-10 text-center border border-white/10 shadow-2xl space-y-4">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-100">รับสินค้าเข้าคลังสำเร็จ</h2>
        <p className="text-slate-400 text-sm max-w-sm mx-auto">
          เอกสารรับสินค้าถูกสร้างและบันทึกเข้าสู่ระบบเรียบร้อยแล้ว
        </p>
        <div className="pt-4">
          <button
            type="button"
            onClick={onReset}
            className="px-8 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-semibold text-sm shadow-lg shadow-emerald-950/40 cursor-pointer active:scale-95 transition-all"
          >
            รับสินค้ารายการถัดไป
          </button>
        </div>
      </div>
    </div>
  );
}
