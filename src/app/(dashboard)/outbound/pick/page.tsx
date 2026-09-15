"use client";

import QPickingPanel from "./_components/QPickingPanel";

/**
 * หน้าหยิบของ — มีแค่ flow เดียว: สแกนกล่อง Q → เห็นรายการในกล่อง →
 * สแกนสินค้ายืนยันทีละชิ้น → หยิบครบ → ยืนยันไปขั้นตอนแพ็กของใส่กล่อง
 * (รายการที่จะหยิบถูกกำหนดล่วงหน้าโดย Admin ผ่านใบงานกล่อง Q เท่านั้น)
 */
export default function OutboundPickPage() {
  return (
    <div className="max-w-full pb-20 sm:pb-8 space-y-4">
      <h1 className="text-xl font-bold text-[#06402B] flex items-center gap-2">
        <span className="text-3xl">🎯</span> หยิบของ
      </h1>
      <QPickingPanel />
    </div>
  );
}
