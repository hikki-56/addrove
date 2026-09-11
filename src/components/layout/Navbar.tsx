"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { UserRole } from "@/types/models";
import { useTabAuth } from "@/context/TabAuthContext";
import { getNavItems, isSystemMenuUser, SYSTEM_MENU_HREFS } from "@/lib/nav-items";
import { getPendingTransferNotifications, getDisplayProductName } from "@/lib/transfer-notification-utils";
import { subscribeTransferSync } from "@/lib/transfer-sync-scheduler";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import { useEscapeKey } from "@/hooks/use-escape-key";

const roleLabel: Record<UserRole, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการคลัง",
  APPROVER: "ผู้อนุมัติ",
  WAREHOUSE_STAFF: "พนักงานคลัง",
  STAFF: "เจ้าหน้าที่",
  VIEWER: "ผู้ดูข้อมูล",
};

const pathTitles: Record<string, { parent: string; title: string }> = {
  "/dashboard": { parent: "หน้าหลัก", title: "ภาพรวมระบบ" },
  "/products": { parent: "คลังสินค้า", title: "สินค้าทั้งหมด" },
  "/products/new": { parent: "สินค้าทั้งหมด", title: "เพิ่มสินค้าใหม่" },
  "/approvals": { parent: "การจัดการ", title: "อนุมัติรายการรับเข้า" },
  "/express-import": { parent: "นำเข้า Express", title: "ภาพรวม" },
  "/express-import/receive": { parent: "นำเข้า Express", title: "รับสินค้า เข้า Express" },
  "/express-import/issue": { parent: "นำเข้า Express", title: "เบิกสินค้า เข้า Express" },
  "/stock": { parent: "คลังสินค้า", title: "ตรวจสอบสต็อก" },
  "/stock-counts": { parent: "การตรวจนับ", title: "ผลการตรวจนับสต็อก" },
  "/locations": { parent: "คลังสินค้า", title: "ตำแหน่งสินค้าในโกดัง" },
  "/movements/receive": { parent: "การเคลื่อนไหว", title: "รับสินค้าเข้า (Admin)" },
  "/movements/receive/history": { parent: "การเคลื่อนไหว", title: "ประวัติรับสินค้าเข้าโกดัง" },
  "/production": { parent: "การเคลื่อนไหว", title: "ผลิตสินค้า" },
  "/production/history": { parent: "การเคลื่อนไหว", title: "ประวัติการสั่งผลิต" },
  "/movements/transfer": { parent: "การเคลื่อนไหว", title: "เบิกสินค้า (Admin)" },
  "/movements/transfer/history": { parent: "การเคลื่อนไหว", title: "ประวัติเบิกสินค้า" },
  "/movements/move": { parent: "การเคลื่อนไหว", title: "ย้ายตำแหน่งสินค้า (Admin)" },
  "/staff/receive": { parent: "พนักงาน", title: "สแกนรับสินค้าเข้าคลัง" },
  "/staff/transfer": { parent: "พนักงาน", title: "รายการที่ต้องไปเบิกสินค้า" },
  "/staff/move": { parent: "พนักงาน", title: "สแกนจัดตำแหน่งสินค้า" },
  "/movements/history": { parent: "การเคลื่อนไหว", title: "ประวัติการเคลื่อนไหว" },
  "/users": { parent: "การตั้งค่า", title: "จัดการพนักงาน" },
  "/login-logs": { parent: "การแจ้งเตือน", title: "ประวัติการเข้าระบบ" },
};

function SearchIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

