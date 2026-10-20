"use client";

import React from "react";

export interface MoveSuccessModalProps {
  onReset: () => void;
}

export default function MoveSuccessModal({ onReset }: MoveSuccessModalProps) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl p-10 text-center border border-[rgba(145,158,171,0.2)] shadow-m3-dropdown space-y-4">
        <div className="w-16 h-16 rounded-full bg-[rgba(0,167,111,0.16)] border border-[rgba(0,167,111,0.24)] flex items-center justify-center mx-auto text-m3-primary-darker shadow-md">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-m3-grey-800">จัดตำแหน่งสินค้าสำเร็จ!</h2>
        <div className="pt-4">
          <button
            type="button"
            onClick={onReset}
            className="px-8 py-4 bg-m3-primary hover:bg-m3-primary-darker text-white rounded-xl font-bold text-base shadow-m3-dropdown shadow-m3-primary/20 cursor-pointer active:scale-95 transition-all"
          >
            จัดตำแหน่งรายการถัดไป
          </button>
        </div>
      </div>
    </div>
  );
}
