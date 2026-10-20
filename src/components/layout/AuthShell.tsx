// โครงหน้าเข้าสู่ระบบ (D50/D51/M02) — แผงซ้ายตกแต่ง (≥lg) + ฟอร์มขวา · เฉพาะหน้าตา
import React, { type ReactNode } from "react";
import { StockifyLogo, SolarCheckCircle, SolarTagBarcode } from "@/components/icons";

function DecorPanel() {
  const bars = [10, 16, 12, 20, 18, 26, 22, 28];
  return (
    <aside aria-hidden="true" className="relative hidden w-[39%] max-w-[560px] shrink-0 flex-col bg-m3-grey-100 px-9 py-8 lg:flex">
      <StockifyLogo />
      <h2 className="mt-20 text-center font-m3-disp text-[28px] font-bold text-m3-grey-800">ระบบคลังสินค้า</h2>
      <div className="relative mx-auto mt-14 h-[230px] w-full max-w-[340px]">
        <div className="absolute left-0 top-0 w-[240px] rounded-2xl bg-white p-4 shadow-m3-card">
          <p className="text-[13px] font-semibold text-m3-grey-800">สินค้าคงเหลือ</p>
          <div className="mt-3 flex items-end justify-between">
            <span className="font-m3-disp text-[28px] font-bold text-m3-grey-800">48,215</span>
            <span className="flex items-end gap-1">
              {bars.map((h, i) => (
                <span key={i} className="w-1 rounded-full bg-m3-primary" style={{ height: h }} />
              ))}
            </span>
          </div>
        </div>
        <div className="absolute right-0 top-[96px] flex w-[210px] items-center gap-3 rounded-2xl bg-white p-3.5 shadow-m3-card">
          <span className="inline-flex size-9 items-center justify-center rounded-lg bg-[rgba(34,197,94,0.16)] text-m3-success">
            <SolarCheckCircle size={20} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-bold text-m3-grey-800">อนุมัติแล้ว</span>
            <span className="block truncate text-[11px] text-m3-grey-500">RCV-000142 · 1,060 ชิ้น</span>
          </span>
        </div>
        <div className="absolute bottom-0 left-8 flex w-[200px] items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 shadow-m3-card">
          <SolarTagBarcode size={18} className="text-m3-primary" />
          <span className="font-m3-disp text-[13px] font-bold text-m3-grey-800">1K14-1A</span>
          <span className="m3-label m3-label-success">+120</span>
        </div>
      </div>
    </aside>
  );
}

export default function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] w-full bg-white font-m3 text-m3-grey-800">
      <DecorPanel />
      <div className="flex min-w-0 flex-1 flex-col items-center px-5 py-8 sm:px-8">
        <div className="mb-8 lg:hidden">
          <StockifyLogo />
        </div>
        <div className="my-auto w-full max-w-[400px]">{children}</div>
        {footer ? <div className="mt-8 text-center text-xs text-m3-grey-500">{footer}</div> : null}
      </div>
    </div>
  );
}
