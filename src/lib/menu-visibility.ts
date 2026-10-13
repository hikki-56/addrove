export const MENU_SETTINGS_HREF = "/menu-settings";

/** Compare the authenticated account, never a display name or email prefix. */
export function canManageUserMenus(email?: string | null): boolean {
  return email?.trim().toLowerCase() === "ty@stockify.com";
}

/** null preserves existing defaults; [] deliberately hides every optional menu. */
export function parseMenuHrefs(value: unknown): string[] | null {
  if (value === undefined || value === null || value === "") return null;
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed) || !parsed.every((href) => typeof href === "string" && href.startsWith("/"))) return [];
    return [...new Set(parsed)];
  } catch {
    return [];
  }
}
