import { getGrantedMenuHrefs, getGrantedPermissions } from "@/lib/menu-grants";
import { authorize, isAuthorized, PERMISSIONS, type Actor } from "@/server/security";

const actor = (role: Actor["role"], grantedPermissions?: Actor["grantedPermissions"]): Actor => ({ id: "u1", username: "u", role, warehouseAccess: "WH-01", correlationId: "c", grantedPermissions });

test("only menus outside the role grant extra permissions", () => {
  // VIEWER already sees /outbound by role → saving it must not escalate
  expect(getGrantedPermissions("VIEWER", ["/outbound"])).toEqual([]);
  expect(getGrantedMenuHrefs("APPROVER", ["/movements/transfer", "/movements/receive"])).toEqual(["/movements/receive"]);
  expect(getGrantedPermissions("APPROVER", ["/movements/receive"])).toContain(PERMISSIONS.STOCK_RECEIVE);
  expect(getGrantedPermissions("WAREHOUSE_STAFF", ["/express-import/receive"])).toEqual([PERMISSIONS.EXPRESS_IMPORT_VIEW, PERMISSIONS.EXPRESS_IMPORT_MANAGE]);
});

test("ticking the BOM editor menu does not grant production planning permissions", () => {
  expect(getGrantedPermissions("WAREHOUSE_STAFF", ["/production/formula"])).toEqual([]);
  expect(getGrantedPermissions("ADMIN", ["/production/formula"])).toEqual([]);
  expect(getGrantedMenuHrefs("WAREHOUSE_STAFF", ["/production/formula"])).toEqual([]);
});

test("system menus and unknown hrefs never grant anything", () => {
  expect(getGrantedPermissions("WAREHOUSE_STAFF", ["/users", "/login-logs", "/users/cards", "/menu-settings", "/unknown"])).toEqual([]);
  expect(getGrantedPermissions("WAREHOUSE_STAFF", null)).toEqual([]);
  expect(getGrantedPermissions("WAREHOUSE_STAFF", "not-json")).toEqual([]);
});

test("ticking express transfer or outbound upload grants the matching API permissions", () => {
  expect(getGrantedPermissions("WAREHOUSE_STAFF", ["/express-import/transfer"])).toEqual([PERMISSIONS.EXPRESS_IMPORT_VIEW, PERMISSIONS.EXPRESS_IMPORT_MANAGE]);
  expect(getGrantedPermissions("WAREHOUSE_STAFF", ["/outbound/upload"])).toEqual([PERMISSIONS.STOCK_VIEW, PERMISSIONS.OUTBOUND_IMPORT]);
  // already in the VIEWER role default — must not escalate
  expect(getGrantedPermissions("VIEWER", ["/outbound/upload"])).toEqual([PERMISSIONS.STOCK_VIEW, PERMISSIONS.OUTBOUND_IMPORT]);
});

test("authorize honors explicit grants but still enforces warehouse access", () => {
  expect(isAuthorized(actor("APPROVER"), PERMISSIONS.STOCK_RECEIVE)).toBe(false);
  const granted = actor("APPROVER", getGrantedPermissions("APPROVER", ["/movements/receive"]));
  expect(isAuthorized(granted, PERMISSIONS.STOCK_RECEIVE, "WH-01")).toBe(true);
  expect(isAuthorized(granted, PERMISSIONS.STOCK_RECEIVE, "WH-02")).toBe(false);
  expect(() => authorize(granted, PERMISSIONS.STOCK_RECEIVE, "WH-01")).not.toThrow();
  expect(() => authorize(granted, PERMISSIONS.USER_MANAGE)).toThrow();
  // removing the menu removes the grant
  expect(isAuthorized(actor("APPROVER", getGrantedPermissions("APPROVER", [])), PERMISSIONS.STOCK_RECEIVE)).toBe(false);
});