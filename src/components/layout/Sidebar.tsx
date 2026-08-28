"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/types/models";
import { useTabAuth } from "@/context/TabAuthContext";
import { navItems, getNavItems, type NavItem } from "@/lib/nav-items";
import { getExpressTagCounts } from "@/lib/express-tag-utils";
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
  APPROVER: "ผู้อนุมัติ",
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
    express: true,
  });

  const toggleSection = (sectionKey: string) => {
    setOpenSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const [pendingTransferCount, setPendingTransferCount] = useState<number>(() => {
    purgeInvalidNotifications();
    const staffFilter = (tabUser?.role || initialRole) !== "ADMIN" ? (tabUser?.name || initialName) : undefined;
    return getPendingTransferNotifications(staffFilter).length;
  });

  const [pendingApprovalCount, setPendingApprovalCount] = useState<number>(0);

  const [expressTagCounts, setExpressTagCounts] = useState<{ receive: number; issue: number; transfer: number }>(() => {
    const rec = getExpressTagCounts("RECEIVE").pending;
    const iss = getExpressTagCounts("ISSUE").pending;
    const trf = getExpressTagCounts("TRANSFER").pending;
    return { receive: rec, issue: iss, transfer: trf };
  });

  const role = tabUser?.role || initialRole;
  const userName = tabUser?.name || initialName;

  const updateCount = useCallback(() => {
    const staffFilter = role !== "ADMIN" ? userName : undefined;
    setPendingTransferCount(getPendingTransferNotifications(staffFilter).length);
    const rec = getExpressTagCounts("RECEIVE").pending;
    const iss = getExpressTagCounts("ISSUE").pending;
    const trf = getExpressTagCounts("TRANSFER").pending;
    setExpressTagCounts({ receive: rec, issue: iss, transfer: trf });
  }, [role, userName]);

  useEffect(() => {
    const syncServerTransfers = () => {
      void fetchAndSyncTransferNotifications().then(() => updateCount());
    };

    syncServerTransfers();
    const interval = setInterval(syncServerTransfers, 5000);

    window.addEventListener("stockify-transfer-created", updateCount);
    window.addEventListener("stockify-transfer-updated", updateCount);
    window.addEventListener("stockify-express-tags-updated", updateCount);
    window.addEventListener("storage", updateCount);
    return () => {
      clearInterval(interval);
      window.removeEventListener("stockify-transfer-created", updateCount);
      window.removeEventListener("stockify-transfer-updated", updateCount);
      window.removeEventListener("stockify-express-tags-updated", updateCount);
      window.removeEventListener("storage", updateCount);
    };
  }, [updateCount]);

  // Fetch pending approval count for Admin
  useEffect(() => {
    if (role === "ADMIN") {
      const fetchPending = () => {
        fetch(`/api/approvals?status=PENDING&_t=${Date.now()}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((res) => {
            if (res.success && Array.isArray(res.data)) {
              setPendingApprovalCount(res.data.length);
            }
          })
          .catch(() => {});
      };
      fetchPending();
      const interval = setInterval(fetchPending, 15000);
      return () => clearInterval(interval);
    }
  }, [role]);

  const itemsForRole = getNavItems(role);
  const visibleItems = itemsForRole.filter(
    (item) => !item.roles || item.roles.includes(role)
  );

  const mainNav = visibleItems.filter((i) => ["/dashboard"].includes(i.href));
  const inventoryNav = visibleItems.filter((i) =>
    ["/products", "/approvals", "/stock", "/locations", "/warehouses/qr", "/shelves/qr"].includes(i.href)
  );
  const movementNav = visibleItems.filter((i) =>
    [
      "/movements/receive",
      "/movements/receive/history",
      "/production",
      "/production/history",
      "/movements/transfer",
      "/movements/transfer/history",
      "/movements/move",
      "/staff/receive",
      "/staff/transfer",
      "/staff/move",
      "/stock-counts",
      "/movements/history",
    ].includes(i.href)
  );
  const systemNav = visibleItems.filter((i) => ["/users", "/login-logs"].includes(i.href));
  const expressNav = visibleItems.filter((i) =>
    ["/express-import/receive", "/express-import/issue", "/express-import"].includes(i.href)
  );

  return (
    <aside
      className={`hidden md:flex flex-shrink-0 flex-col bg-slate-900 border-r border-slate-800 text-white select-none shadow-xl transition-all duration-300 ease-in-out ${
        collapsed ? "w-0 overflow-hidden border-r-0 opacity-0 pointer-events-none" : "w-64 sm:w-72 opacity-100"
      }`}
    >
      {/* Brand Header */}
      <div className="flex items-center px-4 sm:px-5 h-16 sm:h-18 border-b border-slate-800/90 bg-slate-900/95 shrink-0">
        <Link href="/dashboard" className="flex items-center group">
          <img
            src="/logo.png"
            alt="A'AMAZON Logo"
            className="h-10 sm:h-11 md:h-12 w-auto object-contain max-w-[220px] transition-transform duration-200 group-hover:scale-105"
          />
        </Link>
      </div>

      {/* Nav Menu List */}
      <nav className="flex-1 px-3 py-3 space-y-3.5 overflow-y-auto overscroll-contain">
        {/* Overview Section */}
        {mainNav.length > 0 && (
          <div>
            <SectionHeader
              title="ภาพรวม (Overview)"
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
              title="คลังสินค้า (Inventory)"
              isOpen={openSections.management}
              onToggle={() => toggleSection("management")}
            />
            {openSections.management && (
              <div className="space-y-1 mt-1">
                {inventoryNav.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  const badge =
                    item.href === "/approvals" && pendingApprovalCount > 0
                      ? pendingApprovalCount
                      : undefined;
                  return (
                    <MinimalNavItem
                      key={item.href}
                      item={item}
                      isActive={isActive}
                      badge={badge}
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
              title="การทำรายการ (Operations)"
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
              title="ระบบและการตั้งค่า (System)"
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

        {/* Express (นำเข้า Express) Section */}
        {role === "ADMIN" && expressNav.length > 0 && (
          <div>
            <SectionHeader
              title="นำเข้า Express (Express)"
              isOpen={openSections.express}
              onToggle={() => toggleSection("express")}
            />
            {openSections.express && (
              <div className="space-y-1 mt-1">
                {expressNav.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  const badge =
                    item.href === "/express-import/receive" && expressTagCounts.receive > 0
                      ? expressTagCounts.receive
                      : item.href === "/express-import/transfer" && expressTagCounts.transfer > 0
                      ? expressTagCounts.transfer
                      : item.href === "/express-import/issue" && expressTagCounts.issue > 0
                      ? expressTagCounts.issue
                      : undefined;
                  return (
                    <MinimalNavItem
                      key={item.href}
                      item={item}
                      isActive={isActive}
                      badge={badge}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Footer System Status Badge */}
      <div className="p-3 border-t border-slate-800/90 bg-slate-900/60 shrink-0">
        <div className="px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-medium text-slate-300">ระบบออนไลน์</span>
          </div>
          <span className="font-mono text-[10px] text-slate-500 font-semibold">v0.2.0</span>
        </div>
      </div>
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
      className="w-full text-left text-[11px] font-semibold text-slate-400 px-3 py-1.5 flex items-center justify-between group hover:text-slate-200 transition-colors cursor-pointer"
    >
      <span className="tracking-wider">{title}</span>
      <svg
        className={`w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-transform duration-200 ${
          isOpen ? "rotate-180" : ""
        }`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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
      className={`group relative flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-[13px] transition-all duration-150 cursor-pointer ${
        isActive
          ? "bg-emerald-500/12 text-emerald-400 font-semibold border border-emerald-500/25 shadow-xs before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r-full before:bg-emerald-400"
          : "text-slate-300 hover:bg-slate-800/70 hover:text-white font-medium"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`flex-shrink-0 transition-colors ${
            isActive ? "text-emerald-400" : "text-slate-400 group-hover:text-slate-200"
          }`}
        >
          {item.icon}
        </span>
        <span className="truncate">{item.label}</span>
      </div>

      {badge !== undefined && Number(badge) > 0 ? (
        <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white font-bold text-[10px] shadow-xs animate-pulse">
          {badge}
        </span>
      ) : (
        <svg
          className={`w-3.5 h-3.5 transition-all ${
            isActive
              ? "text-emerald-400 opacity-100 translate-x-0"
              : "text-slate-500 opacity-0 -translate-x-1 group-hover:opacity-60 group-hover:translate-x-0"
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </Link>
  );
}
