"use client";

import { useTabAuth } from "@/context/TabAuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import DashboardHeader from "@/components/layout/Navbar";
import { safeNavigate } from "@/client/safe-navigate";
import { MenuVisibilityProvider } from "@/context/MenuVisibilityContext";

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
        // ใช้ safeNavigate — redirect อัตโนมัติต้องไม่พังกลางคันเมื่อ router ยัง
        // initialize ไม่เสร็จ (คลิกเร็วก่อน hydration จบ / HMR ค้างใน dev)
        safeNavigate(router, loginUrl);
      } else {
        safeNavigate(router, "/employee-login");
      }
    }
  }, [mounted, status, router]);

  if (!mounted || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="size-10 animate-spin rounded-full border-[3px] border-m3-primary border-r-transparent" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <MenuVisibilityProvider>
    <div className={`flex h-[100dvh] max-h-[100dvh] bg-white text-m3-grey-800 overflow-hidden w-full max-w-full ${user.role === "ADMIN" ? "admin-shell" : ""}`}>
      <Sidebar
        role={user.role}
        userName={user.name ?? undefined}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden w-full max-w-full">
        <DashboardHeader user={user} />
        <main
          className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain w-full max-w-full m3-main"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {/* จอกว้างมาก (≥1536) จำกัดความกว้างเนื้อหาแล้วจัดกึ่งกลาง — การ์ด/ตารางไม่ถูกยืด
              จนดูโหว่ สัดส่วนคงกระชับ (cap 2200px ให้การ์ด 3 คอลัมน์กว้างขึ้นพอดีจอใหญ่) */}
          {/* Minimal UI v3b: เนื้อหาเว้นขอบ 40px บนเดสก์ท็อป (.main) · มือถือพื้นเทาอ่อน 16px */}
          <div className="mx-auto w-full max-w-full px-4 pt-4 pb-10 md:px-6 md:pt-2 xl:px-10 xl:pb-16 2xl:max-w-[2200px]">
            {children}
          </div>
        </main>
      </div>
    </div>
    </MenuVisibilityProvider>
  );
}
