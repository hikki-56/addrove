// เมนู "ระบุตำแหน่งสินค้า" — สิทธิ์ใช้ร่วมกันทั้ง client และ server
import type { UserRole } from "@/types/models";

export const ASSIGN_LOCATION_HREF = "/movements/assign-location";
/** แอดมินบัญชีเดียวที่เห็นเมนูนี้ (แอดมินอื่นถูกปฏิเสธ 403) */
export const ASSIGN_LOCATION_ADMIN_EMAIL = "ty@stockify.com";

/** พนักงานทุกบทบาท (ยกเว้น VIEWER) ใช้ได้; ADMIN ใช้ได้เฉพาะ ty@stockify.com */
export function canAssignLocation(role?: UserRole | string | null, email?: string | null): boolean {
  if (!role || role === "VIEWER") return false;
  if (role === "ADMIN") {
    return typeof email === "string" && email.trim().toLowerCase() === ASSIGN_LOCATION_ADMIN_EMAIL;
  }
  return true;
}

export interface AssignRow {
  to_location_id: string;
  qty: number;
}

/** ส่วนต่างที่ต้อง ADJUST เพื่อตั้งยอดตำแหน่ง = จำนวนที่นับ − ยอดปัจจุบัน (0 = ไม่ต้องบันทึก) */
export function assignAdjustDelta(entered: number, current: number): number {
  return entered - current;
}

export interface SnapshotCurrent {
  location_key: string; // location_code ("" = ไม่ระบุ) — ห้ามใส่ location_id แทนรหัสว่าง
  location_id: string;
  quantity: number;
}

export interface SnapshotTarget {
  location_id: string;
  location_key: string;
  target: number;
  current: number;
  delta: number;
}

/**
 * สแนปช็อตโกดัง: ตำแหน่งที่กรอก = ยอดที่กรอก, ตำแหน่งอื่นของสินค้าในโกดังเดียวกัน (รวมไม่ระบุ) = 0
 */
export function buildAssignSnapshot(
  rows: AssignRow[],
  currents: SnapshotCurrent[]
): SnapshotTarget[] {
  const entered = new Map<string, number>();
  for (const r of rows) {
    const key = r.to_location_id.trim().toUpperCase();
    if (key) entered.set(key, r.qty);
  }
  // location_key = location_code ("" = ไม่ระบุ). อย่าใส่ location_id แทนรหัสว่าง — ADJUST ต้องใช้ location_id จริง
  const byCode = new Map<string, SnapshotCurrent>();
  for (const c of currents) {
    byCode.set((c.location_key || "").trim().toUpperCase(), c);
  }
  const out = new Map<string, SnapshotTarget>();
  for (const c of currents) {
    const code = (c.location_key || "").trim().toUpperCase();
    const target = entered.has(code) ? entered.get(code)! : 0;
    const delta = assignAdjustDelta(target, c.quantity);
    out.set(c.location_id, {
      location_id: c.location_id,
      location_key: code,
      target,
      current: c.quantity,
      delta,
    });
  }
  for (const [code, qty] of entered) {
    if (byCode.has(code)) continue;
    out.set(code, { location_id: code, location_key: code, target: qty, current: 0, delta: qty });
  }
  return [...out.values()];
}

/** ตรวจแถวก่อนบันทึก — คืนข้อความผิดพลาด (ว่าง = ผ่าน). จำนวน = ยอดที่ตั้งที่ตำแหน่งนั้น */
export function validateAssignRows(rows: AssignRow[]): string[] {
  const errors: string[] = [];
  if (!rows.length) errors.push("กรุณาเพิ่มตำแหน่งอย่างน้อย 1 รายการ");
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const code = r.to_location_id.trim().toUpperCase();
    if (!code) errors.push(`แถวที่ ${i + 1}: กรุณาระบุตำแหน่ง`);
    else if (seen.has(code)) errors.push(`แถวที่ ${i + 1}: ตำแหน่ง ${code} ซ้ำ`);
    seen.add(code);
    if (!Number.isInteger(r.qty) || r.qty <= 0) errors.push(`แถวที่ ${i + 1}: จำนวนต้องเป็นจำนวนเต็มมากกว่า 0`);
  });
  return errors;
}

