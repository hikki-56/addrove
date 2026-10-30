import { getAllMenuItems, getSelectableMenuItems, getVisibleNavItems } from "@/components/layout/nav-items";
import { parseMenuHrefs, MENU_SETTINGS_HREF } from "@/lib/menu-visibility";
import type { User } from "@/types/models";
import { ASSIGN_MENU_HREFS, ASSIGN_MENU_LABELS, getAssignLocationAccess } from "@/lib/assign-location";
import type { UserMenuSettings } from "@/types/menu-settings";

export function toUserMenuSettings(user: User): UserMenuSettings {
  const identity = { email: user.email, name: user.full_name, role: user.role };
  const saved = parseMenuHrefs(user.menu_hrefs);
  const assignDefault = getAssignLocationAccess(user.role, user.email, null).roleDefault;
  return {
    user_id: user.user_id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    active: user.active,
    menu_hrefs: parseMenuHrefs(user.menu_hrefs),
    // outside_role = ติ๊กแล้วเป็นการให้สิทธิ์เพิ่ม (หน้า + API ของเมนูนั้นจะยอมรับผู้ใช้คนนี้)
    // ทุกคนเห็นรายการเมนูครบชุดเดียวกัน; เมนูระบบเฉพาะ ty แสดงแต่ล็อกไว้ (locked) ติ๊กไม่ได้
    available_menus: (() => {
      const selectable = new Set(getSelectableMenuItems(identity).map(({ href }) => href));
      const items = getAllMenuItems(user.role).map(({ href, label, roles }) => ({
        href,
        label,
        outside_role: !!roles && !roles.includes(user.role),
        ...(selectable.has(href) ? {} : { locked: true }),
      }));
      // 2 เมนูระบุตำแหน่ง ต่อท้ายเมนูจัดตำแหน่งสินค้า (ไม่อยู่ใน navItems)
      const at = items.findIndex((i) => i.href === "/movements/move" || i.href === "/staff/move");
      items.splice(at >= 0 ? at + 1 : items.length, 0, ...ASSIGN_MENU_HREFS.map((href) => ({
        href, label: ASSIGN_MENU_LABELS[href], outside_role: !assignDefault,
      })));
      return items;
    })(),
    default_menu_hrefs: getVisibleNavItems(identity).filter(({ href }) => href !== MENU_SETTINGS_HREF).map(({ href }) => href),
    // เมนูที่ผู้ใช้เห็นอยู่ตอนนี้ (ใช้เป็นสถานะติ๊กเริ่มต้นในหน้าตั้งค่า)
    current_menu_hrefs: saved === null ? undefined : getVisibleNavItems(identity, saved).filter(({ href }) => href !== MENU_SETTINGS_HREF).map(({ href }) => href),
  };
}
