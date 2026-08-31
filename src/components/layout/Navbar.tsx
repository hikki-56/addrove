"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/types/models";
import { useTabAuth } from "@/context/TabAuthContext";
import { navItems, getNavItems } from "@/lib/nav-items";
import { getPendingTransferNotifications, getDisplayProductName, fetchAndSyncTransferNotifications } from "@/lib/transfer-notification-utils";
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

const roleColor: Record<UserRole, string> = {
  ADMIN: "bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold",
  MANAGER: "bg-purple-50 text-purple-700 border-purple-200 font-semibold",
  APPROVER: "bg-amber-50 text-amber-800 border-amber-200 font-semibold",
  WAREHOUSE_STAFF: "bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold",
  STAFF: "bg-blue-50 text-blue-700 border-blue-200 font-semibold",
  VIEWER: "bg-slate-100 text-slate-700 border-slate-200 font-medium",
};

const pathBreadcrumbs: Record<string, { parent: string; title: string }> = {
  "/dashboard": { parent: "หน้าหลัก", title: "ภาพรวมระบบ" },
  "/products": { parent: "คลังสินค้า", title: "สินค้าทั้งหมด" },
  "/products/new": { parent: "สินค้าทั้งหมด", title: "เพิ่มสินค้าใหม่" },
  "/approvals": { parent: "การจัดการ", title: "อนุมัติรายการรับเข้า" },
  "/express-import": { parent: "นำเข้า Express", title: "ภาพรวม" },
  "/express-import/receive": { parent: "นำเข้า Express", title: "รับสินค้า เข้า Express" },
  "/express-import/issue": { parent: "นำเข้า Express", title: "เบิกสินค้า เข้า Express" },
  "/stock": { parent: "คลังสินค้า", title: "ตรวจสอบสต็อก" },
  "/stock-counts": { parent: "การตรวจนับ", title: "ผลการตรวจนับสต็อก" },
  "/locations": { parent: "คลังสินค้า", title: "จัดการตำแหน่งจัดเก็บ" },
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

export default function Navbar({
  user: initialUser,
  onToggleSidebar,
  isSidebarCollapsed,
}: {
  user: { name: string; email: string; role: UserRole };
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
}) {
  const { user: tabUser, logout: tabLogout } = useTabAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingTransferCount, setPendingTransferCount] = useState(0);
  const pathname = usePathname();

  useEscapeKey(mobileOpen, () => setMobileOpen(false));

  const user = tabUser || initialUser;
  const isAdmin = user.role === "ADMIN";

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsList, setNotificationsList] = useState<any[]>([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { activeWhId } = useWarehouseData({ autoFetch: false });


  // Fetch transfer notifications for all users
  useEffect(() => {
    const updateCount = () => {
      const staffFilter = isAdmin ? undefined : user.name;
      const list = isAdmin
        ? getPendingTransferNotifications()
        : getPendingTransferNotifications(staffFilter, activeWhId);

      setPendingTransferCount(list.length);
      setNotificationsList(list);
    };
    updateCount();

    const fetchServerTransfers = () => {
      fetchAndSyncTransferNotifications().then(updateCount);
    };

    fetchServerTransfers();
    const interval = setInterval(fetchServerTransfers, 5000);

    const handleWhChange = () => {
      updateCount();
    };

    window.addEventListener("stockify-transfer-created", updateCount);
    window.addEventListener("stockify-transfer-updated", updateCount);
    window.addEventListener("stockify-warehouse-changed", handleWhChange);
    window.addEventListener("storage", updateCount);
    return () => {
      clearInterval(interval);
      window.removeEventListener("stockify-transfer-created", updateCount);
      window.removeEventListener("stockify-transfer-updated", updateCount);
      window.removeEventListener("stockify-warehouse-changed", handleWhChange);
      window.removeEventListener("storage", updateCount);
    };
  }, [isAdmin, user.name, activeWhId]);

  const breadcrumb = pathBreadcrumbs[pathname] || { parent: "หน้าหลัก", title: "Stockify" };

  const itemsForRole = getNavItems(user.role);
  const visibleItems = itemsForRole.filter(
    (item) => !item.roles || item.roles.includes(user.role)
  );

  return (
    <>
      {/* Top Header Navbar (Height 64px - Golden SaaS Standard) */}
      <header className="h-16 sm:h-18 bg-white border-b border-slate-200/90 flex items-center justify-between px-3 sm:px-4 md:px-6 flex-shrink-0 z-20 shadow-xs">
        {/* Left Side: Toggle Button + Logo (Staff) + Breadcrumbs (Admin) */}
        <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              id="btn-toggle-sidebar"
              className="hidden md:flex p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-all items-center justify-center cursor-pointer shadow-2xs"
              title={isSidebarCollapsed ? "เปิดเมนูข้าง" : "ปิดเมนูข้าง"}
              aria-label="สลับแถบเมนู"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}

          {/* Logo on Top Left (Staff Only) */}
          {!isAdmin && (
            <Link href="/dashboard" className="flex items-center gap-2 group shrink-0">
              <img
                src="/logo.png"
                alt="Stockify Logo"
                className="h-8 sm:h-9 w-auto object-contain max-w-[140px] sm:max-w-[200px] transition-transform duration-200 group-hover:scale-105"
              />
            </Link>
          )}

          {/* Admin Clean Breadcrumbs */}
          {isAdmin && (
            <div className="hidden sm:flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-700 truncate">
              <span className="text-slate-400 hover:text-slate-600 transition-colors">{breadcrumb.parent}</span>
              <span className="text-slate-300 font-normal">/</span>
              <span className="text-slate-900 font-semibold">{breadcrumb.title}</span>
            </div>
          )}
        </div>


        {/* Right Side: Role Controls, Notifications & User Profile Capsule */}
        <div className="flex items-center gap-2 sm:gap-3 relative shrink-0">


          {/* STAFF Specific Notification Bell */}
          {!isAdmin && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotificationsOpen(!notificationsOpen);
                  setUserMenuOpen(false);
                }}
                id="btn-notification-bell"
                className={`p-2 rounded-xl border transition-all cursor-pointer relative flex items-center justify-center ${
                  pendingTransferCount > 0
                    ? "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 shadow-2xs"
                    : "bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 border-slate-200"
                }`}
                title="การแจ้งเตือนงานเบิกสินค้า"
                aria-label="การแจ้งเตือนงานเบิกสินค้า"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>

                {pendingTransferCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-xs animate-pulse">
                    {pendingTransferCount}
                  </span>
                )}
              </button>

              {/* Staff Transfer Notification Dropdown */}
              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl z-50 p-3.5 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-900">🔔 การแจ้งเตือนงานเบิกสินค้า</span>
                      {pendingTransferCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
                          {pendingTransferCount}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setNotificationsOpen(false)}
                      className="text-xs text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  {notificationsList.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-500 space-y-0.5">
                      <p className="font-medium text-slate-600">ไม่มีรายการแจ้งเตือนค้างอยู่</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-0.5">
                      {notificationsList.map((t) => (
                        <Link
                          key={t.id}
                          href="/movements/transfer"
                          onClick={() => setNotificationsOpen(false)}
                          className="block p-2.5 rounded-xl bg-slate-50 hover:bg-emerald-50 border border-slate-200/80 hover:border-emerald-200 transition-all text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-slate-900 text-[11px]">
                              {t.doc_no || "TRF"}
                            </span>
                            <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                              {Number(t.qty || 0).toLocaleString()} ชิ้น
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] gap-2">
                            <span className="font-medium text-slate-800 truncate flex-1">
                              {getDisplayProductName(t)}
                            </span>
                            <span className="text-[10px] text-slate-500 shrink-0">
                              {t.from_warehouse_name} ➔ <strong className="text-emerald-700">{t.to_warehouse_name}</strong>
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* User Profile Avatar Capsule & Dropdown Menu (Admin Only) */}
          {isAdmin && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen);
                  setNotificationsOpen(false);
                }}
                id="btn-user-profile-menu"
                className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-xl border border-slate-200/80 bg-slate-50 hover:bg-slate-100 transition-all cursor-pointer shadow-2xs group"
                title={user.name}
              >
                <div className="relative w-7 h-7 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold flex items-center justify-center text-xs shadow-xs shrink-0">
                  {user.name ? user.name.charAt(0).toUpperCase() : "A"}
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-white" />
                </div>
                <span className="hidden sm:inline-block text-xs font-semibold text-slate-800 max-w-[130px] truncate">
                  {user.name}
                </span>
                <span className="hidden md:inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">
                  Admin
                </span>
                <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Role-Specific User Dropdown Menu */}
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-64 max-w-xs rounded-2xl bg-white border border-slate-200 shadow-xl z-50 p-3.5 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold flex items-center justify-center text-sm shadow-xs shrink-0">
                      {user.name ? user.name.charAt(0).toUpperCase() : "A"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h6 className="text-xs font-bold text-slate-950 truncate">{user.name}</h6>
                      <p className="text-[11px] font-medium text-slate-500 truncate">{user.email || "user@stockify.com"}</p>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] border ${roleColor[user.role]}`}>
                        {roleLabel[user.role]}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => tabLogout()}
                    className="w-full py-2 px-3 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 hover:border-rose-200 transition-all text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                  >
                    <svg className="w-4 h-4 text-slate-500 group-hover:text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    ออกจากระบบ
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Mobile Hamburger Menu Button */}
          <button
            id="btn-mobile-menu"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-xl text-slate-700 hover:text-slate-950 hover:bg-slate-100 border border-slate-200 transition-all flex items-center justify-center cursor-pointer"
            aria-label="เปิดเมนู"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile Drawer Navigation (Shared) */}
      <div
        className={`fixed inset-0 z-50 md:hidden transition-all duration-300 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
          onClick={() => setMobileOpen(false)}
        />

        <div
          className={`absolute right-0 top-0 w-72 max-w-[85vw] bg-white text-slate-900 h-full shadow-2xl border-l border-slate-200 flex flex-col z-10 transform transition-transform duration-300 ease-in-out ${
            mobileOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {/* Drawer Header */}
          <div className="flex items-center justify-between px-4 sm:px-5 h-16 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="A'AMAZON Logo" className="h-8 sm:h-9 w-auto object-contain max-w-[150px]" />
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* User Info Bar */}
          <div className="px-4 py-4 border-b border-slate-200">
            <div className="flex flex-col items-center justify-center text-center p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold flex items-center justify-center text-lg shadow-xs">
                {user.name?.charAt(0)?.toUpperCase() ?? "U"}
              </div>

              <p className="text-sm font-bold text-slate-900 tracking-tight pt-0.5">
                {user.name}
              </p>

              <div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] border ${roleColor[user.role]}`}>
                  {roleLabel[user.role]}
                </span>
              </div>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">เมนูหลัก</p>
            {visibleItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              const showBadge = item.href === "/movements/transfer" && pendingTransferCount > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 relative ${
                    isActive
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200/60"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={isActive ? "text-emerald-700 font-bold" : "text-slate-500"}>
                      {isAdmin ? item.icon : (item.staffIcon || item.icon)}
                    </span>
                    {item.label}
                  </div>
                  {showBadge && (
                    <span className="px-2 py-0.5 rounded-full bg-red-500 text-white font-bold text-xs shadow-xs animate-pulse">
                      {pendingTransferCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Drawer Footer */}
          <div className="p-3 border-t border-slate-200">
            <button
              onClick={() => tabLogout()}
              className="w-full py-2.5 rounded-xl bg-white hover:bg-rose-50 text-slate-700 border border-slate-200 hover:border-rose-200 hover:text-rose-700 transition-all text-xs font-semibold flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