export const ASSIGN_LOCATION_REQUESTS_HREF = "/movements/assign-location/requests";

/**
 * ผู้อนุมัติคำขอระบุตำแหน่ง: ผู้ใช้ role ADMIN ทุกคน
 * ฝั่ง API ต้องใช้ role จาก DB เสมอ ไม่เชื่อ client/session
 */
export function canApproveAssignLocation(role?: UserRole | string | null): boolean {
  return role === "ADMIN";
}


/** 2 เมนูระบุตำแหน่ง — ตั้งค่าได้ในเมนูผู้ใช้ (ค่าเริ่มต้นตาม canAssignLocation) */
export const ASSIGN_MENU_HREFS = ["/movements/assign-location", "/movements/assign-location/requests"] as const;
export const ASSIGN_MENU_LABELS: Record<string, string> = {
  "/movements/assign-location": "ระบุตำแหน่งสินค้า",
  "/movements/assign-location/requests": "คำขอระบุตำแหน่ง",
};
/** สิทธิ์อนุมัติคำขอระบุตำแหน่ง — รายการในตั้งค่าเมนูเท่านั้น (ไม่ใช่ลิงก์ใน sidebar) ค่าเริ่มต้นปิด */
export const ASSIGN_APPROVE_HREF = "/movements/assign-location/requests#approve";
export const ASSIGN_APPROVE_LABEL = "อนุมัติคำขอระบุตำแหน่ง";
/** รายการ "เอาออก" ที่บันทึกใน menu_hrefs เพื่อปิดเมนูที่บทบาทเห็นเป็นค่าเริ่มต้น */
export function menuExclusion(href: string): string {
  return `/!${href}`;
}

export interface AssignLocationAccess {
  /** ค่าเริ่มต้นตามบทบาท (ก่อนตั้งค่าเมนูผู้ใช้) */
  roleDefault: boolean;
  /** เห็นเมนู + ใช้หน้า/สร้างคำขอระบุตำแหน่ง */
  assign: boolean;
  /** เห็นเมนูคำขอระบุตำแหน่ง */
  requests: boolean;
  /** ดูคำขอทุกคน + อนุมัติ/ไม่อนุมัติ (ADMIN ทุกคน หรือได้รับสิทธิ์ "อนุมัติคำขอระบุตำแหน่ง") */
  approve: boolean;
}

/**
 * menuHrefs: null = ค่าเริ่มต้น; มีรายการ = ติ๊กเพิ่ม (href) หรือเอาออก (menuExclusion(href))
 * verifiedAdmin: ADMIN ต้องยืนยันบัญชีจากเซิร์ฟเวอร์แล้ว (ty) ถึงได้ค่าเริ่มต้น
 */
export function getAssignLocationAccess(
  role: UserRole | string | null | undefined,
  email: string | null | undefined,
  menuHrefs: readonly string[] | null | undefined,
  verifiedAdmin = true
): AssignLocationAccess {
  const [assignHref, requestsHref] = ASSIGN_MENU_HREFS;
  const roleDefault = canAssignLocation(role, email) && (role !== "ADMIN" || verifiedAdmin);
  const has = (h: string) => !!menuHrefs?.includes(h);
  const excluded = (h: string) => !!menuHrefs?.includes(menuExclusion(h));
  const approve = canApproveAssignLocation(role) || has(ASSIGN_APPROVE_HREF);
  return {
    roleDefault,
    assign: (roleDefault && !excluded(assignHref)) || has(assignHref),
    // ผู้อนุมัติเห็นเมนูคำขอเสมอ (เพื่อเข้าหน้าอนุมัติได้)
    requests: (roleDefault && !excluded(requestsHref)) || has(requestsHref) || has(ASSIGN_APPROVE_HREF),
    approve,
  };
}
