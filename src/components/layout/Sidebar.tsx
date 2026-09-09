"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/types/models";
import { useTabAuth } from "@/context/TabAuthContext";
import { getNavItems, type NavItem } from "@/lib/nav-items";
import { getExpressTagCounts } from "@/lib/express-tag-utils";
import { useEffect, useState, useCallback } from "react";
import {
  getPendingTransferNotifications,
  purgeInvalidNotifications,
} from "@/lib/transfer-notification-utils";
import { subscribeTransferSync } from "@/lib/transfer-sync-scheduler";

const roleLabel: Record<UserRole, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการคลัง",
  APPROVER: "ผู้อนุมัติ",
  WAREHOUSE_STAFF: "พนักงานคลัง",
  STAFF: "เจ้าหน้าที่",
  VIEWER: "ผู้ดูข้อมูล",
};

// ลำดับเมนู "การทำรายการ" — เรียงตามความถี่การใช้งาน (งานลงมือก่อน ประวัติตามหลัง)
const OPERATION_ORDER = [
  "/movements/receive",
  "/movements/transfer",
  "/movements/move",
  "/production",
  "/stock-counts",
  "/movements/receive/history",
  "/movements/transfer/history",
  "/production/history",
  "/movements/history",
];
const byOperationOrder = (a: NavItem, b: NavItem) => {
  const ia = OPERATION_ORDER.indexOf(a.href);
  const ib = OPERATION_ORDER.indexOf(b.href);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
};

function GroupLabel({ label }: { label: string }) {
  return (
    <p className="hidden lg:block px-3 pt-5 pb-1.5 text-[11px] 2xl:text-xs font-medium uppercase tracking-wider text-(--sidebar-text-muted)">
      {label}
    </p>
  );
}

function NavRow({
  item,
  active,
  badge,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
}) {
  const showBadge = badge !== undefined && Number(badge) > 0;
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={`sidebar-link relative flex h-10 2xl:h-12 items-center gap-3 rounded-xl px-3 text-sm 2xl:text-base cursor-pointer transition-colors duration-150 justify-center lg:justify-start ${
        active ? "is-active font-semibold" : "font-medium"
      }`}
    >
      <span className="nav-icon shrink-0 2xl:[&_svg]:size-5">
        {item.icon}
      </span>
      <span className="truncate opacity-0 w-0 lg:opacity-100 lg:w-auto transition-all duration-200">
        {item.label}
      </span>
      {showBadge && (
        <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 grid place-items-center rounded-full bg-(--sidebar-active-bg) text-(--sidebar-active-text) font-semibold text-[10px] num lg:static lg:ml-auto lg:h-5 lg:min-w-5 lg:px-1.5 lg:text-[11px] 2xl:h-6 2xl:min-w-6 2xl:px-2 2xl:text-xs">
          {badge}
        </span>
      )}
    </Link>
  );
}

