"use client";

import { Suspense } from "react";
import ReceiveWorkspace from "../../movements/receive/_components/ReceiveWorkspace";

export default function StaffReceivePage() {
  return (
    /* scale-original — หน้าพนักงานมือถือคงขนาด UI ดั้งเดิม (ไม่ขยายตามสเกลใหม่) */
    <div className="scale-original">
      <Suspense fallback={null}>
        <ReceiveWorkspace />
      </Suspense>
    </div>
  );
}
