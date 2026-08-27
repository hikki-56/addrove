"use client";

import { useTabAuth } from "@/context/TabAuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import Navbar from "@/components/layout/Navbar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, status } = useTabAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("stockify_sidebar_collapsed");
    if (saved === "true") {
      setCollapsed(true);
    }
  }, []);

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("stockify_sidebar_collapsed", String(next));
      return next;
    });
  };

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
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className={`flex h-[100dvh] max-h-[100dvh] bg-[#f4f6f8] text-slate-900 overflow-hidden w-full max-w-full ${user.role === "ADMIN" ? "admin-shell" : ""}`}>
      <Sidebar
        role={user.role}
        userName={user.name ?? undefined}
        collapsed={collapsed}
        onToggle={toggleSidebar}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden w-full max-w-full">
        <Navbar
          user={user}
          onToggleSidebar={toggleSidebar}
          isSidebarCollapsed={collapsed}
        />
        <main
          className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain overflow-x-hidden px-3 pt-3 pb-36 sm:px-4 sm:pt-4 sm:pb-16 md:px-6 md:pt-6 md:pb-10 w-full max-w-full bg-[#f4f6f8]"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
