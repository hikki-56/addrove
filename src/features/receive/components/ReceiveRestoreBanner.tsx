"use client";

interface ReceiveRestoreBannerProps {
  lineCount: number;
  planNo?: string;
  onDiscard: () => void;
}

// แบนเนอร์แจ้งว่ารายการที่สแกนค้างไว้จาก session ก่อนถูกกู้คืนกลับมาแล้ว
// (ออกจากหน้า/รีเฟรช/ปิดแอปแล้วกลับเข้ามาใหม่ — ข้อมูลไม่หาย)
export default function ReceiveRestoreBanner({ lineCount, planNo, onDiscard }: ReceiveRestoreBannerProps) {
  return (
    <div className="p-4 rounded-2xl bg-[#EAF2EE] border border-[#C9DFD4] text-[#052B1F] shadow-xs flex items-start gap-3 fade-in">
      <svg className="w-5 h-5 text-[#053425] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold">
          กู้คืนรายการที่สแกนค้างไว้ {lineCount} รายการ{planNo ? ` (จากแผน ${planNo})` : ""}
        </p>
        <p className="mt-0.5 text-xs font-semibold text-[#0A4A34]">
          ออกจากหน้าไปแล้วกลับมาใหม่ — รายการยังอยู่ครบ สแกนต่อได้เลย หรือกด &quot;เริ่มใหม่&quot; หากไม่ต้องการรายการเดิม
        </p>
      </div>
      <button
        type="button"
        onClick={onDiscard}
        className="shrink-0 min-h-10 px-3.5 rounded-xl bg-white hover:bg-[#F1F7F3] border border-[#C9DFD4] text-[#052B1F] font-bold text-sm transition-colors cursor-pointer"
      >
        เริ่มใหม่
      </button>
    </div>
  );
}
