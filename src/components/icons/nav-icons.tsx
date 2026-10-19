// ไอคอนเมนู Solar ตาม href — Sidebar / drawer ใช้แทนไอคอน Lucide ใน nav-items.tsx
// (nav-items คงไว้เหมือนเดิมทั้งรายการ/สิทธิ์/ลำดับ — map นี้เปลี่ยนแค่หน้าตาไอคอน
//  เมนูที่ไม่มีใน map จะใช้ไอคอนเดิมจาก nav-items)
import type { ComponentType } from "react";
import {
  SolarBill,
  SolarBox,
  SolarBoxClosed,
  SolarBus,
  SolarCalendarPlan,
  SolarCart,
  SolarChart,
  SolarDocumentCheck,
  SolarExpressIn,
  SolarExpressOut,
  SolarFactory,
  SolarHistory,
  SolarHome,
  SolarInboxHistory,
  SolarInboxIn,
  SolarLoginHistory,
  SolarMapPoint,
  SolarNavigationArrow,
  SolarOutboxHistory,
  SolarQrCode,
  SolarScissors,
  SolarTagBarcode,
  SolarTransferHorizontal,
  SolarTuning,
  SolarUsers,
  type SolarIconProps,
} from "./solar";

export const NAV_ICONS: Record<string, ComponentType<SolarIconProps>> = {
  "/dashboard": SolarHome,
  "/products": SolarBox,
  "/approvals": SolarDocumentCheck,
  "/locations": SolarMapPoint,
  "/warehouses/qr": SolarQrCode,
  "/shelves/qr": SolarTagBarcode,
  "/movements/receive": SolarInboxIn,
  "/staff/receive": SolarInboxIn,
  "/movements/transfer": SolarTransferHorizontal,
  "/staff/transfer": SolarTransferHorizontal,
  "/movements/move": SolarNavigationArrow,
  "/staff/move": SolarNavigationArrow,
  "/temporary-stock-cuts": SolarScissors,
  "/movements/receive/history": SolarInboxHistory,
  "/movements/transfer/history": SolarOutboxHistory,
  "/movements/history": SolarHistory,
  "/production": SolarCalendarPlan,
  "/production/jobs": SolarFactory,
  "/production/summary": SolarChart,
  "/outbound": SolarBill,
  "/outbound/work-orders": SolarQrCode,
  "/outbound/pick": SolarCart,
  "/outbound/pack": SolarBoxClosed,
  "/outbound/loading": SolarBus,
  "/express-import/receive": SolarExpressIn,
  "/express-import/issue": SolarExpressOut,
  "/users": SolarUsers,
  "/login-logs": SolarLoginHistory,
  "/menu-settings": SolarTuning,
};

export function NavIcon({
  href,
  fallback,
  size = 22,
  className,
}: {
  href: string;
  fallback?: React.ReactNode;
  size?: number;
  className?: string;
}) {
  const Icon = NAV_ICONS[href];
  if (!Icon) return <>{fallback ?? null}</>;
  return <Icon size={size} className={className} />;
}
