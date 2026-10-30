import { getSelectableMenuItems, getVisibleNavItems } from "@/components/layout/nav-items";
import { parseMenuHrefs, MENU_SETTINGS_HREF } from "@/lib/menu-visibility";
import type { User } from "@/types/models";
import type { UserMenuSettings } from "@/types/menu-settings";

export function toUserMenuSettings(user: User): UserMenuSettings {
  const identity = { email: user.email, name: user.full_name, role: user.role };
  return {
    user_id: user.user_id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    active: user.active,
    menu_hrefs: parseMenuHrefs(user.menu_hrefs),
    // outside_role = ติ๊กแล้วเป็นการให้สิทธิ์เพิ่ม (หน้า + API ของเมนูนั้นจะยอมรับผู้ใช้คนนี้)
    available_menus: getSelectableMenuItems(identity).map(({ href, label, roles }) => ({ href, label, outside_role: !!roles && !roles.includes(user.role) })),
    default_menu_hrefs: getVisibleNavItems(identity).filter(({ href }) => href !== MENU_SETTINGS_HREF).map(({ href }) => href),
  };
}
