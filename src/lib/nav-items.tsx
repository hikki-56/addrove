import type { UserRole } from "@/types/models";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  staffIcon?: React.ReactNode;
  roles?: UserRole[];
}

// ไอคอนแบบ Lucide (inline SVG — ไม่ติดตั้ง library ตามกติกา stockify-ui)
function Icon({ children, className = "w-[18px] h-[18px]" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function getNavItems(role?: UserRole): NavItem[] {
  if (role === "APPROVER") {
    const transferItem = navItems.find((i) => i.href === "/movements/transfer");
    return transferItem ? [transferItem] : [];
  }
  const isAdmin = role === "ADMIN";
  return navItems.map((item) => {
    if (!isAdmin) {
      if (item.href === "/movements/receive") return { ...item, href: "/staff/receive" };
      if (item.href === "/movements/move") return { ...item, href: "/staff/move" };
      if (item.href === "/movements/transfer") return { ...item, href: "/staff/transfer" };
    }
    return item;
  });
}

export const navItems: NavItem[] = [
  {
    href: "/dashboard",
    label: "หน้าหลัก",
    icon: (
      <Icon>
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <rect width="7" height="5" x="14" y="3" rx="1" />
        <rect width="7" height="9" x="14" y="12" rx="1" />
        <rect width="7" height="5" x="3" y="18" rx="1" />
      </Icon>
    ),
    staffIcon: (
      <div className="w-5 h-5 rounded bg-[#F3F6F4] border border-[#E8ECEA] flex items-center justify-center p-0.5">
        <svg className="w-4 h-4 text-[#475467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      </div>
    ),
    roles: ["ADMIN", "VIEWER", "WAREHOUSE_STAFF"],
  },
  {
    href: "/movements/receive",
    label: "รับสินค้าเข้าโกดัง",
    icon: (
      <Icon>
        <path d="M16 16h6" />
        <path d="M19 13v6" />
        <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
        <path d="m7.5 4.27 9 5.15" />
        <polyline points="3.29 7 12 12 20.71 7" />
        <line x1="12" x2="12" y1="22" y2="12" />
      </Icon>
    ),
    staffIcon: (
      <div className="w-5 h-5 rounded bg-[#F3F6F4] border border-[#E8ECEA] flex items-center justify-center p-0.5">
        <svg className="w-4 h-4 text-[#475467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      </div>
    ),
    roles: ["ADMIN", "WAREHOUSE_STAFF"],
  },
  {
    href: "/movements/receive/history",
    label: "ประวัติรับสินค้าเข้าโกดัง",
    icon: (
      <Icon>
        <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="M12 11h4" />
        <path d="M12 16h4" />
        <path d="M8 11h.01" />
        <path d="M8 16h.01" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/production",
    label: "ผลิตสินค้า",
    icon: (
      <Icon>
        <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
        <path d="M17 18h1" />
        <path d="M12 18h1" />
        <path d="M7 18h1" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/production/history",
    label: "ประวัติการสั่งผลิต",
    icon: (
      <Icon>
        <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="M12 11h4" />
        <path d="M12 16h4" />
        <path d="M8 11h.01" />
        <path d="M8 16h.01" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/movements/move",
    label: "จัดตำแหน่งสินค้า",
    icon: (
      <Icon>
        <path d="M8 3 4 7l4 4" />
        <path d="M4 7h16" />
        <path d="m16 21 4-4-4-4" />
        <path d="M20 17H4" />
      </Icon>
    ),
    staffIcon: (
      <div className="w-5 h-5 rounded bg-[#F3F6F4] border border-[#E8ECEA] flex items-center justify-center p-0.5">
        <svg className="w-4 h-4 text-[#475467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </div>
    ),
    roles: ["ADMIN", "WAREHOUSE_STAFF"],
  },
  {
    href: "/movements/transfer",
    label: "เบิกสินค้า",
    icon: (
      <Icon>
        <path d="M16 16h6" />
        <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </Icon>
    ),
    staffIcon: (
      <div className="w-5 h-5 rounded bg-[#F3F6F4] border border-[#E8ECEA] flex items-center justify-center p-0.5">
        <svg className="w-4 h-4 text-[#475467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      </div>
    ),
    roles: ["ADMIN", "WAREHOUSE_STAFF", "APPROVER"],
  },
  {
    href: "/movements/transfer/history",
    label: "ประวัติเบิกสินค้า",
    icon: (
      <Icon>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M10 9H8" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/products",
    label: "สินค้าทั้งหมด",
    icon: (
      <Icon>
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </Icon>
    ),
    staffIcon: (
      <div className="w-5 h-5 rounded bg-[#F3F6F4] border border-[#E8ECEA] flex items-center justify-center p-0.5">
        <svg className="w-4 h-4 text-[#475467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
    ),
    roles: ["ADMIN", "VIEWER", "WAREHOUSE_STAFF"],
  },
  {
    href: "/approvals",
    label: "อนุมัติการรับเข้า",
    icon: (
      <Icon>
        <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="m9 14 2 2 4-4" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/movements/history",
    label: "ประวัติการเคลื่อนไหว",
    icon: (
      <Icon>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </Icon>
    ),
    roles: ["ADMIN", "VIEWER"],
  },
  {
    href: "/locations",
    label: "ตำแหน่งสินค้าในโกดัง",
    icon: (
      <Icon>
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/warehouses/qr",
    label: "QR Code คลังสินค้า",
    icon: (
      <Icon>
        <rect width="5" height="5" x="3" y="3" rx="1" />
        <rect width="5" height="5" x="16" y="3" rx="1" />
        <rect width="5" height="5" x="3" y="16" rx="1" />
        <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
        <path d="M21 21v.01" />
        <path d="M12 7v3a2 2 0 0 1-2 2H7" />
        <path d="M3 12h.01" />
        <path d="M12 3h.01" />
        <path d="M12 16h.01" />
        <path d="M16 12h1" />
        <path d="M21 12v.01" />
        <path d="M12 21v-1" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/shelves/qr",
    label: "บาร์โค้ดชั้นวางสินค้า",
    icon: (
      <Icon>
        <path d="M3 5v14" />
        <path d="M8 5v14" />
        <path d="M12 5v14" />
        <path d="M17 5v14" />
        <path d="M22 5v14" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/users",
    label: "จัดการพนักงาน",
    icon: (
      <Icon>
        <path d="M18 21a8 8 0 0 0-16 0" />
        <circle cx="10" cy="8" r="5" />
        <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/login-logs",
    label: "ประวัติการเข้าระบบ",
    icon: (
      <Icon>
        <path d="M16 22h2a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v2.5" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <circle cx="8" cy="16" r="6" />
        <path d="M9.585 18.499 8 17l1.414-1.414" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/express-import/receive",
    label: "รับสินค้า เข้า Express",
    icon: (
      <Icon>
        <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/express-import/issue",
    label: "เบิกสินค้า เข้า Express",
    icon: (
      <Icon>
        <path d="M12 22v-9" />
        <path d="M15.51 17.32 12 22l-3.51-4.68" />
        <path d="M6.76 18.32 3 22V8l3.5 2.68" />
        <path d="M21 8v14l-3.76-3.68" />
        <path d="m3.76 10.68 7.16-3.57a2 2 0 0 1 1.79 0l7.23 3.61a1 1 0 0 1 0 1.79l-7.27 3.63a2 2 0 0 1-1.78 0z" />
        <path d="m6.5 6.5 11.5 5.5" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
];
