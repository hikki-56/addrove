import type { UserRole } from "@/types/models";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  staffIcon?: React.ReactNode;
  roles?: UserRole[];
}

// เมนูหมวด "ระบบ" แสดงเฉพาะบัญชีผู้ดูแลที่กำหนดไว้เท่านั้น
export const SYSTEM_MENU_EMAILS = ["ty@stockify.com"];
export const SYSTEM_MENU_HREFS = ["/users", "/login-logs", "/users/cards"];

// บัญชีแอดมินที่จำกัดเมนู — เห็นเฉพาะหน้าที่กำหนดเท่านั้น (จับคู่ด้วยชื่อบัญชี/อีเมล/ชื่อ-นามสกุล)
export const RESTRICTED_ADMIN_MENUS: { matchNames: string[]; hrefs: string[] }[] = [
  {
    // milk — ดูสินค้าทั้งหมด + ผลิตสินค้า + ใบผลิต/ยืนยันผลผลิต + ของเสีย + แก้ไขสูตร BOM
    matchNames: ["milk", "มิลค์"],
    hrefs: [
      "/products",
      "/production",
      "/production/history",
      "/production/review",
      "/production/waste",
      "/production/formula",
    ],
  },
];

/** คืนรายการเมนูที่บัญชีนี้เห็นได้ (null = ไม่ถูกจำกัด เห็นตาม role ปกติ) */
export function getAllowedMenuHrefs(
  user?: { email?: string | null; name?: string | null } | null
): string[] | null {
  if (!user) return null;
  const email = (user.email || "").trim().toLowerCase();
  if (!email) return null;
  const localPart = email.split("@")[0];
  const name = (user.name || "").trim().toLowerCase();
  for (const rule of RESTRICTED_ADMIN_MENUS) {
    const matched = rule.matchNames.some((n) => n === localPart || n === email || n === name);
    if (matched) return rule.hrefs;
  }
  return null;
}

export function isSystemMenuUser(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return SYSTEM_MENU_EMAILS.some((e) => e.toLowerCase() === normalized);
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
    // APPROVER (บัญชีแก้ว) — เบิกสินค้า + ใบผลิต
    const hrefs = ["/movements/transfer", "/production/history"];
    return navItems.filter((i) => hrefs.includes(i.href));
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
    roles: ["ADMIN", "VIEWER", "WAREHOUSE_STAFF", "PACKER"],
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
    href: "/production/review",
    label: "ยืนยันผลผลิต",
    icon: (
      <Icon>
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </Icon>
    ),
    // หน้ากรอกผลผลิตจริงและยืนยันตัดสต็อก — เห็นเฉพาะ "คนตรวจ" (ดูเพิ่มที่ production-reviewers.ts) คุมด้วยชื่อบัญชี ไม่ใช่ role
    roles: ["ADMIN", "MANAGER", "WAREHOUSE_STAFF", "STAFF"],
  },
  {
    href: "/production/formula",
    label: "แก้ไขสูตร BOM",
    icon: (
      <Icon>
        <path d="M10 2v7.5a2 2 0 0 1-.4 1.2L4.7 16.9A2 2 0 0 0 6.3 20h11.4a2 2 0 0 0 1.6-3.1l-4.9-6.2a2 2 0 0 1-.4-1.2V2" />
        <path d="M8.5 2h7" />
        <path d="M7 16h10" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/production/history",
    label: "ใบผลิต",
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
    roles: ["ADMIN", "APPROVER"],
  },
  {
    href: "/production/waste",
    label: "ของเสีย",
    icon: (
      <Icon>
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" x2="10" y1="11" y2="17" />
        <line x1="14" x2="14" y1="11" y2="17" />
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
    href: "/temporary-stock-cuts",
    label: "ตัดสต็อกชั่วคราว",
    icon: (
      <Icon>
        <circle cx="6" cy="6" r="3" />
        <path d="M8.12 8.12 12 12" />
        <path d="M20 4 8.12 15.88" />
        <circle cx="6" cy="18" r="3" />
        <path d="M14.8 14.8 20 20" />
      </Icon>
    ),
    roles: ["ADMIN"],
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
  // ---- ส่งของออก: บิลจาก Express → หยิบ → แพ็ก → ขึ้นรถ ----
  {
    href: "/outbound",
    label: "ส่งของออก (บิล)",
    icon: (
      <Icon>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="m9 15 2 2 4-4" />
      </Icon>
    ),
    roles: ["ADMIN", "MANAGER", "VIEWER"],
  },
  {
    href: "/outbound/work-orders",
    label: "กล่อง Q (QR Code)",
    icon: (
      <Icon>
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="M12 22V12" />
        <path d="m3.3 7 8.7 5 8.7-5" />
      </Icon>
    ),
    roles: ["ADMIN"],
  },
  {
    href: "/outbound/pick",
    label: "หยิบของ",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="m12 2v3" />
        <path d="m12 19v3" />
        <path d="m2 12h3" />
        <path d="m19 12h3" />
      </Icon>
    ),
    staffIcon: (
      <div className="w-5 h-5 rounded bg-[#F3F6F4] border border-[#E8ECEA] flex items-center justify-center p-0.5">
        <svg className="w-4 h-4 text-[#475467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} cx="12" cy="12" r="8" />
          <circle strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} cx="12" cy="12" r="3" />
        </svg>
      </div>
    ),
    roles: ["ADMIN", "WAREHOUSE_STAFF", "PACKER"],
  },
  {
    href: "/outbound/pack",
    label: "แพ็กใส่กล่อง",
    icon: (
      <Icon>
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="M12 22V12" />
        <path d="m3.3 7 8.7 5 8.7-5" />
      </Icon>
    ),
    staffIcon: (
      <div className="w-5 h-5 rounded bg-[#F3F6F4] border border-[#E8ECEA] flex items-center justify-center p-0.5">
        <svg className="w-4 h-4 text-[#475467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 22V12" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m3.3 7 8.7 5 8.7-5" />
        </svg>
      </div>
    ),
    roles: ["ADMIN", "WAREHOUSE_STAFF", "PACKER"],
  },
  {
    href: "/outbound/loading",
    label: "ของขึ้นรถ",
    icon: (
      <Icon>
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18h-5" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35a1 1 0 0 0-.78-.38H16" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="18" r="2" />
      </Icon>
    ),
    staffIcon: (
      <div className="w-5 h-5 rounded bg-[#F3F6F4] border border-[#E8ECEA] flex items-center justify-center p-0.5">
        <svg className="w-4 h-4 text-[#475467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35a1 1 0 0 0-.78-.38H16" />
          <circle strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} cx="7" cy="18" r="2" />
          <circle strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} cx="17" cy="18" r="2" />
        </svg>
      </div>
    ),
    roles: ["ADMIN", "MANAGER", "WAREHOUSE_STAFF", "PACKER"],
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
