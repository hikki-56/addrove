"use client";

import Link from "next/link";

// หน้าหลักเฉพาะพนักงานแพ็กของ — มีเฉพาะงานสายส่งของออก: หยิบของ → แพ็กใส่กล่อง → ของขึ้นรถ
// แยกจาก StaffDashboard ของพนักงานคลังโดยสิ้นเชิง ห้ามแชร์ปุ่ม/หน้าร่วมกัน
// (ไม่แสดงหัวชื่อโกดัง — พนักงานแพ็กของไม่ผูกกับโกดังใดโกดังหนึ่ง)
export default function PackerDashboard() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-start pt-3 sm:pt-4 pb-8 px-4 w-full">
      <div className="w-full max-w-md space-y-5 text-center">

        {/* 3 Centered Action Buttons */}
        <div className="flex flex-col gap-4 w-full pt-2">

          {/* ปุ่ม 1: หยิบของ */}
          <Link
            href="/outbound/pick"
            id="packer-btn-pick"
            className="rise-in group relative w-full rounded-3xl p-4 sm:p-5 bg-white border border-[#E8ECEA]/90 hover:border-[#0F5C3F]/50 shadow-md hover:shadow-xl transition-all duration-200 active:scale-95 flex items-center gap-4 text-left cursor-pointer"
            style={{ animationDelay: "90ms" }}
          >
            <div className="w-14 h-14 rounded-2xl bg-[#EAF2EE] border border-[#DFEDE6] p-3 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform text-[#06402B]">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} cx="12" cy="12" r="8" />
                <circle strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} cx="12" cy="12" r="3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m12 2v3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m12 19v3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m2 12h3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m19 12h3" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 group-hover:text-[#06402B] transition-colors">
                หยิบของ
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">หยิบสินค้าตามบิล</p>
            </div>
          </Link>

          {/* ปุ่ม 2: แพ็กใส่กล่อง */}
          <Link
            href="/outbound/pack"
            id="packer-btn-pack"
            className="rise-in group relative w-full rounded-3xl p-4 sm:p-5 bg-white border border-[#E8ECEA]/90 hover:border-sky-500/50 shadow-md hover:shadow-xl transition-all duration-200 active:scale-95 flex items-center gap-4 text-left cursor-pointer"
            style={{ animationDelay: "180ms" }}
          >
            <div className="w-14 h-14 rounded-2xl bg-sky-50 border border-sky-100 p-3 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform text-sky-700">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 22V12" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m3.3 7 8.7 5 8.7-5" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 group-hover:text-sky-600 transition-colors">
                แพ็กใส่กล่อง
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">แพ็กสินค้าลงกล่อง</p>
            </div>
          </Link>

          {/* ปุ่ม 3: ของขึ้นรถ */}
          <Link
            href="/outbound/loading"
            id="packer-btn-loading"
            className="rise-in group relative w-full rounded-3xl p-4 sm:p-5 bg-white border border-[#E8ECEA]/90 hover:border-amber-500/50 shadow-md hover:shadow-xl transition-all duration-200 active:scale-95 flex items-center gap-4 text-left cursor-pointer"
            style={{ animationDelay: "270ms" }}
          >
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 p-3 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform text-amber-600">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 18h-5" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35a1 1 0 0 0-.78-.38H16" />
                <circle strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} cx="7" cy="18" r="2" />
                <circle strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} cx="17" cy="18" r="2" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 group-hover:text-amber-600 transition-colors">
                ของขึ้นรถ
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">ตรวจนับและขึ้นรถส่ง</p>
            </div>
          </Link>

        </div>
      </div>
    </div>
  );
}
