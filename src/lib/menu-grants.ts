// สิทธิ์ที่ได้จากการติ๊กเมนูใน "ตั้งค่าเมนูผู้ใช้" (users.menu_hrefs) — ใช้ทั้งฝั่งเมนูและฝั่ง API guard
// ให้สิทธิ์เพิ่มเฉพาะเมนูที่ "อยู่นอก" บทบาทของผู้ใช้เท่านั้น เมนูที่บทบาทเห็นอยู่แล้วไม่เพิ่มสิทธิ์ใด ๆ
// (กันไม่ให้การบันทึกรายการเมนูเดิมของบทบาทกลายเป็นการยกระดับสิทธิ์โดยไม่ตั้งใจ)
import type { UserRole } from "@/types/models";
import { PERMISSIONS, type Permission } from "@/server/security/permissions";
import { getAllMenuItems, SYSTEM_MENU_HREFS } from "@/components/layout/nav-items";
import { parseMenuHrefs } from "@/lib/menu-visibility";

const P = PERMISSIONS;
const RECEIVE = [P.STOCK_VIEW, P.DOCUMENT_VIEW, P.STOCK_RECEIVE];
const MOVE = [P.STOCK_VIEW, P.STOCK_MOVE];
const TRANSFER = [P.STOCK_VIEW, P.DOCUMENT_VIEW, P.STOCK_TRANSFER_CREATE];
const EXPRESS = [P.EXPRESS_IMPORT_VIEW, P.EXPRESS_IMPORT_MANAGE];

/** เมนู → สิทธิ์ที่หน้าและ API ของเมนูนั้นต้องใช้ (เมนูระบบของ ty ไม่อยู่ในตารางนี้ จึงให้สิทธิ์ไม่ได้) */
export const MENU_GRANT_PERMISSIONS: Record<string, readonly Permission[]> = {
  "/dashboard": [P.STOCK_VIEW],
  "/movements/receive": RECEIVE,
  "/staff/receive": RECEIVE,
  "/movements/receive/history": [P.STOCK_VIEW, P.DOCUMENT_VIEW],
  "/production": [P.PRODUCTION_VIEW, P.PRODUCTION_MANAGE],
  "/production/jobs": [P.PRODUCTION_VIEW, P.PRODUCTION_REPORT],
  "/production/summary": [P.PRODUCTION_VIEW],
  "/movements/move": MOVE,
  "/staff/move": MOVE,
  "/movements/transfer": TRANSFER,
  "/staff/transfer": TRANSFER,
  "/temporary-stock-cuts": [P.STOCK_VIEW],
  "/movements/transfer/history": [P.STOCK_VIEW, P.DOCUMENT_VIEW],
  "/outbound": [P.STOCK_VIEW, P.OUTBOUND_IMPORT, P.OUTBOUND_APPROVE],
  "/outbound/work-orders": [P.STOCK_VIEW, P.OUTBOUND_APPROVE],
  "/outbound/pick": [P.STOCK_VIEW, P.STOCK_ISSUE, P.OUTBOUND_SHIP],
  "/outbound/pack": [P.STOCK_VIEW, P.STOCK_ISSUE, P.OUTBOUND_SHIP],
  "/outbound/loading": [P.STOCK_VIEW, P.OUTBOUND_SHIP],
  "/products": [P.STOCK_VIEW],
  "/approvals": [P.DOCUMENT_VIEW, P.DOCUMENT_APPROVE, P.DOCUMENT_REJECT],
  "/movements/history": [P.STOCK_VIEW, P.DOCUMENT_VIEW],
  "/locations": [P.STOCK_VIEW, P.LOCATION_MANAGE],
  "/warehouses/qr": [P.STOCK_VIEW],
  "/shelves/qr": [P.STOCK_VIEW, P.LOCATION_MANAGE],
  "/express-import/receive": EXPRESS,
  "/express-import/issue": EXPRESS,
};

/** เมนูที่ติ๊กให้แต่ไม่อยู่ในบทบาท (= การให้สิทธิ์เพิ่ม) */
export function getGrantedMenuHrefs(role: UserRole, menuHrefs: unknown): string[] {
  const hrefs = parseMenuHrefs(menuHrefs);
  if (!hrefs || hrefs.length === 0) return [];
  const items = getAllMenuItems(role);
  return hrefs.filter((href) => {
    if (SYSTEM_MENU_HREFS.includes(href) || !MENU_GRANT_PERMISSIONS[href]) return false;
    const item = items.find((i) => i.href === href);
    if (!item) return false;
    return !!item.roles && !item.roles.includes(role);
  });
}

export function getGrantedPermissions(role: UserRole, menuHrefs: unknown): Permission[] {
  const out = new Set<Permission>();
  for (const href of getGrantedMenuHrefs(role, menuHrefs)) {
    for (const p of MENU_GRANT_PERMISSIONS[href] ?? []) out.add(p);
  }
  return [...out];
}