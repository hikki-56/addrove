"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/types/models";
import { useTabAuth } from "@/context/TabAuthContext";
import { getNavItems, getAllowedMenuHrefs, isSystemMenuUser, type NavItem } from "@/lib/nav-items";
import { isProductionReviewer } from "@/lib/production-reviewers";
import { getExpressTagCounts } from "@/lib/express-tag-utils";
import { useEffect, useState, useCallback } from "react";
import {
  getPendingTransferNotifications,
  purgeInvalidNotifications,
} from "@/lib/transfer-notification-utils";
import { subscribeTransferSync } from "@/lib/transfer-sync-scheduler";

// ลำดับเมนู "การทำรายการ" — เรียงตามความถี่การใช้งาน (งานลงมือก่อน ประวัติตามหลัง)
const OPERATION_ORDER = [
  "/movements/receive",
  "/movements/transfer",
  "/movements/move",
  "/production",
  "/production/review",
  "/production/formula",
  "/stock-counts",
  "/temporary-stock-cuts",
  "/movements/receive/history",
  "/movements/transfer/history",
  "/production/history",
  "/production/waste",
  "/movements/history",
];
const byOperationOrder = (a: NavItem, b: NavItem) => {
  const ia = OPERATION_ORDER.indexOf(a.href);
  const ib = OPERATION_ORDER.indexOf(b.href);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
};

const COLLAPSED_STORAGE_KEY = "stockify-sidebar-collapsed";