export default function DashboardHeader({
  user,
}: {
  user: { name: string; email: string; role: UserRole };
}) {
  const { logout: tabLogout } = useTabAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [pendingTransferCount, setPendingTransferCount] = useState(0);
  const [notificationsList, setNotificationsList] = useState<any[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const { activeWhId } = useWarehouseData({ autoFetch: false });

  const isAdmin = user.role === "ADMIN";

  useEscapeKey(mobileOpen, () => setMobileOpen(false));

  // แจ้งเตือนงานเบิกสินค้า (พนักงาน/ทุกบทบาทที่ไม่ใช่แอดมิน)
  useEffect(() => {
    const updateCount = () => {
      const staffFilter = isAdmin ? undefined : user.name;
      const list = isAdmin
        ? []
        : getPendingTransferNotifications(staffFilter, activeWhId);
      setPendingTransferCount(list.length);
      setNotificationsList(list);
    };
    updateCount();
    const unsubscribeSync = subscribeTransferSync(updateCount);
    window.addEventListener("stockify-transfer-created", updateCount);
    window.addEventListener("stockify-transfer-updated", updateCount);
    window.addEventListener("stockify-warehouse-changed", updateCount);
    window.addEventListener("storage", updateCount);
    return () => {
      unsubscribeSync();
      window.removeEventListener("stockify-transfer-created", updateCount);
      window.removeEventListener("stockify-transfer-updated", updateCount);
      window.removeEventListener("stockify-warehouse-changed", updateCount);
      window.removeEventListener("storage", updateCount);
    };
  }, [isAdmin, user.name, activeWhId]);

  // จำนวนรออนุมัติสำหรับแอดมิน — รับค่าจาก Sidebar (โพลล์อยู่แล้ว) หรือดึงเองถ้ายังไม่มี
  useEffect(() => {
    if (!isAdmin) return;
    const handler = (e: Event) => {
      const count = (e as CustomEvent).detail;
      if (typeof count === "number") setPendingApprovalCount(count);
    };
    window.addEventListener("stockify-pending-approvals", handler);
    fetch(`/api/approvals?status=PENDING`, { cache: "no-store" })
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setPendingApprovalCount(res.data.length);
      })
      .catch(() => {});
    return () => window.removeEventListener("stockify-pending-approvals", handler);
  }, [isAdmin]);

  const breadcrumb = pathTitles[pathname] ||
    (pathname.startsWith("/products/") && pathname !== "/products/new"
      ? { parent: "สินค้าทั้งหมด", title: "รายละเอียดสินค้า" }
      : { parent: "Stockify", title: "ภาพรวม" });

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    router.push(q ? `/products?q=${encodeURIComponent(q)}` : "/products");
    setMobileOpen(false);
  };

  const itemsForRole = getNavItems(user.role);
  const systemMenuVisible = isSystemMenuUser(user.email);
  const visibleItems = itemsForRole.filter(
    (item) =>
      (!item.roles || item.roles.includes(user.role)) &&
      (systemMenuVisible || !SYSTEM_MENU_HREFS.includes(item.href))
  );

  const headerNotificationCount = isAdmin ? pendingApprovalCount : pendingTransferCount;

  return (
    <>
      <header className="bg-white border-b border-[#E8ECEA] flex-shrink-0 z-20 md:h-(--header-height)">
        {/* Mobile */}
        <div className="flex h-(--header-height) items-center justify-between gap-3 px-4 md:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <button
              id="btn-mobile-menu"
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-2 -ml-2 rounded-xl text-[#344054] hover:text-[#111827] hover:bg-[#F3F6F4] border border-transparent hover:border-[#E8ECEA] transition-colors duration-150 flex items-center justify-center cursor-pointer"
              aria-label="เปิดเมนู"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-[#111827] truncate text-lg font-semibold tracking-tight">
              {breadcrumb.title}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Notification */}
            <div className="relative">
              {isAdmin ? (
                <Link
                  href="/approvals"
                  aria-label="รายการรออนุมัติ"
                  title="รายการรออนุมัติ"
                  className="relative grid size-9 place-items-center rounded-xl border border-[#E8ECEA] bg-white text-[#667085] hover:bg-[#F3F6F4] hover:text-[#111827] transition-colors duration-150"
                >
                  <svg className="size-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {headerNotificationCount > 0 && (
                    <span className="absolute top-2 right-2.5 size-1.5 rounded-full bg-[#06402B]" />
                  )}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsOpen(!notificationsOpen);
                    setUserMenuOpen(false);
                  }}
                  aria-label="การแจ้งเตือนงานเบิกสินค้า"
                  className="relative grid size-9 place-items-center rounded-xl border border-[#E8ECEA] bg-white text-[#667085] hover:bg-[#F3F6F4] hover:text-[#111827] transition-colors duration-150 cursor-pointer"
                >
                  <svg className="size-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {pendingTransferCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#B42318] px-1 text-[10px] font-bold text-white">
                      {pendingTransferCount}
                    </span>
                  )}
                </button>
              )}
            </div>
            {/* Avatar */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen);
                  setNotificationsOpen(false);
                }}
                aria-label="เมนูผู้ใช้"
                className="grid size-9 place-items-center rounded-full bg-[#EAF2EE] border border-[#DFEDE6] text-sm font-bold text-[#06402B] cursor-pointer"
              >
                {user.name ? user.name.charAt(0).toUpperCase() : "U"}
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl bg-white border border-[#E8ECEA] shadow-[0_8px_24px_rgba(16,24,40,0.12)] z-50 p-3.5 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center gap-3 border-b border-[#EEF1EF] pb-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[#06402B] text-sm font-bold text-white">
                      {user.name ? user.name.charAt(0).toUpperCase() : "U"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h6 className="truncate text-xs font-bold text-[#111827]">{user.name}</h6>
                      <p className="truncate text-[11px] font-medium text-[#667085]">{user.email || "user@stockify.com"}</p>
                      <span className="mt-1 inline-block rounded-full border border-[#DFEDE6] bg-[#EAF2EE] px-2 py-0.5 text-[10px] font-semibold text-[#053425]">
                        {roleLabel[user.role]}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => tabLogout()}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#E8ECEA] bg-white px-3 py-2 text-xs font-semibold text-[#344054] transition-colors duration-150 hover:border-[#F5D6D2] hover:bg-[#FCEFED] hover:text-[#B42318]"
                  >
                    <svg className="h-4 w-4 text-[#667085]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    ออกจากระบบ
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile: search อยู่ใต้ header */}
        <form onSubmit={submitSearch} className="px-4 pb-3 md:hidden">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#98A2B3]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาสินค้า, เอกสาร…"
              className="h-10 w-full rounded-xl border border-[#E8ECEA] bg-white pl-9 pr-3 text-sm text-[#111827] placeholder:text-[#98A2B3] outline-none transition-shadow duration-150 focus:border-[#06402B] focus:shadow-[0_0_0_3px_rgba(6,64,43,0.10)]"
            />
          </div>
        </form>

        {/* Tablet / Desktop */}
        <div className="hidden h-(--header-height) items-center justify-between gap-6 px-6 md:flex xl:px-8">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-[#111827]">
              {breadcrumb.title}
            </h1>
            <p className="truncate text-sm text-[#667085]">{breadcrumb.parent}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <form onSubmit={submitSearch} className="relative w-64 xl:w-72">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#98A2B3]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาสินค้า, เอกสาร…"
                className="h-9 w-full rounded-xl border border-[#E8ECEA] bg-white pl-9 pr-12 text-sm text-[#111827] placeholder:text-[#98A2B3] outline-none transition-shadow duration-150 focus:border-[#06402B] focus:shadow-[0_0_0_3px_rgba(6,64,43,0.10)]"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-[#E8ECEA] bg-[#EFF3F1] px-1.5 py-0.5 text-[10px] font-medium text-[#98A2B3] lg:block">
                ⏎
              </kbd>
            </form>

            {/* Notification */}
            <div className="relative">
              {isAdmin ? (
                <Link
                  href="/approvals"
                  aria-label="รายการรออนุมัติ"
                  title="รายการรออนุมัติ"
                  className="relative grid size-9 place-items-center rounded-xl border border-[#E8ECEA] bg-white text-[#667085] hover:bg-[#F3F6F4] hover:text-[#111827] transition-colors duration-150"
                >
                  <svg className="size-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {headerNotificationCount > 0 && (
                    <span className="absolute top-2 right-2.5 size-1.5 rounded-full bg-[#06402B]" />
                  )}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsOpen(!notificationsOpen);
                    setUserMenuOpen(false);
                  }}
                  aria-label="การแจ้งเตือนงานเบิกสินค้า"
                  className={`relative grid size-9 place-items-center rounded-xl border transition-colors duration-150 cursor-pointer ${
                    pendingTransferCount > 0
                      ? "border-[#F1DECB] bg-[#FDF4EC] text-[#B54708] hover:bg-[#FCEFDD]"
                      : "border-[#E8ECEA] bg-white text-[#667085] hover:bg-[#F3F6F4] hover:text-[#111827]"
                  }`}
                >
                  <svg className="size-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {pendingTransferCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#B42318] px-1 text-[10px] font-bold text-white">
                      {pendingTransferCount}
                    </span>
                  )}
                </button>
              )}

              {/* Staff notification dropdown */}
              {notificationsOpen && !isAdmin && (
                <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-sm rounded-2xl bg-white border border-[#E8ECEA] shadow-[0_8px_24px_rgba(16,24,40,0.12)] z-50 p-3.5 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-[#EEF1EF] pb-2">
                    <span className="text-xs font-bold text-[#111827]">การแจ้งเตือนงานเบิกสินค้า</span>
                    <button
                      onClick={() => setNotificationsOpen(false)}
                      className="cursor-pointer p-0.5 text-xs font-bold text-[#98A2B3] hover:text-[#344054]"
                    >
                      ✕
                    </button>
                  </div>
                  {notificationsList.length === 0 ? (
                    <div className="py-4 text-center text-xs text-[#667085]">
                      <p className="font-medium text-[#344054]">ไม่มีรายการแจ้งเตือนค้างอยู่</p>
                    </div>
                  ) : (
                    <div className="max-h-60 space-y-1.5 overflow-y-auto pr-0.5">
                      {notificationsList.map((t) => (
                        <Link
                          key={t.id}
                          href="/movements/transfer"
                          onClick={() => setNotificationsOpen(false)}
                          className="block space-y-1 rounded-xl border border-[#E8ECEA] bg-white p-2.5 text-xs transition-colors duration-150 hover:border-[#D5DDD9] hover:bg-[#F3F6F4]"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[11px] font-bold text-[#111827]">
                              {t.doc_no || "TRF"}
                            </span>
                            <span className="rounded bg-[#FDF4EC] px-1.5 py-0.2 text-[10px] font-bold text-[#B54708]">
                              {Number(t.qty || 0).toLocaleString()} ชิ้น
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex-1 truncate font-medium text-[#344054]">
                              {getDisplayProductName(t)}
                            </span>
                            <span className="shrink-0 text-[10px] text-[#667085]">
                              {t.from_warehouse_name} ➔ <strong className="text-[#06402B]">{t.to_warehouse_name}</strong>
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Avatar */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen);
                  setNotificationsOpen(false);
                }}
                aria-label="เมนูผู้ใช้"
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-[#E8ECEA] bg-white py-1 pl-1.5 pr-2.5 transition-colors duration-150 hover:bg-[#F3F6F4]"
              >
                <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-[#06402B] text-xs font-bold text-white">
                  {user.name ? user.name.charAt(0).toUpperCase() : "U"}
                  <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-[#12B76A] ring-2 ring-white" />
                </span>
                <svg className="size-3.5 text-[#98A2B3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 max-w-xs rounded-2xl bg-white border border-[#E8ECEA] shadow-[0_8px_24px_rgba(16,24,40,0.12)] z-50 p-3.5 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center gap-3 border-b border-[#EEF1EF] pb-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[#06402B] text-sm font-bold text-white">
                      {user.name ? user.name.charAt(0).toUpperCase() : "U"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h6 className="truncate text-xs font-bold text-[#111827]">{user.name}</h6>
                      <p className="truncate text-[11px] font-medium text-[#667085]">{user.email || "user@stockify.com"}</p>
                      <span className="mt-1 inline-block rounded-full border border-[#DFEDE6] bg-[#EAF2EE] px-2 py-0.5 text-[10px] font-semibold text-[#053425]">
                        {roleLabel[user.role]}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => tabLogout()}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#E8ECEA] bg-white px-3 py-2 text-xs font-semibold text-[#344054] transition-colors duration-150 hover:border-[#F5D6D2] hover:bg-[#FCEFED] hover:text-[#B42318]"
                  >
                    <svg className="h-4 w-4 text-[#667085]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    ออกจากระบบ
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer (ซ้าย) */}
      <div
        className={`fixed inset-0 z-50 md:hidden transition-all duration-300 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="fixed inset-0 bg-[#101828]/40" onClick={() => setMobileOpen(false)} />
        <div
          className={`absolute left-0 top-0 h-full w-[280px] max-w-[85vw] bg-(--sidebar-surface) text-(--sidebar-text) shadow-[0_8px_32px_rgba(16,24,40,0.24)] border-r border-(--sidebar-edge) flex flex-col z-10 transform transition-transform duration-300 ease-in-out ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-(--header-height) items-center justify-between border-b border-(--sidebar-divider) px-4">
            <img src="/logo.png" alt="Stockify" className="h-10 w-auto object-contain max-w-[180px]" />
            <button
              onClick={() => setMobileOpen(false)}
              className="rounded-lg p-1.5 text-(--sidebar-text) transition-colors duration-150 hover:bg-(--sidebar-item-bg-hover) hover:text-(--sidebar-text-hover)"
              aria-label="ปิดเมนู"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-(--sidebar-text-muted)">เมนู</p>
            {visibleItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`sidebar-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors duration-150 ${
                    isActive ? "is-active font-semibold" : "font-medium"
                  }`}
                >
                  <span className="nav-icon shrink-0">
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-(--sidebar-divider) p-3">
            <button
              onClick={() => tabLogout()}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#DFEDE6] bg-[#EAF2EE] py-2.5 text-sm font-semibold text-[#06402B] transition-colors duration-150 hover:border-[#F5D6D2] hover:bg-[#FCEFED] hover:text-[#B42318]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              ออกจากระบบ
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
