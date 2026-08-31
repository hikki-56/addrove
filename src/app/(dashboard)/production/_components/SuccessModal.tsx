"use client";

import Link from "next/link";
import { useEscapeKey } from "@/hooks/use-escape-key";

interface SuccessModalProps {
  orderNo: string;
  onClose: () => void;
}

export default function SuccessModal({ orderNo, onClose }: SuccessModalProps) {
  useEscapeKey(true, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl border border-slate-200">
        <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl mx-auto shadow-xs">
          🎉
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-slate-900">บันทึกคำสั่งผลิตสำเร็จ!</h3>
          <p className="text-sm text-slate-600">
            เลขที่เอกสาร: <strong className="font-mono text-emerald-800 font-bold">{orderNo}</strong>
          </p>
          <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200 text-sm text-emerald-950 font-semibold text-left space-y-1.5 mt-2">
            <div className="font-bold text-emerald-950 flex items-center gap-1">
              <span>✓ การดำเนินการในโกดัง 2:</span>
            </div>
            <div>• เพิ่มสินค้าสำเร็จรูปเข้า <strong className="font-bold">โกดัง 2</strong> เรียบร้อยแล้ว</div>
            <div>• ตัดสต็อกวัตถุดิบออกจาก <strong className="font-bold">โกดัง 2</strong> เรียบร้อยแล้ว</div>
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <Link
            href="/production/history"
            className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/20 cursor-pointer active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <span>ดูประวัติการสั่งผลิต</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-all cursor-pointer border border-slate-200 active:scale-95"
          >
            สั่งผลิตรายการอื่นต่อ
          </button>
        </div>
      </div>
    </div>
  );
}
