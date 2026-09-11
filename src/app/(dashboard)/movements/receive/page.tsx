
"use client";

import { Suspense } from "react";
import ReceiveWorkspace from "./_components/ReceiveWorkspace";

export default function ReceivePage() {
  return (
    <Suspense fallback={null}>
      <ReceiveWorkspace />
    </Suspense>
  );
}