export default function Sidebar({
  role: initialRole,
  userName: initialName,
}: {
  role: UserRole;
  userName?: string;
}) {
  const pathname = usePathname();
  const { user: tabUser, logout: tabLogout } = useTabAuth();

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
    const unsubscribeSync = subscribeTransferSync(updateCount);

    window.addEventListener("stockify-transfer-created", updateCount);
    window.addEventListener("stockify-transfer-updated", updateCount);
    window.addEventListener("stockify-express-tags-updated", updateCount);
    window.addEventListener("storage", updateCount);
    return () => {
      unsubscribeSync();
      window.removeEventListener("stockify-transfer-created", updateCount);
      window.removeEventListener("stockify-transfer-updated", updateCount);
      window.removeEventListener("stockify-express-tags-updated", updateCount);
      window.removeEventListener("storage", updateCount);
    };
  }, [updateCount]);

  // จำนวนรออนุมัติสำหรับแอดมิน (เติมเต็ม badge เมนู + กระดิ่งใน header)
  useEffect(() => {
    if (role === "ADMIN") {
      const fetchPending = () => {
        fetch(`/api/approvals?status=PENDING`, { cache: "no-store" })
          .then((r) => r.json())
          .then((res) => {
            if (res.success && Array.isArray(res.data)) {
              setPendingApprovalCount(res.data.length);
              window.dispatchEvent(
                new CustomEvent("stockify-pending-approvals", { detail: res.data.length })
              );
            }
          })
          .catch(() => {});
      };
      fetchPending();
      // 60 วินาที: badge รออนุมัติไม่จำเป็นต้องสดทุก 30 วินาที และแท็บที่เปิดหลายเครื่อง
      // รวมกันเป็นภาระ Google Sheets quota ที่ดึงรายการหลักให้ช้าลง
      const interval = setInterval(fetchPending, 60000);
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
  const movementNav = visibleItems
    .filter((i) =>
      [
        "/movements/receive",
        "/movements/transfer",
        "/movements/move",
        "/production",
        "/movements/receive/history",
        "/movements/transfer/history",
        "/production/history",
        "/movements/history",
        "/staff/receive",
        "/staff/transfer",
        "/staff/move",
        "/stock-counts",
      ].includes(i.href)
    )
    .sort(byOperationOrder);
  const systemNav = visibleItems.filter((i) => ["/users", "/login-logs"].includes(i.href));
  const expressNav = visibleItems.filter((i) =>
    ["/express-import/receive", "/express-import/issue", "/express-import"].includes(i.href)
  );

  const badgeFor = (href: string): number | undefined => {
    if (href === "/approvals" && pendingApprovalCount > 0) return pendingApprovalCount;
    if (href === "/movements/transfer" && pendingTransferCount > 0 && role !== "ADMIN") return pendingTransferCount;
    if (href === "/express-import/receive" && expressTagCounts.receive > 0) return expressTagCounts.receive;
    if (href === "/express-import/transfer" && expressTagCounts.transfer > 0) return expressTagCounts.transfer;
    if (href === "/express-import/issue" && expressTagCounts.issue > 0) return expressTagCounts.issue;
    return undefined;
  };

  const userInitial = (userName || "ผู้ใช้").trim().charAt(0);
  const userDisplayName = userName || "ผู้ใช้ระบบ";

  const isActiveRoute = (item: NavItem) =>
    pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));

  const renderRows = (items: NavItem[]) =>
    items.map((item) => (
      <NavRow key={item.href} item={item} active={isActiveRoute(item)} badge={badgeFor(item.href)} />
    ));

  return (
    <aside className="relative hidden md:flex flex-col bg-(--sidebar-surface) text-(--sidebar-text) select-none overflow-x-visible w-[72px] lg:w-64 2xl:w-80 shrink-0 transition-[width] duration-300 ease-in-out border-r border-(--sidebar-edge)">
      {/* Brand — ความสูงผูกกับ --header-height เพื่อให้เส้นขอบล่างตรงกับ Top Navbar */}
      <div className="flex h-(--header-height) items-center justify-center border-b border-(--sidebar-divider) shrink-0 overflow-hidden">
        <img
          src="/logo.png"
          alt="Stockify"
          className="hidden lg:block h-12 2xl:h-14 w-auto object-contain max-w-[220px]"
        />
        <img
          src="/logo-vertical.png"
          alt="Stockify"
          className="lg:hidden h-11 w-auto object-contain"
        />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-2.5 lg:px-3.5 py-3">
        <GroupLabel label="ภาพรวม" />
        <div className="flex flex-col gap-1">{renderRows(mainNav)}</div>

        <GroupLabel label="คลังสินค้า" />
        <div className="flex flex-col gap-1">{renderRows(inventoryNav)}</div>

        <GroupLabel label="การทำรายการ" />
        <div className="flex flex-col gap-1">{renderRows(movementNav)}</div>

        {role === "ADMIN" && (
          <>
            <GroupLabel label="นำเข้า Express" />
            <div className="flex flex-col gap-1">{renderRows(expressNav)}</div>
          </>
        )}
      </nav>

      {/* Bottom: ระบบ + โปรไฟล์ */}
      <div className="border-t border-(--sidebar-divider) shrink-0 px-2.5 lg:px-3.5 py-3">
        <div className="hidden lg:block">
          <GroupLabel label="ระบบ" />
        </div>
        <div className="flex flex-col gap-1">{renderRows(systemNav)}</div>
        <div className="border-t border-(--sidebar-divider) mt-3 pt-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-(--sidebar-item-bg-hover) justify-center lg:justify-start">
            <span className="size-9 2xl:size-10 rounded-full bg-(--sidebar-active-bg) grid place-items-center text-sm 2xl:text-base font-bold text-(--sidebar-active-text) shrink-0">
              {userInitial}
            </span>
            <div className="hidden lg:flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm 2xl:text-base font-medium leading-tight text-(--sidebar-text-hover)">
                {userDisplayName}
              </span>
              <span className="truncate text-xs 2xl:text-sm text-(--sidebar-text-muted)">{roleLabel[role]}</span>
            </div>
            <button
              type="button"
              onClick={() => tabLogout()}
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
              className="hidden lg:grid shrink-0 place-items-center size-8 rounded-lg text-(--sidebar-text-muted) hover:text-(--sidebar-text-hover) hover:bg-(--sidebar-item-bg-hover) transition-colors duration-150 cursor-pointer"
            >
              <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" x2="9" y1="12" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
