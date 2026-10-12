
"use client";

import { Suspense } from "react";
import ReceiveWorkspace from "@/features/receive/components/ReceiveWorkspace";
import NavigationLoading from "@/components/ui/NavigationLoading";

export default function ReceivePage() {
  return (
    <Suspense fallback={<NavigationLoading />}>
      <ReceiveWorkspace />
    </Suspense>
  );
}
