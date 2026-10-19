"use client";

import { M3Banner } from "@/components/ui/m3";

interface ReceiveRestoreBannerProps {
  lineCount: number;
  planNo?: string;
  onDiscard: () => void;
}

// แบนเนอร์แจ้งว่ารายการที่สแกนค้างไว้จาก session ก่อนถูกกู้คืนกลับมาแล้ว
// (ออกจากหน้า/รีเฟรช/ปิดแอปแล้วกลับเข้ามาใหม่ — ข้อมูลไม่หาย)
export default function ReceiveRestoreBanner({ lineCount, planNo, onDiscard }: ReceiveRestoreBannerProps) {
  return (
    <M3Banner
      tone="info"
      className="fade-in"
      action={
        <button type="button" onClick={onDiscard} className="m3-btn m3-btn-sm m3-btn-outline shrink-0 bg-white">
          เริ่มใหม่
        </button>
      }
    >
      กู้คืนรายการที่สแกนค้างไว้ {lineCount} รายการ{planNo ? ` (จากแผน ${planNo})` : ""}
    </M3Banner>
  );
}
