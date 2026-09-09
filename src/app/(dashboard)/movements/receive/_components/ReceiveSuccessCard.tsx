"use client";

import React from "react";

export interface ReceiveSuccessCardProps {
  onReset: () => void;
  /** Server message describing what actually happened (e.g. "sent for approval") */
  successMessage?: string;
}

export default function ReceiveSuccessCard({ onReset, successMessage }: ReceiveSuccessCardProps) {
  return (
    <div className="max-w-md mx-auto py-6 sm:py-12 px-4">
      <div className="bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-8 sm:p-10 text-center space-y-6 scale-in">
        <div className="w-28 h-28 mx-auto rounded-full bg-[#EAF2EE] border border-[#DFEDE6] flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-[#06402B] flex items-center justify-center shadow-lg shadow-[#06402B]/25">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-extrabold text-[#111827] tracking-tight">
            ส่งรายการรับสินค้าแล้ว
          </h2>
          <p className="text-[#667085] text-sm sm:text-base">
            {successMessage || "ส่งรายการรับสินค้าไปรออนุมัติแล้ว"}
          </p>
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-left">
            <p className="text-amber-800 text-sm font-semibold flex items-start gap-2">
              <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>เอกสารอยู่สถานะ รออนุมัติ — ยอดสต็อกจะเข้าโกดังหลังผู้ดูแลอนุมัติเท่านั้น</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="w-full py-4 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-base shadow-lg shadow-[#06402B]/20 cursor-pointer transition-all active:scale-[.98] flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>เริ่มรับรายการใหม่</span>
        </button>
      </div>
    </div>
  );
}
