"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { UserRole } from "@/types/models";
import { useTabAuth } from "@/context/TabAuthContext";
import { navItems, getNavItems } from "@/lib/nav-items";
import { getPendingTransferNotifications, getDisplayProductName, syncServerTransferNotifications, fetchAndSyncTransferNotifications } from "@/lib/transfer-notification-utils";
import { getActiveWarehouse, getWarehouseName } from "@/lib/warehouse-utils";

const roleLabel: Record<UserRole, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการคลัง",
  APPROVER: "ผู้อนุมัติ",
  WAREHOUSE_STAFF: "พนักงานคลัง",
  STAFF: "เจ้าหน้าที่",
  VIEWER: "ผู้ดูข้อมูล",
};

const roleColor: Record<UserRole, string> = {
  ADMIN: "bg-emerald-100 text-emerald-950 border-emerald-300 font-extrabold",
  MANAGER: "bg-purple-100 text-purple-950 border-purple-300 font-bold",
  APPROVER: "bg-amber-100 text-amber-950 border-amber-300 font-extrabold",
  WAREHOUSE_STAFF: "bg-indigo-100 text-indigo-950 border-indigo-300 font-bold",
  STAFF: "bg-blue-100 text-blue-950 border-blue-300 font-bold",
  VIEWER: "bg-slate-100 text-slate-800 border-slate-300 font-semibold",
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
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const pathname = usePathname();

  const user = tabUser || initialUser;
  const isAdmin = user.role === "ADMIN";

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsList, setNotificationsList] = useState<any[]>([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [staffWhName, setStaffWhName] = useState("");
  const [activeWhId, setActiveWhId] = useState("wh-01");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const activeWh = getActiveWarehouse();
      setActiveWhId(activeWh);
      setStaffWhName(getWarehouseName(activeWh));
    }
  }, []);

  // Fetch pending approval count for Admin
  useEffect(() => {
    if (isAdmin) {
      const fetchPendingApprovals = () => {
        fetch(`/api/approvals?status=PENDING&_t=${Date.now()}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((res) => {
            if (res.success && Array.isArray(res.data)) {
              setPendingApprovalCount(res.data.length);
            }
          })
          .catch(() => {});
      };
      fetchPendingApprovals();
      const interval = setInterval(fetchPendingApprovals, 20000);
      return () => clearInterval(interval);
    }
  }, [isAdmin]);

  // Fetch transfer notifications for all users
  useEffect(() => {
    const updateCount = () => {
      const activeWh = getActiveWarehouse();
      setActiveWhId(activeWh);
      setStaffWhName(getWarehouseName(activeWh));

      const staffFilter = isAdmin ? undefined : user.name;
      const list = isAdmin
        ? getPendingTransferNotifications()
        : getPendingTransferNotifications(staffFilter, activeWh);

      setPendingTransferCount(list.length);
      setNotificationsList(list);
    };
    updateCount();

    const fetchServerTransfers = () => {
      fetchAndSyncTransferNotifications().then(updateCount);
    };

    fetchServerTransfers();
    const interval = setInterval(fetchServerTransfers, 5000);

    const handleWhChange = (e: any) => {
      const newWh = e.detail?.warehouseId || getActiveWarehouse();
      setActiveWhId(newWh);
      setStaffWhName(getWarehouseName(newWh));
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
  }, [isAdmin, user.name]);

  const breadcrumb = pathBreadcrumbs[pathname] || { parent: "หน้าหลัก", title: "Stockify" };

  const itemsForRole = getNavItems(user.role);
  const visibleItems = itemsForRole.filter(
    (item) => !item.roles || item.roles.includes(user.role)
  );

  return (
    <>
      {/* Top Header Navbar (Original White Theme) */}
      <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 flex-shrink-0 z-20 shadow-xs">

        {/* Left Side: Desktop 3-Lines Toggle + Logo + Breadcrumbs */}
        <div className="flex items-center gap-3">
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              id="btn-toggle-sidebar"
              className="hidden md:flex p-2 rounded-xl text-slate-700 hover:text-slate-950 hover:bg-slate-100 border border-slate-200 transition-all items-center justify-center cursor-pointer shadow-2xs"
              title={isSidebarCollapsed ? "เปิดเมนูข้าง" : "ปิดเมนูข้าง"}
              aria-label="สลับแถบเมนู"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}

          {/* Logo on Top Left (Staff Only) */}
          {!isAdmin && (
            <Link href="/dashboard" className="flex items-center gap-2 group shrink-0">
              <img
                src="/logo.png"
                alt="Stockify Logo"
                className="h-11 md:h-13 w-auto object-contain max-w-[220px] sm:max-w-[280px] transition-transform group-hover:scale-105"
              />
            </Link>
          )}

          {isAdmin && (
            <div className="hidden sm:flex items-center gap-2 text-xs md:text-sm font-bold text-slate-800">
              <span className="text-slate-500 font-medium">{breadcrumb.parent}</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-900 font-black">{breadcrumb.title}</span>
            </div>
          )}
        </div>

        {/* Right Side: Role-Specific Action Controls & User Profile Dropdown */}
        <div className="flex items-center gap-2.5 relative">



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
                    ? "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 shadow-xs"
                    : "bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-950 border-slate-200"
                }`}
                title="การแจ้งเตือนงานเบิกสินค้า"
                aria-label="การแจ้งเตือนงานเบิกสินค้า"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>

                {pendingTransferCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-xs animate-pulse">
                    {pendingTransferCount}
                  </span>
                )}
              </button>

              {/* Staff Transfer Notification Dropdown */}
              {notificationsOpen && (
                <div className="absolute -right-4 sm:right-0 mt-2 w-72 sm:w-80 rounded-2xl bg-white border border-slate-200 shadow-xl z-50 p-3.5 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black text-slate-900">🔔 การแจ้งเตือนงานเบิกสินค้า</span>
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
                      <p className="font-semibold text-slate-700">ไม่มีรายการแจ้งเตือนค้างอยู่</p>
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
                              {t.qty} ชิ้น
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] gap-2">
                            <span className="font-semibold text-slate-800 truncate flex-1">
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

          {/* User Profile Avatar Button & Dropdown Menu (Admin Only) */}
          {isAdmin && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen);
                  setNotificationsOpen(false);
                }}
                id="btn-user-profile-menu"
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-all cursor-pointer shadow-2xs"
                title={user.name}
              >
                <div className="w-7 h-7 rounded-full bg-emerald-500 text-white font-black flex items-center justify-center text-xs shadow-xs shrink-0">
                  👑
                </div>
                <span className="hidden sm:inline-block text-xs font-bold text-slate-800 max-w-[130px] truncate">
                  {user.name}
                </span>
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Role-Specific User Dropdown Menu */}
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white border border-slate-200 shadow-xl z-50 p-3.5 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-500 text-white font-black flex items-center justify-center text-sm shadow-xs shrink-0">
                      👑
                    </div>
                    <div className="min-w-0 flex-1">
                      <h6 className="text-xs font-black text-slate-950 truncate">{user.name}</h6>
                      <p className="text-[11px] font-semibold text-slate-500 truncate">{user.email || "user@stockify.com"}</p>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${roleColor[user.role]}`}>
                        {roleLabel[user.role]}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => tabLogout()}
                    className="w-full py-2 px-3 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-800 hover:text-rose-700 border border-slate-200 hover:border-rose-200 transition-all text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                  >
                    <svg className="w-4 h-4 text-slate-600 group-hover:text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <div className="flex items-center justify-between px-5 h-20 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="A'AMAZON Logo" className="h-11 w-auto object-contain max-w-[200px]" />
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
            <div className="flex flex-col items-center justify-center text-center p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="w-14 h-14 rounded-full bg-emerald-500 text-white font-black flex items-center justify-center text-xl shadow-md border-2 border-white">
                {isAdmin ? "👑" : (user.name?.charAt(0)?.toUpperCase() ?? "U")}
              </div>

              <p className="text-base font-extrabold text-slate-950 tracking-tight pt-1">
                {user.name}
              </p>

              <div>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${roleColor[user.role]}`}>
                  {roleLabel[user.role]}
                </span>
              </div>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 mb-2">เมนูหลัก</p>
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
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all duration-150 relative ${
                    isActive
                      ? "bg-emerald-100 text-emerald-950"
                      : "text-slate-800 hover:bg-slate-100 hover:text-slate-950"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={isActive ? "text-emerald-700 font-bold" : "text-slate-600"}>
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
              className="w-full py-2.5 rounded-xl bg-white hover:bg-rose-50 text-slate-900 border border-slate-200 hover:border-rose-200 hover:text-rose-700 transition-all text-xs font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <svg className="w-4 h-4 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
