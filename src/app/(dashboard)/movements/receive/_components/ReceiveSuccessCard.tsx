"use client";

import React from "react";

export interface ReceiveSuccessCardProps {
  onReset: () => void;
}

export default function ReceiveSuccessCard({ onReset }: ReceiveSuccessCardProps) {
  return (
    <div className="max-w-md mx-auto py-6 sm:py-10 px-4">
      {/* Success Card with Soft Background */}
      <div className="bg-white rounded-[36px] p-8 sm:p-10 text-center border border-slate-100 shadow-xl shadow-slate-200/60 space-y-7 relative overflow-hidden">
        {/* Soft Ambient Background Elements */}
        <div className="absolute -top-12 -left-12 w-36 h-36 rounded-full bg-emerald-50/60 blur-xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 w-36 h-36 rounded-full bg-emerald-50/60 blur-xl pointer-events-none" />

        {/* Circular Checkmark Icon with Sparkles */}
        <div className="relative w-36 h-36 mx-auto flex items-center justify-center pt-2">
          {/* Outer Light Green Halo */}
          <div className="absolute inset-0 rounded-full bg-[#ecfdf5] scale-100" />

          {/* Decorative Plus / Sparkle Elements */}
          <span className="absolute top-3 right-6 text-emerald-400/80 font-bold text-sm select-none">+</span>
          <span className="absolute bottom-4 left-5 text-emerald-400/80 font-bold text-sm select-none">+</span>
          <span className="absolute top-8 left-3 w-2.5 h-2.5 rounded-full bg-emerald-300/70" />
          <span className="absolute bottom-6 right-4 w-3 h-3 rounded-full bg-emerald-300/70" />
          <span className="absolute top-2 left-14 w-2 h-2 rounded-full bg-emerald-400/60" />
          <span className="absolute bottom-2 right-12 text-[10px] text-emerald-300 font-black select-none">•</span>

          {/* Inner White Circle with Green Checkmark */}
          <div className="relative w-22 h-22 rounded-full bg-white shadow-lg shadow-emerald-600/10 border border-emerald-100/80 flex items-center justify-center">
            <svg className="w-11 h-11 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        {/* Title & Description */}
        <div className="space-y-2.5 pb-2">
          <h2 className="text-2xl sm:text-[28px] font-black text-slate-900 tracking-tight">
            รับสินค้าสำเร็จ
          </h2>
          <p className="text-slate-500 text-sm sm:text-base leading-relaxed">
            รายการรับสินค้าถูกส่งไปยัง <br />
            <strong className="text-emerald-700 font-bold">Admin</strong> เรียบร้อยแล้ว
          </p>
        </div>
      </div>
    </div>
  );
}
