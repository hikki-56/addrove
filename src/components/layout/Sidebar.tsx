"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/types/models";
import { useTabAuth } from "@/context/TabAuthContext";
import { navItems, type NavItem } from "@/lib/nav-items";
import { useEffect, useState, useCallback } from "react";
import {
  getPendingTransferNotifications,
  getTransferNotifications,
  saveTransferNotification,
  markTransferCompleted,
  isTransferCompleted,
  getDisplayProductName,
  purgeInvalidNotifications,
  syncServerTransferNotifications,
  fetchAndSyncTransferNotifications,
} from "@/lib/transfer-notification-utils";

const roleLabel: Record<UserRole, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการคลัง",
  WAREHOUSE_STAFF: "พนักงานคลัง",
  STAFF: "เจ้าหน้าที่",
  VIEWER: "ผู้ดูข้อมูล",
};

export default function Sidebar({
  role: initialRole,
  userName: initialName,
  collapsed = false,
  onToggle,
}: {
  role: UserRole;
  userName?: string;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const { user: tabUser, logout: tabLogout } = useTabAuth();

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    overview: true,
    management: true,
    movements: true,
    system: true,
  });

  const toggleSection = (sectionKey: string) => {
    setOpenSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const [pendingTransferCount, setPendingTransferCount] = useState<number>(() => {
    purgeInvalidNotifications();
    const staffFilter = (tabUser?.role || initialRole) !== "ADMIN" ? (tabUser?.name || initialName) : undefined;
    return getPendingTransferNotifications(staffFilter).length;
  });

  const role = tabUser?.role || initialRole;
  const userName = tabUser?.name || initialName;

  const updateCount = useCallback(() => {
    const staffFilter = role !== "ADMIN" ? userName : undefined;
    setPendingTransferCount(getPendingTransferNotifications(staffFilter).length);
  }, [role, userName]);

  useEffect(() => {
    const syncServerTransfers = () => {
      void fetchAndSyncTransferNotifications().then(() => updateCount());
    };

    syncServerTransfers();
    const interval = setInterval(syncServerTransfers, 20000);

    window.addEventListener("stockify-transfer-created", updateCount);
    window.addEventListener("stockify-transfer-updated", updateCount);
    window.addEventListener("storage", updateCount);
    return () => {
      clearInterval(interval);
      window.removeEventListener("stockify-transfer-created", updateCount);
      window.removeEventListener("stockify-transfer-updated", updateCount);
      window.removeEventListener("storage", updateCount);
    };
  }, [updateCount]);

  const visibleItems = navItems.filter(
    (item) => !item.roles || item.roles.includes(role)
  );

  const mainNav = visibleItems.filter((i) => ["/dashboard"].includes(i.href));
  const inventoryNav = visibleItems.filter((i) =>
    ["/products", "/approvals", "/stock", "/locations", "/warehouses/qr", "/shelves/qr"].includes(i.href)
  );
  const movementNav = visibleItems.filter((i) =>
    ["/movements/receive", "/movements/transfer", "/movements/move", "/stock-counts", "/movements/history"].includes(i.href)
  );
  const systemNav = visibleItems.filter((i) => ["/users", "/login-logs"].includes(i.href));

  return (
    <aside
      className={`hidden md:flex flex-shrink-0 flex-col bg-[#0f172a] border-r border-slate-800 text-white select-none shadow-2xl transition-all duration-300 ease-in-out ${
        collapsed ? "w-0 overflow-hidden border-r-0 opacity-0 pointer-events-none" : "w-72 opacity-100"
      }`}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-center px-4 h-20 border-b border-slate-800 bg-[#0f172a]">
        <Link href="/dashboard" className="flex items-center justify-center gap-3 group w-full">
          <img
            src="/logo.png"
            alt="A'AMAZON Logo"
            className="h-12 sm:h-14 w-auto object-contain max-w-[240px] mx-auto transition-transform group-hover:scale-105"
          />
        </Link>
      </div>

      {/* Nav Menu List */}
      <nav className="flex-1 px-4 py-4 space-y-4 overflow-y-auto">

        {/* Overview Section */}
        {mainNav.length > 0 && (
          <div>
            <SectionHeader
              title="Overview"
              isOpen={openSections.overview}
              onToggle={() => toggleSection("overview")}
            />
            {openSections.overview && (
              <div className="space-y-1 mt-1">
                {mainNav.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  return (
                    <MinimalNavItem
                      key={item.href}
                      item={item}
                      isActive={isActive}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Management (คลังสินค้า) Section */}
        {inventoryNav.length > 0 && (
          <div>
            <SectionHeader
              title="Management · คลังสินค้า"
              isOpen={openSections.management}
              onToggle={() => toggleSection("management")}
            />
            {openSections.management && (
              <div className="space-y-1 mt-1">
                {inventoryNav.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  return (
                    <MinimalNavItem
                      key={item.href}
                      item={item}
                      isActive={isActive}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Transactions (การทำรายการ) Section */}
        {movementNav.length > 0 && (
          <div>
            <SectionHeader
              title="Transactions · การทำรายการ"
              isOpen={openSections.movements}
              onToggle={() => toggleSection("movements")}
            />
            {openSections.movements && (
              <div className="space-y-1 mt-1">
                {movementNav.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  const showBadge = item.href === "/movements/transfer" && pendingTransferCount > 0 && role !== "ADMIN";
                  return (
                    <MinimalNavItem
                      key={item.href}
                      item={item}
                      isActive={isActive}
                      badge={showBadge ? pendingTransferCount : undefined}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* System (ระบบและการตั้งค่า) Section */}
        {systemNav.length > 0 && (
          <div>
            <SectionHeader
              title="System · การตั้งค่า"
              isOpen={openSections.system}
              onToggle={() => toggleSection("system")}
            />
            {openSections.system && (
              <div className="space-y-1 mt-1">
                {systemNav.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  return (
                    <MinimalNavItem
                      key={item.href}
                      item={item}
                      isActive={isActive}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>


    </aside>
  );
}

function SectionHeader({
  title,
  isOpen,
  onToggle,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full text-left text-[11px] font-black text-white uppercase tracking-widest px-3 py-2 flex items-center justify-between group hover:text-emerald-300 transition-colors"
    >
      <span className="text-white font-black">{title}</span>
      <svg
        className={`w-3.5 h-3.5 text-white transition-transform duration-200 ${
          isOpen ? "rotate-180" : ""
        }`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

function MinimalNavItem({
  item,
  isActive,
  badge,
}: {
  item: NavItem;
  isActive: boolean;
  badge?: number | string;
}) {
  return (
    <Link
      href={item.href}
      className={`group flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-black transition-all duration-150 relative ${
        isActive
          ? "bg-emerald-600/40 text-white font-black border border-emerald-400/60 shadow-md"
          : "text-white hover:bg-white/15 hover:text-white"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex-shrink-0 text-white transition-colors">
          {item.icon}
        </span>
        <span className="truncate text-white font-black">{item.label}</span>
      </div>

      {badge ? (
        <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white font-black text-[10px] shadow-sm animate-pulse">
          {badge}
        </span>
      ) : (
        <svg
          className={`w-3.5 h-3.5 text-white transition-opacity ${
            isActive ? "opacity-100 font-black" : "opacity-0 group-hover:opacity-100"
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </Link>
  );
}
