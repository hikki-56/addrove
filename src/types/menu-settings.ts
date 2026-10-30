import type { UserRole } from "@/types/models";

export interface UserMenuSettings {
  user_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
  menu_hrefs: string[] | null;
  available_menus: { href: string; label: string; outside_role?: boolean; locked?: boolean }[];
  default_menu_hrefs: string[];
}

export interface MyMenuSettings {
  menu_hrefs: string[] | null;
  can_manage: boolean;
}
