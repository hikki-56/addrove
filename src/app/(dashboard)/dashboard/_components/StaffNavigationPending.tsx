"use client";

import { useLinkStatus } from "next/link";

export default function StaffNavigationPending() {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return (
    <span
      role="status"
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-3xl bg-white/95 text-[#06402B]"
    >
      <span
        aria-hidden="true"
        className="h-7 w-7 animate-spin rounded-full border-2 border-[#06402B] border-t-transparent"
      />
      <span className="text-sm font-semibold">กำลังเปิดหน้า…</span>
    </span>
  );
}
