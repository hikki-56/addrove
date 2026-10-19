"use client";

import Link from "next/link";
import { SolarAltArrowRight, SolarBoxClosed, SolarBus, SolarCart } from "@/components/icons";

// หน้าหลักเฉพาะพนักงานแพ็กของ — มีเฉพาะงานสายส่งของออก: หยิบของ → แพ็กใส่กล่อง → ของขึ้นรถ
// แยกจาก StaffDashboard ของพนักงานคลังโดยสิ้นเชิง ห้ามแชร์ปุ่ม/หน้าร่วมกัน
// (ไม่แสดงหัวชื่อโกดัง — พนักงานแพ็กของไม่ผูกกับโกดังใดโกดังหนึ่ง)
// แถวปุ่ม Minimal v3 (M04) — ลิงก์/ลำดับเหมือนเดิม เปลี่ยนเฉพาะหน้าตา
const rowClass =
  "rise-in group relative w-full h-[104px] rounded-3xl bg-white border border-[rgba(145,158,171,0.12)] shadow-[0_8px_24px_rgba(145,158,171,0.2)] hover:shadow-m3-dropdown transition-all duration-200 active:scale-95 flex items-center gap-[18px] px-6 text-left cursor-pointer";
const iconTileClass =
  "size-16 rounded-[18px] flex items-center justify-center shrink-0 transition-transform group-hover:scale-110";

export default function PackerDashboard() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-start pt-2 sm:pt-4 pb-8 w-full">
      <div className="w-full max-w-md text-center">

        {/* 3 Centered Action Buttons */}
        <div className="flex flex-col gap-3.5 w-full">

          {/* ปุ่ม 1: หยิบของ */}
          <Link
            href="/outbound/pick"
            id="packer-btn-pick"
            className={rowClass}
            style={{ animationDelay: "90ms" }}
          >
            <span className={`${iconTileClass} bg-[rgba(0,167,111,0.12)] text-m3-primary`}>
              <SolarCart size={36} />
            </span>
            <h2 className="min-w-0 flex-1 text-[22px] font-extrabold text-m3-grey-800">หยิบของ</h2>
            <SolarAltArrowRight size={22} className="shrink-0 text-m3-grey-500" />
          </Link>

          {/* ปุ่ม 2: แพ็กใส่กล่อง */}
          <Link
            href="/outbound/pack"
            id="packer-btn-pack"
            className={rowClass}
            style={{ animationDelay: "180ms" }}
          >
            <span className={`${iconTileClass} bg-[rgba(0,184,217,0.12)] text-m3-info`}>
              <SolarBoxClosed size={36} />
            </span>
            <h2 className="min-w-0 flex-1 text-[22px] font-extrabold text-m3-grey-800">แพ็กใส่กล่อง</h2>
            <SolarAltArrowRight size={22} className="shrink-0 text-m3-grey-500" />
          </Link>

          {/* ปุ่ม 3: ของขึ้นรถ */}
          <Link
            href="/outbound/loading"
            id="packer-btn-loading"
            className={rowClass}
            style={{ animationDelay: "270ms" }}
          >
            <span className={`${iconTileClass} bg-[rgba(255,171,0,0.14)] text-m3-warning`}>
              <SolarBus size={36} />
            </span>
            <h2 className="min-w-0 flex-1 text-[22px] font-extrabold text-m3-grey-800">ของขึ้นรถ</h2>
            <SolarAltArrowRight size={22} className="shrink-0 text-m3-grey-500" />
          </Link>

        </div>
      </div>
    </div>
  );
}
