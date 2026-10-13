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
    available_menus: getSelectableMenuItems(identity).map(({ href, label }) => ({ href, label })),
    default_menu_hrefs: getVisibleNavItems(identity).filter(({ href }) => href !== MENU_SETTINGS_HREF).map(({ href }) => href),
  };
}
