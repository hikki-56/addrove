"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/types/models";
import { useTabAuth } from "@/context/TabAuthContext";
import { getVisibleNavItems, SYSTEM_MENU_HREFS, type NavItem } from "@/components/layout/nav-items";
import { MENU_SETTINGS_HREF } from "@/lib/menu-visibility";
import { BOM_EDITOR_HREF } from "@/lib/bom-editor";
import { useMenuVisibility } from "@/context/MenuVisibilityContext";
import { getExpressTagCounts } from "@/client/express-tag-utils";
import { useEffect, useState, useCallback } from "react";
import {
  getPendingTransferNotifications,
  purgeInvalidNotifications,
} from "@/lib/transfer-notification-utils";
import { subscribeTransferSync } from "@/client/transfer-sync-scheduler";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import { NavIcon, SolarAltArrowDown, StockifyLogo, StockifyMark } from "@/components/icons";

// ลำดับเมนู "การทำรายการ" — เรียงตามความถี่การใช้งาน (งานลงมือก่อน ประวัติตามหลัง)
const OPERATION_ORDER = [
  "/movements/receive",
  "/movements/transfer",
  "/movements/move",
  "/stock-counts",
  "/temporary-stock-cuts",
  "/movements/receive/history",
  "/movements/transfer/history",
  "/movements/history",
];
const byOperationOrder = (a: NavItem, b: NavItem) => {
  const ia = OPERATION_ORDER.indexOf(a.href);
  const ib = OPERATION_ORDER.indexOf(b.href);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
};

const COLLAPSED_STORAGE_KEY = "stockify-sidebar-collapsed";

// Minimal UI v3b (D01/D02): หัวกลุ่มตัวเล็กสีเทา 11px · ไอคอน Solar duotone · เมนู active พื้นเขียวอ่อน
// ช่วง md–lg (768–1023px) เป็นแถบไอคอน (rail) เหมือนเดิม — ป้ายกลุ่ม/ชื่อเมนูแสดงตั้งแต่ lg
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
      className="hidden lg:flex w-full items-center justify-between gap-2 rounded-md px-3 pt-3.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.02em] text-m3-grey-500 hover:text-m3-grey-700 cursor-pointer transition-colors duration-150"
    >
      {label}
      <SolarAltArrowDown
        size={16}
        className={`shrink-0 text-m3-grey-500 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
      />
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
      className={`relative mb-0.5 flex h-10 items-center gap-3.5 rounded-lg px-3 lg:pr-2.5 text-[14px] leading-none cursor-pointer transition-colors duration-150 justify-center lg:justify-start focus-visible:outline-m3-primary ${
        active
          ? "bg-[rgba(0,167,111,0.08)] font-semibold text-m3-primary hover:bg-[rgba(0,167,111,0.16)]"
          : "font-medium text-m3-grey-600 hover:bg-[rgba(145,158,171,0.08)] hover:text-m3-grey-800"
      }`}
    >
      <span className={`flex shrink-0 ${active ? "text-m3-primary" : ""}`}>
        <NavIcon href={item.href} fallback={item.icon} />
      </span>
      <span className="hidden min-w-0 flex-1 truncate lg:block">{item.label}</span>
      {showBadge && (
        <span className="m3-label m3-label-error absolute right-1 top-0.5 h-[18px] min-w-[18px] justify-center px-1 text-[11px] tabular-nums lg:static lg:h-6 lg:min-w-6 lg:px-1.5 lg:text-[12px]">
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
  const { menu_hrefs, can_manage } = useMenuVisibility();

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
  const fetchOpenPlans = useCallback(() => {
    if (role !== "ADMIN" && role !== "WAREHOUSE_STAFF") return;
    fetch(`/api/receiving-plans?status=OPEN`, { cache: "no-store" })
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setOpenPlanCount(res.data.length);
        }
      })
      .catch(() => {});
  }, [role]);
  usePollingWhenVisible(fetchOpenPlans, 60000);

  const visibleItems = getVisibleNavItems({ email: tabUser?.email, name: userName, role }, menu_hrefs, can_manage);

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
        "/production/jobs",
        "/production/summary",
        BOM_EDITOR_HREF,
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
  const systemNav = visibleItems.filter((i) => [...SYSTEM_MENU_HREFS, MENU_SETTINGS_HREF].includes(i.href));
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
          <div className="min-h-0 overflow-hidden flex flex-col">
            {renderRows(items)}
          </div>
        </div>
      </section>
    );
  };

  return (
    <aside className="relative hidden md:flex flex-col bg-white text-m3-grey-600 select-none overflow-x-visible w-[88px] lg:w-[280px] shrink-0 transition-[width] duration-300 ease-in-out border-r border-[rgba(145,158,171,0.12)]">
      {/* Brand — สูง 72px ตาม mockup (.logo) */}
      <div className="flex h-[72px] shrink-0 items-center justify-center px-4 lg:justify-start lg:px-6">
        <StockifyLogo className="hidden lg:inline-flex" />
        <StockifyMark className="lg:hidden" />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-3 lg:px-4 pb-3">
        {renderGroup("overview", "ภาพรวม", mainNav)}
        {renderGroup("inventory", "คลังสินค้า", inventoryNav)}
        {renderGroup("operations", "การทำรายการ", movementNav)}
        {renderGroup("outbound", "ส่งของออก", outboundNav)}
        {role === "ADMIN" && renderGroup("express", "นำเข้า Express", expressNav)}
      </nav>

      {/* Bottom: ระบบ (.nav-sys) */}
      {systemNav.length > 0 && (
        <div className="shrink-0 border-t border-[rgba(145,158,171,0.16)] px-3 lg:px-4 pt-0.5 pb-5">
          {renderGroup("system", "ระบบ", systemNav)}
        </div>
      )}
    </aside>
  );
}
