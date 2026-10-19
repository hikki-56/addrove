"use client";

import { userInitials } from "@/components/ui/user-initials";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/types/models";
import { useTabAuth } from "@/context/TabAuthContext";
import { getVisibleNavItems } from "@/components/layout/nav-items";
import { useMenuVisibility } from "@/context/MenuVisibilityContext";
import { getPendingTransferNotifications, getDisplayProductName } from "@/lib/transfer-notification-utils";
import { subscribeTransferSync } from "@/client/transfer-sync-scheduler";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import { useEscapeKey } from "@/hooks/use-escape-key";
import ProductionBell from "@/components/layout/ProductionBell";
import {
  NavIcon,
  SolarAltArrowDown,
  SolarBell,
  SolarClose,
  SolarDocumentCheck,
  SolarHamburger,
  SolarLogout,
  StockifyLogo,
} from "@/components/icons";

const roleLabel: Record<UserRole, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการคลัง",
  APPROVER: "ผู้อนุมัติ",
  WAREHOUSE_STAFF: "พนักงานคลัง",
  PACKER: "พนักงานแพ็กของ",
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
  "/temporary-stock-cuts": { parent: "การทำรายการ", title: "ตัดสต็อกชั่วคราว" },
  "/locations": { parent: "คลังสินค้า", title: "ตำแหน่งสินค้าในโกดัง" },
  "/movements/receive": { parent: "การเคลื่อนไหว", title: "รับสินค้าเข้า (Admin)" },
  "/movements/receive/history": { parent: "การเคลื่อนไหว", title: "ประวัติรับสินค้าเข้าโกดัง" },
  "/production": { parent: "การผลิต", title: "วางแผนผลิต" },
  "/production/jobs": { parent: "การผลิต", title: "งานผลิต" },
  "/production/summary": { parent: "การผลิต", title: "สรุปผลผลิต" },
  "/movements/transfer": { parent: "การเคลื่อนไหว", title: "เบิกสินค้า (Admin)" },
  "/movements/transfer/history": { parent: "การเคลื่อนไหว", title: "ประวัติเบิกสินค้า" },
  "/movements/move": { parent: "การเคลื่อนไหว", title: "ย้ายตำแหน่งสินค้า (Admin)" },
  "/staff/receive": { parent: "พนักงาน", title: "สแกนรับสินค้าเข้าคลัง" },
  "/staff/transfer": { parent: "พนักงาน", title: "รายการที่ต้องไปเบิกสินค้า" },
  "/staff/move": { parent: "พนักงาน", title: "สแกนจัดตำแหน่งสินค้า" },
  "/movements/history": { parent: "การเคลื่อนไหว", title: "ประวัติการเคลื่อนไหว" },
  "/users": { parent: "การตั้งค่า", title: "จัดการพนักงาน" },
  "/menu-settings": { parent: "การตั้งค่า", title: "ตั้งค่าเมนูผู้ใช้" },
  "/login-logs": { parent: "การแจ้งเตือน", title: "ประวัติการเข้าระบบ" },
};

