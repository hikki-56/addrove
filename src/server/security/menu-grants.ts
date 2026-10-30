// โหลดสิทธิ์จากเมนูที่ ty ให้เพิ่ม (users.menu_hrefs) ของผู้ใช้คนนี้ — อ่านอย่างเดียว แคชสั้น ๆ ต่อ process
import type { UserRole } from "@/types/models";
import type { Permission } from "./permissions";
import { getGrantedPermissions } from "@/lib/menu-grants";

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; role: UserRole; perms: Permission[] }>();

export function clearMenuGrantCache(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export async function loadGrantedPermissions(userId: string | undefined, role: UserRole): Promise<Permission[]> {
  if (!userId || role === "ADMIN") return [];
  const hit = cache.get(userId);
  if (hit && hit.role === role && Date.now() - hit.at < TTL_MS) return hit.perms;
  try {
    const { getRepository } = await import("@/server/repositories");
    const user = await getRepository().users.findById(userId);
    // บทบาทใน token ต้องตรงกับฐานข้อมูล และบัญชีต้องเปิดใช้งาน ไม่งั้นไม่ให้สิทธิ์เพิ่ม
    const perms = user && user.active && user.role === role ? getGrantedPermissions(role, user.menu_hrefs) : [];
    cache.set(userId, { at: Date.now(), role, perms });
    return perms;
  } catch {
    return [];
  }
}

/** ใช้กับ route ที่เช็ก role แบบ inline (เช่น role !== "ADMIN") ให้ยอมรับการให้สิทธิ์ผ่านเมนูด้วย */
export async function hasGrantedPermission(userId: string | undefined, role: UserRole | string | undefined, permission: Permission): Promise<boolean> {
  if (!role) return false;
  return (await loadGrantedPermissions(userId, role as UserRole)).includes(permission);
}