"use client";

import { useTabAuth } from "@/context/TabAuthContext";
import AdminDashboard from "./_components/AdminDashboard";
import StaffDashboard from "./_components/StaffDashboard";

export default function DashboardPage() {
  const { user, status } = useTabAuth();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const role = user?.role;

  if (role === "WAREHOUSE_STAFF") {
    return <StaffDashboard />;
  }

  // ADMIN and VIEWER
  return <AdminDashboard />;
}