export default function DashboardHeader({
  user,
}: {
  user: { name: string; email: string; role: UserRole };
}) {
  const { logout: tabLogout } = useTabAuth();
  const { menu_hrefs, can_manage } = useMenuVisibility();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

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
      : pathname.startsWith("/production/jobs/")
        ? { parent: "งานผลิต", title: "รายละเอียดงานผลิต" }
        : { parent: "Stockify", title: "ภาพรวม" });

  const visibleItems = getVisibleNavItems(user, menu_hrefs, can_manage);

  const headerNotificationCount = isAdmin ? pendingApprovalCount : pendingTransferCount;

  const initials = userInitials(user.name);

  // ปุ่มไอคอนวงกลม 40px (.ib) + badge มุมขวาบน (.badge) ตาม mockup D01/M31
  const iconButton =
    "relative grid size-10 shrink-0 place-items-center rounded-full text-m3-grey-600 transition-colors duration-150 hover:bg-[rgba(145,158,171,0.08)] cursor-pointer";
  const countBadge =
    "absolute right-0.5 top-1 flex h-5 min-w-5 items-center justify-center rounded-[10px] border-2 border-white px-1.5 text-[12px] font-semibold leading-none tabular-nums";

  const approvalsButton = (
    <Link
      href="/approvals"
      aria-label="รายการรออนุมัติ"
      title="รายการรออนุมัติ"
      className={iconButton}
    >
      <SolarDocumentCheck size={24} />
      {headerNotificationCount > 0 && (
        <span className={`${countBadge} bg-m3-warning text-m3-grey-800`}>
          {headerNotificationCount > 99 ? "99+" : headerNotificationCount}
        </span>
      )}
    </Link>
  );

  const transferBellButton = (
    <button
      type="button"
      onClick={() => {
        setNotificationsOpen(!notificationsOpen);
        setUserMenuOpen(false);
      }}
      aria-label="การแจ้งเตือนงานเบิกสินค้า"
      className={iconButton}
    >
      <SolarBell size={24} />
      {pendingTransferCount > 0 && (
        <span className={`${countBadge} bg-m3-error text-white`}>{pendingTransferCount}</span>
      )}
    </button>
  );

  const userMenu = (
    <div className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-white p-2 shadow-m3-dropdown animate-in fade-in zoom-in-95 duration-150">
      <div className="flex items-center gap-3 px-2 pb-3 pt-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-m3-primary-lighter text-[14px] font-semibold text-m3-primary-darker">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-m3-grey-800">{user.name}</p>
          <p className="truncate text-[13px] text-m3-grey-600">{user.email || "user@stockify.com"}</p>
        </div>
      </div>
      <div className="px-2 pb-2">
        <span className="m3-label m3-label-primary">{roleLabel[user.role]}</span>
      </div>
      <div className="border-t border-dashed border-m3-divider pt-2">
        <button
          type="button"
          onClick={() => tabLogout()}
          className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-[14px] font-semibold text-m3-error-dark transition-colors duration-150 hover:bg-[rgba(255,86,48,0.08)]"
        >
          <SolarLogout size={20} />
          ออกจากระบบ
        </button>
      </div>
    </div>
  );

  return (
    <>
      <header className="z-20 flex-shrink-0 bg-white/90 backdrop-blur-[6px] md:h-[76px]">
        {/* Mobile (M31) */}
        <div className="flex h-16 items-center justify-between gap-3 px-4 md:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <button
              id="btn-mobile-menu"
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="-ml-2 grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-m3-grey-800 transition-colors duration-150 hover:bg-[rgba(145,158,171,0.08)]"
              aria-label="เปิดเมนู"
            >
              <SolarHamburger size={26} />
            </button>
            <h1 className="truncate text-[18px] font-bold leading-tight text-m3-grey-800">
              {breadcrumb.title}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            {/* กระดิ่งแจ้งเตือนระบบผลิต (ADMIN + APPROVER) — mount จริงเฉพาะช่องที่ตรง breakpoint */}
            <ProductionBell placement="mobile" />
            <div className="relative">{isAdmin ? approvalsButton : transferBellButton}</div>
            {/* Avatar */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen);
                  setNotificationsOpen(false);
                }}
                aria-label="เมนูผู้ใช้"
                className="grid size-9 cursor-pointer place-items-center rounded-full bg-m3-primary-lighter text-[13px] font-semibold text-m3-primary-darker"
              >
                {initials}
              </button>
              {userMenuOpen && userMenu}
            </div>
          </div>
        </div>

        {/* Tablet / Desktop (D01) */}
        <div className="hidden h-[76px] items-center justify-between gap-6 px-6 md:flex xl:px-10">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-[20px] font-bold leading-[1.3] text-m3-grey-800">
              {breadcrumb.title}
            </h1>
            <p className="mt-px truncate text-[13px] text-m3-grey-600">{breadcrumb.parent}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* กระดิ่งแจ้งเตือนระบบผลิต (ADMIN + APPROVER) — mount จริงเฉพาะช่องที่ตรง breakpoint */}
            <ProductionBell placement="desktop" />
            <div className="relative">
              {isAdmin ? approvalsButton : transferBellButton}

              {/* Staff notification dropdown */}
              {notificationsOpen && !isAdmin && (
                <div className="absolute right-0 z-50 mt-2 w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-xl bg-white shadow-m3-dropdown animate-in fade-in zoom-in-95 duration-150 sm:w-80">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-[14px] font-bold text-m3-grey-800">การแจ้งเตือนงานเบิกสินค้า</span>
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                      aria-label="ปิด"
                      className="grid size-7 cursor-pointer place-items-center rounded-full text-m3-grey-500 hover:bg-[rgba(145,158,171,0.08)] hover:text-m3-grey-800"
                    >
                      <SolarClose size={16} />
                    </button>
                  </div>
                  {notificationsList.length === 0 ? (
                    <div className="border-t border-dashed border-m3-divider px-4 py-8 text-center text-[13px] font-medium text-m3-grey-500">
                      ไม่มีรายการแจ้งเตือนค้างอยู่
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto border-t border-dashed border-m3-divider">
                      {notificationsList.map((t) => (
                        <Link
                          key={t.id}
                          href="/movements/transfer"
                          onClick={() => setNotificationsOpen(false)}
                          className="block space-y-1 border-b border-dashed border-m3-divider px-4 py-3 text-[13px] transition-colors duration-150 last:border-b-0 hover:bg-[rgba(145,158,171,0.08)]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold text-m3-grey-800">
                              {t.doc_no || "TRF"}
                            </span>
                            <span className="m3-label m3-label-warning">
                              {Number(t.qty || 0).toLocaleString()} ชิ้น
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex-1 truncate text-m3-grey-700">
                              {getDisplayProductName(t)}
                            </span>
                            <span className="shrink-0 text-[12px] text-m3-grey-500">
                              {t.from_warehouse_name} → <strong className="font-semibold text-m3-primary-dark">{t.to_warehouse_name}</strong>
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* User chip (.chip-u) */}
            <div className="relative ml-2">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen);
                  setNotificationsOpen(false);
                }}
                aria-label="เมนูผู้ใช้"
                className="relative flex cursor-pointer items-center gap-1 rounded-3xl border border-m3-divider py-1 pl-1 pr-2 transition-colors duration-150 hover:bg-[rgba(145,158,171,0.08)]"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-m3-primary-lighter text-[13px] font-semibold text-m3-primary-darker">
                  {initials}
                </span>
                <span className="absolute left-[30px] top-[30px] box-content size-[9px] rounded-full border-2 border-white bg-m3-success" />
                <SolarAltArrowDown size={16} className="text-m3-grey-500" />
              </button>

              {userMenuOpen && userMenu}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer (M01) */}
      <div
        className={`fixed inset-0 z-50 md:hidden transition-all duration-300 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="fixed inset-0 bg-[rgba(28,37,46,0.48)]" onClick={() => setMobileOpen(false)} />
        <div
          className={`absolute left-0 top-0 z-10 flex h-full w-(--nav-drawer) max-w-[85vw] transform flex-col bg-white shadow-[8px_0_32px_rgba(0,0,0,0.2)] transition-transform duration-300 ease-in-out ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-[rgba(145,158,171,0.16)] pl-5 pr-3">
            <StockifyLogo />
            <button
              onClick={() => setMobileOpen(false)}
              className="grid size-10 cursor-pointer place-items-center rounded-full text-m3-grey-600 transition-colors duration-150 hover:bg-[rgba(145,158,171,0.08)]"
              aria-label="ปิดเมนู"
            >
              <SolarClose size={24} />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <p className="px-3.5 pb-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-m3-grey-500">เมนู</p>
            {/* สว่างเฉพาะเมนูที่ตรง path ยาวที่สุด กันหลายเมนู active พร้อมกัน (เช่น /production/formula) */}
            {(() => {
              const activeHref = visibleItems
                .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
                .sort((a, b) => b.href.length - a.href.length)[0]?.href;
              return visibleItems.map((item) => {
                const isActive = item.href === activeHref;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={mobileOpen ? null : false}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  className={`mb-1 flex h-[52px] items-center gap-3.5 rounded-[10px] px-3.5 text-[15px] transition-colors duration-150 ${
                    isActive
                      ? "bg-[rgba(0,167,111,0.1)] font-bold text-m3-primary-dark"
                      : "font-semibold text-m3-grey-700 hover:bg-[rgba(145,158,171,0.08)]"
                  }`}
                >
                  <span className={`flex shrink-0 ${isActive ? "text-m3-primary" : "text-m3-grey-500"}`}>
                    <NavIcon href={item.href} fallback={item.icon} size={24} />
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
              });
            })()}
          </nav>

          <div className="border-t border-[rgba(145,158,171,0.16)] p-4">
            <button
              onClick={() => tabLogout()}
              className="flex h-[52px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-[rgba(0,167,111,0.08)] text-[15px] font-bold text-m3-primary-dark transition-colors duration-150 hover:bg-[rgba(255,86,48,0.08)] hover:text-m3-error-dark"
            >
              <SolarLogout size={22} />
              ออกจากระบบ
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