function GroupLabel({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="hidden lg:flex w-full items-center justify-between gap-2 px-3 pt-5 pb-1.5 text-[12px] 2xl:text-xs font-medium uppercase tracking-wider text-(--sidebar-text-muted) hover:text-(--sidebar-text-hover) cursor-pointer transition-colors duration-150"
    >
      {label}
      <svg
        className={`h-3 w-3 shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
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
        <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 grid place-items-center rounded-full bg-(--sidebar-active-bg) text-(--sidebar-active-text) font-semibold text-xs num lg:static lg:ml-auto lg:h-5 lg:min-w-5 lg:px-1.5 2xl:h-6 2xl:min-w-6 2xl:px-2">
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
  const { user: tabUser } = useTabAuth();

  // กลุ่มเมนูที่ถูกพับไว้ — จำสถานะใน localStorage ต่ออุปกรณ์
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (raw) setCollapsedGroups(JSON.parse(raw));
    } catch {
      // ค่าเสีย/อ่านไม่ได้ → ถือว่ากางทุกกลุ่ม
    }
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // พับ/กางยังทำงาน แค่ไม่จำสถานะข้ามการรีเฟรช
      }
      return next;
    });
  }, []);

  const [pendingTransferCount, setPendingTransferCount] = useState<number>(() => {
    purgeInvalidNotifications();
    const staffFilter = (tabUser?.role || initialRole) !== "ADMIN" ? (tabUser?.name || initialName) : undefined;
    return getPendingTransferNotifications(staffFilter).length;
  });

  const [pendingApprovalCount, setPendingApprovalCount] = useState<number>(0);

  // แผนรับสินค้าที่ยังเปิดอยู่ (รอรับ/กำลังรับ) — badge เมนู "รับสินค้าเข้าโกดัง"
  const [openPlanCount, setOpenPlanCount] = useState<number>(0);

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

  // แผนรับสินค้าที่ยังเปิดอยู่ — สำหรับแอดมินและพนักงานโกดังที่ต้องลงมือรับ
  useEffect(() => {
    if (role === "ADMIN" || role === "WAREHOUSE_STAFF") {
      const fetchOpenPlans = () => {
        fetch(`/api/receiving-plans?status=OPEN`, { cache: "no-store" })
          .then((r) => r.json())
          .then((res) => {
            if (res.success && Array.isArray(res.data)) {
              setOpenPlanCount(res.data.length);
            }
          })
          .catch(() => {});
      };
      fetchOpenPlans();
      const interval = setInterval(fetchOpenPlans, 60000);
      return () => clearInterval(interval);
    }
  }, [role]);

  const itemsForRole = getNavItems(role);
  // บัญชีแอดมินที่ถูกจำกัดเมนู (เช่น milk) เห็นเฉพาะหน้าที่กำหนด
  const allowedHrefs = getAllowedMenuHrefs({ email: tabUser?.email, name: userName });
  const visibleItems = itemsForRole.filter(
    (item) =>
      (!item.roles || item.roles.includes(role)) &&
      (!allowedHrefs || allowedHrefs.includes(item.href)) &&
      // เมนู "ยืนยันผลผลิต" เห็นได้ทั้งแอดมินและคนตรวจ (ชื่อบัญชีที่กำหนดใน production-reviewers.ts)
      (item.href !== "/production/review" ||
        role === "ADMIN" ||
        isProductionReviewer({ email: tabUser?.email, name: userName }))
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
        "/production/formula",
        "/production/review",
        "/production/history",
        "/production/waste",
        "/movements/receive/history",
        "/movements/transfer/history",
        "/movements/history",
        "/staff/receive",
        "/staff/transfer",
        "/staff/move",
        "/stock-counts",
        "/temporary-stock-cuts",
      ].includes(i.href)
    )
    .sort(byOperationOrder);
  const systemNav = isSystemMenuUser(tabUser?.email)
    ? visibleItems.filter((i) => ["/users", "/login-logs", "/users/cards"].includes(i.href))
    : [];
  const expressNav = visibleItems.filter((i) =>
    ["/express-import/receive", "/express-import/issue", "/express-import"].includes(i.href)
  );
  const outboundNav = visibleItems.filter((i) =>
    ["/outbound", "/outbound/work-orders", "/outbound/pick", "/outbound/pack", "/outbound/loading"].includes(i.href)
  );

  const badgeFor = (href: string): number | undefined => {
    if (href === "/approvals" && pendingApprovalCount > 0) return pendingApprovalCount;
    if (href === "/movements/transfer" && pendingTransferCount > 0 && role !== "ADMIN") return pendingTransferCount;
    if ((href === "/movements/receive" || href === "/staff/receive") && openPlanCount > 0) return openPlanCount;
    if (href === "/express-import/receive" && expressTagCounts.receive > 0) return expressTagCounts.receive;
    if (href === "/express-import/transfer" && expressTagCounts.transfer > 0) return expressTagCounts.transfer;
    if (href === "/express-import/issue" && expressTagCounts.issue > 0) return expressTagCounts.issue;
    return undefined;
  };

  // เลือกเมนูที่ตรง path ยาวที่สุดตัวเดียว — กันหลายเมนูสว่างพร้อมกัน
  // (เช่น หน้า /production/formula ต้องสว่างเฉพาะ "แก้ไขสูตร BOM" ไม่ใช่ "ผลิตสินค้า" ด้วย)
  const activeHref = visibleItems
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const isActiveRoute = (item: NavItem) => item.href === activeHref;

  const renderRows = (items: NavItem[]) =>
    items.map((item) => (
      <NavRow key={item.href} item={item} active={isActiveRoute(item)} badge={badgeFor(item.href)} />
    ));

  // กลุ่มเมนูแบบพับได้ — กดป้ายกลุ่มเพื่อพับ/กาง (ป้ายแสดงเฉพาะ lg ขึ้นไป)
  // แถบ rail 768–1023px ไม่มีป้าย จึงต้องแสดงไอคอนเสมอแม้กลุ่มถูกพับ
  // (สถานะพับจึงเป็น grid-rows-[1fr] lg:grid-rows-[0fr] แทน display:none
  // เพื่อให้เลื่อนความสูงแบบ smooth ผ่าน transition ของ grid-template-rows)
  // กลุ่มที่มีเมนูหน้าปัจจุบันอยู่ข้างในถูกกางอยู่เสมอ ไม่ซ่อนเมนูที่กำลังใช้งาน
  const renderGroup = (id: string, label: string, items: NavItem[]) => {
    if (items.length === 0) return null;
    const collapsed = collapsedGroups[id] === true && !items.some(isActiveRoute);
    return (
      <section key={id}>
        <GroupLabel label={label} collapsed={collapsed} onToggle={() => toggleGroup(id)} />
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
            collapsed ? "grid-rows-[1fr] opacity-100 lg:grid-rows-[0fr] lg:opacity-0" : "grid-rows-[1fr]"
          }`}
        >
          <div className="min-h-0 overflow-hidden flex flex-col gap-1">
            {renderRows(items)}
          </div>
        </div>
      </section>
    );
  };

  return (
    <aside className="relative hidden md:flex flex-col bg-(--sidebar-surface) text-(--sidebar-text) select-none overflow-x-visible w-[100px] lg:w-64 2xl:w-80 shrink-0 transition-[width] duration-300 ease-in-out border-r border-(--sidebar-edge)">
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
        {renderGroup("overview", "ภาพรวม", mainNav)}
        {renderGroup("inventory", "คลังสินค้า", inventoryNav)}
        {renderGroup("operations", "การทำรายการ", movementNav)}
        {renderGroup("outbound", "ส่งของออก", outboundNav)}
        {role === "ADMIN" && renderGroup("express", "นำเข้า Express", expressNav)}
      </nav>

      {/* Bottom: ระบบ */}
      <div className="border-t border-(--sidebar-divider) shrink-0 px-2.5 lg:px-3.5 py-3">
        {renderGroup("system", "ระบบ", systemNav)}
      </div>
    </aside>
  );
}
