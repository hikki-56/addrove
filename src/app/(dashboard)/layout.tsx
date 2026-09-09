"use client";

import { useTabAuth } from "@/context/TabAuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import DashboardHeader from "@/components/layout/Navbar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, status } = useTabAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && status === "unauthenticated") {
      if (typeof window !== "undefined") {
        const currentUrl = window.location.pathname + window.location.search;
        const urlParams = new URLSearchParams(window.location.search);
        const wh = urlParams.get("warehouse_id") || urlParams.get("wh");
        let loginUrl = `/employee-login?callbackUrl=${encodeURIComponent(currentUrl)}`;
        if (wh) {
          loginUrl += `&warehouse_id=${encodeURIComponent(wh)}`;
        }
        router.push(loginUrl);
      } else {
        router.push("/employee-login");
      }
    }
  }, [mounted, status, router]);

  if (!mounted || status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#EFF3F1]">
        <div className="w-10 h-10 border-3 border-[#06402B] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className={`flex h-[100dvh] max-h-[100dvh] bg-[#EFF3F1] text-[#111827] overflow-hidden w-full max-w-full ${user.role === "ADMIN" ? "admin-shell" : ""}`}>
      <Sidebar
        role={user.role}
        userName={user.name ?? undefined}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden w-full max-w-full">
        <DashboardHeader user={user} />
        <main
          className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain overflow-x-hidden w-full max-w-full bg-[#EFF3F1]"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="mx-auto w-full px-4 py-6 md:px-6 md:py-8 xl:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
