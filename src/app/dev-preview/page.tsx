"use client";

// TEMPORARY preview route สำหรับดูธีม/shell นอกสาย auth (ข้อมูลเป็น 0 เพราะ API ต้อง login)
// จะลบออกเมื่อผู้ใช้ยืนยันธีมแล้ว

import Sidebar from "@/components/layout/Sidebar";
import DashboardHeader from "@/components/layout/Navbar";
import AdminDashboard from "@/app/(dashboard)/dashboard/_components/AdminDashboard";

export default function DevPreviewPage() {
  return (
    <div className="flex h-[100dvh] max-h-[100dvh] bg-[#EFF3F1] text-[#111827] overflow-hidden w-full max-w-full">
      <Sidebar role="ADMIN" userName="ผู้ดูแลระบบ" />
      <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden w-full max-w-full">
        <DashboardHeader
          user={{ name: "ผู้ดูแลระบบ", email: "admin@stockify.local", role: "ADMIN" }}
        />
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain overflow-x-hidden w-full max-w-full bg-[#EFF3F1]">
          <div className="mx-auto w-full px-4 py-6 md:px-6 md:py-8 xl:px-8">
            <AdminDashboard />
          </div>
        </main>
      </div>
    </div>
  );
}
