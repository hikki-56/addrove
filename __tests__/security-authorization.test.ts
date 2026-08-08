import {
  authorize,
  isAuthorized,
  UnauthorizedError,
  ForbiddenError,
  PERMISSIONS,
  Actor,
} from "@/lib/security";

describe("Centralized Security & Authorization Tests", () => {
  const adminActor: Actor = {
    id: "usr-admin",
    username: "admin",
    role: "ADMIN",
    warehouseAccess: "",
    correlationId: "corr-1",
  };

  const staffWh1Actor: Actor = {
    id: "usr-staff-1",
    username: "staff1",
    role: "STAFF",
    warehouseAccess: "wh-1",
    correlationId: "corr-2",
  };

  const viewerActor: Actor = {
    id: "usr-viewer",
    username: "viewer",
    role: "VIEWER",
    warehouseAccess: "wh-1,wh-2",
    correlationId: "corr-3",
  };

  test("Admin should have all permissions across any warehouse", () => {
    expect(() => authorize(adminActor, PERMISSIONS.STOCK_RECEIVE, "wh-99")).not.toThrow();
    expect(() => authorize(adminActor, PERMISSIONS.USER_MANAGE)).not.toThrow();
    expect(() => authorize(adminActor, PERMISSIONS.STOCK_REVERSE, "wh-1")).not.toThrow();
  });

  test("Default Deny: Unauthenticated actor throws UnauthorizedError (401)", () => {
    expect(() => authorize(null, PERMISSIONS.STOCK_VIEW)).toThrow(UnauthorizedError);
    try {
      authorize(undefined, PERMISSIONS.STOCK_VIEW);
    } catch (e: any) {
      expect(e.statusCode).toBe(401);
      expect(e.code).toBe("UNAUTHORIZED");
    }
  });

  test("Role Restrictions: VIEWER cannot perform stock mutations (throws ForbiddenError 403)", () => {
    expect(() => authorize(viewerActor, PERMISSIONS.STOCK_RECEIVE, "wh-1")).toThrow(ForbiddenError);
    expect(() => authorize(viewerActor, PERMISSIONS.STOCK_ISSUE, "wh-1")).toThrow(ForbiddenError);
    expect(() => authorize(viewerActor, PERMISSIONS.STOCK_MOVE, "wh-1")).toThrow(ForbiddenError);

    try {
      authorize(viewerActor, PERMISSIONS.STOCK_RECEIVE, "wh-1");
    } catch (e: any) {
      expect(e.statusCode).toBe(403);
      expect(e.code).toBe("FORBIDDEN");
    }
  });

  test("Warehouse Access Isolation: STAFF with wh-1 access is denied on wh-2", () => {
    expect(() => authorize(staffWh1Actor, PERMISSIONS.STOCK_RECEIVE, "wh-1")).not.toThrow();
    expect(() => authorize(staffWh1Actor, PERMISSIONS.STOCK_RECEIVE, "wh-2")).toThrow(ForbiddenError);
  });

  test("isAuthorized predicate returns boolean without throwing", () => {
    expect(isAuthorized(adminActor, PERMISSIONS.STOCK_RECEIVE, "wh-1")).toBe(true);
    expect(isAuthorized(viewerActor, PERMISSIONS.STOCK_RECEIVE, "wh-1")).toBe(false);
    expect(isAuthorized(null, PERMISSIONS.STOCK_VIEW)).toBe(false);
  });
});
