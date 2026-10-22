"use client";

import { useTabAuth } from "@/context/TabAuthContext";
import dynamic from "next/dynamic";
import StaffDashboard from "./_components/StaffDashboard";

function DashboardLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-m3-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

const AdminDashboard = dynamic(() => import("./_components/AdminDashboard"), {
  loading: DashboardLoading,
});
const PackerDashboard = dynamic(() => import("./_components/PackerDashboard"), {
  loading: DashboardLoading,
});

export default function DashboardPage() {
  const { user, status } = useTabAuth();

  if (status === "loading") {
    return <DashboardLoading />;
  }

  const role = user?.role;

  if (role === "APPROVER") {
    if (typeof window !== "undefined") {
      window.location.replace("/movements/transfer");
    }
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-m3-warning border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // พนักงานแพ็กของมีหน้าหลักของตัวเอง — ไม่ใช้หน้าเดียวกับพนักงานคลัง
  if (role === "PACKER") {
    return <PackerDashboard />;
  }

  if (role === "WAREHOUSE_STAFF") {
    return <StaffDashboard />;
  }

  // ADMIN and VIEWER
  return <AdminDashboard />;
}
