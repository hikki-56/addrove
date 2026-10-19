"use client";

import React from "react";
import { M3Banner } from "@/components/ui/m3";
import { SolarCheckCircle, SolarRefresh } from "@/components/icons";

export interface ReceiveSuccessCardProps {
  onReset: () => void;
}

export default function ReceiveSuccessCard({ onReset }: ReceiveSuccessCardProps) {
  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:py-12">
      <div className="m3-card scale-in space-y-6 p-8 text-center sm:p-10">
        <div className="mx-auto flex size-28 items-center justify-center rounded-full bg-[rgba(0,167,111,0.12)]">
          <div className="flex size-16 items-center justify-center rounded-full bg-m3-primary text-white">
            <SolarCheckCircle size={36} />
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-m3-grey-800">ส่งรายการรับสินค้าแล้ว</h2>
          <M3Banner tone="warning" className="mt-3 text-left">
            รออนุมัติ — ยังไม่เพิ่มสต็อก
          </M3Banner>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="m3-btn m3-btn-primary h-12 w-full gap-2 text-base shadow-[0_8px_16px_rgba(0,167,111,0.24)] active:scale-[.98]"
        >
          <SolarRefresh size={20} className="shrink-0" />
          <span>เริ่มรับรายการใหม่</span>
        </button>
      </div>
    </div>
  );
}
