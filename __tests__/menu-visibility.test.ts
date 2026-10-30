import { canManageUserMenus, parseMenuHrefs, MENU_SETTINGS_HREF } from "@/lib/menu-visibility";
import { BOM_EDITOR_HREF } from "@/lib/bom-editor";
import { ASSIGN_LOCATION_HREF, ASSIGN_LOCATION_REQUESTS_HREF } from "@/lib/assign-location";
import { getVisibleNavItems, getSelectableMenuItems } from "@/components/layout/nav-items";

const admin = { role: "ADMIN" as const, email: "other@stockify.com", name: "ทิชากร" };
const owner = { ...admin, email: "ty@stockify.com" };
const hrefs = (user: typeof admin, menus?: string[] | null) => getVisibleNavItems(user, menus).map(({ href }) => href);

test("only the exact owner email manages menus, never a display name or prefix", () => {
  expect(canManageUserMenus(" TY@Stockify.com ")).toBe(true);
  expect(canManageUserMenus(admin.email)).toBe(false);
  expect(canManageUserMenus("ty@other.com")).toBe(false);
  expect(canManageUserMenus("ty@stockify.com.evil.invalid")).toBe(false);
  expect(canManageUserMenus(null)).toBe(false);
});

test("unset settings preserve existing menus; empty settings hide all optional menus", () => {
  expect(hrefs(admin, null)).toContain("/products");
  expect(hrefs(admin, [])).toEqual([]);
  expect(hrefs(admin, ["/products"])).toEqual(["/products"]);
  expect(hrefs(owner, [])).toEqual([ASSIGN_LOCATION_HREF, ASSIGN_LOCATION_REQUESTS_HREF, BOM_EDITOR_HREF, MENU_SETTINGS_HREF]);
  expect(hrefs(admin, null)).not.toContain(ASSIGN_LOCATION_HREF);
  expect(hrefs(admin, null)).not.toContain(BOM_EDITOR_HREF);
  expect(getVisibleNavItems(owner, [], false)).toEqual([]);
});

test("legacy milk defaults apply until an explicit menu list is saved", () => {
  const milk = { ...admin, email: "milk@stockify.com" };
  expect(hrefs(milk)).toEqual(["/products"]);
  expect(hrefs(milk, ["/dashboard"])).toEqual(["/dashboard"]);
});

test("every non-system menu is selectable for every role; ticking one outside the role shows it", () => {
  const staff = { ...admin, role: "WAREHOUSE_STAFF" as const };
  expect(getVisibleNavItems(staff, ["/staff/receive", "/users", "/express-import/issue", MENU_SETTINGS_HREF]).map(({ href }) => href)).toEqual(["/staff/receive", "/express-import/issue", ASSIGN_LOCATION_HREF, ASSIGN_LOCATION_REQUESTS_HREF]);
  expect(getVisibleNavItems(staff, null).map(({ href }) => href)).toContain(ASSIGN_LOCATION_HREF);
  expect(getVisibleNavItems(staff, null).map(({ href }) => href)).not.toContain("/express-import/issue");
  expect(getSelectableMenuItems(staff).some(({ href }) => href === "/movements/receive")).toBe(false);
  expect(getSelectableMenuItems(staff).map(({ href }) => href)).toEqual(expect.arrayContaining(["/staff/receive", "/approvals", "/locations", "/production"]));
  expect(getSelectableMenuItems(staff).map(({ href }) => href)).not.toContain("/users");
  expect(hrefs(admin, ["/users", "/login-logs"])).toEqual([]);
  expect(hrefs(owner, ["/users"])).toContain("/users");
});

test("APPROVER keeps its two default menus and can be granted any other", () => {
  const kaew = { role: "APPROVER" as const, email: "kaew@stockify.com" };
  expect(getVisibleNavItems(kaew, null).map(({ href }) => href).slice(0, 2)).toEqual(["/production/jobs", "/movements/transfer"]);
  expect(getVisibleNavItems(kaew, null).map(({ href }) => href)).not.toContain("/movements/receive");
  const selectable = getSelectableMenuItems(kaew).map(({ href }) => href);
  expect(selectable.slice(0, 2)).toEqual(["/production/jobs", "/movements/transfer"]);
  expect(selectable).toContain("/movements/receive");
  expect(getVisibleNavItems(kaew, ["/movements/receive"]).map(({ href }) => href)[0]).toBe("/movements/receive");
});

test("storage parsing distinguishes defaults from empty or malformed values", () => {
  expect(parseMenuHrefs(undefined)).toBeNull();
  expect(parseMenuHrefs("")).toBeNull();
  expect(parseMenuHrefs("[]")).toEqual([]);
  expect(parseMenuHrefs('["/products","/products"]')).toEqual(["/products"]);
  expect(parseMenuHrefs("invalid-json")).toEqual([]);
  expect(parseMenuHrefs('["/products", 123]')).toEqual([]);
});
