"use client";

import React from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";

export default function TransferHistoryPage() {
  const { user } = useTabAuth();
  const isAdmin = user?.role === "ADMIN";

  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-slate-800">เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น</h1>
          <p className="text-xs text-slate-500">คุณไม่มีสิทธิ์เข้าถึงหน้ารายงานประวัติการเบิกสินค้านี้</p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all"
        >
          กลับหน้าหลัก
        </Link>
      </div>
    );
  }
  return (
    <div className="max-w-4xl lg:max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 flex items-center justify-center shadow-xs">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                ประวัติเบิกสินค้า
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 font-normal">
                บันทึกและประวัติรายการเบิก-โอนย้ายสินค้าทั้งหมดในระบบ
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/movements/transfer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-xs transition-all cursor-pointer active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>ไปหน้าเบิกสินค้า</span>
          </Link>
        </div>
      </div>

      {/* Clean Placeholder Content Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-10 sm:p-16 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto text-slate-400">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>

        <div className="space-y-1.5 max-w-md mx-auto">
          <h2 className="text-base sm:text-lg font-bold text-slate-800">
            ยังไม่มีรายการประวัติเบิกสินค้า
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 font-normal leading-relaxed">
            หน้านี้เป็นหน้าว่างเตรียมพร้อมสำหรับการแสดงรายงานและตารางประวัติการเบิกสินค้าในระบบ
          </p>
        </div>
      </div>
    </div>
  );
}
