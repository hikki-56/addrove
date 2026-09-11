"use client";

import { Suspense } from "react";
import ReceiveWorkspace from "../../movements/receive/_components/ReceiveWorkspace";

export default function StaffReceivePage() {
  return (
    <Suspense fallback={null}>
      <ReceiveWorkspace />
    </Suspense>
  );
}
