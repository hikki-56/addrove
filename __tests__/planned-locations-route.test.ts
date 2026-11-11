import { NextRequest } from "next/server";
import * as route from "@/app/api/planned-locations/route";
import { createActorFromSession, PERMISSIONS, type Actor } from "@/server/security";
import { getPlannedLocations } from "@/server/services/planned-location.service";
import { getStorageDriver } from "@/server/repositories/storage-driver";
import { getGrantedPermissions } from "@/lib/menu-grants";
import { getVisibleNavItems } from "@/components/layout/nav-items";
import { PLANNED_SHELF_BARCODES_HREF } from "@/lib/planned-locations";

jest.mock("@/server/auth-session", () => ({ getAuthSession: jest.fn().mockResolvedValue(null) }));
jest.mock("@/server/security", () => ({ ...jest.requireActual("@/server/security"), createActorFromSession: jest.fn() }));
jest.mock("@/server/services/planned-location.service", () => ({ getPlannedLocations: jest.fn() }));
jest.mock("@/server/repositories/storage-driver", () => ({ getStorageDriver: jest.fn() }));

const admin: Actor = { id: "admin", role: "ADMIN", username: "Admin", warehouseAccess: "*", correlationId: "planned-test" };
const request = (query = "") => new NextRequest(`http://localhost/api/planned-locations${query}`);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createActorFromSession).mockResolvedValue({ ...admin });
  jest.mocked(getStorageDriver).mockReturnValue("postgres");
  jest.mocked(getPlannedLocations).mockResolvedValue([]);
});

test("anonymous callers cannot read the planned catalogue", async () => {
  jest.mocked(createActorFromSession).mockResolvedValue(null);
  expect((await route.GET(request())).status).toBe(401);
  expect(getPlannedLocations).not.toHaveBeenCalled();
});

test("the default administrator menu includes old and new shelf barcode pages", () => {
  const hrefs = getVisibleNavItems({ role: "ADMIN", email: "admin@stockify.com" }, null).map((item) => item.href);
  expect(hrefs).toEqual(expect.arrayContaining(["/shelves/qr", PLANNED_SHELF_BARCODES_HREF]));
});

test("admin can read all prepared locations or select the office warehouse", async () => {
  expect((await route.GET(request())).status).toBe(200);
  expect(getPlannedLocations).toHaveBeenLastCalledWith(null);
  expect((await route.GET(request("?warehouse_id=wh-06"))).status).toBe(200);
  expect(getPlannedLocations).toHaveBeenLastCalledWith(["wh-6"]);
});

test("staff require an explicit new-menu grant; it gives no location or stock mutation permissions", async () => {
  const staff = { ...admin, role: "WAREHOUSE_STAFF" as const, warehouseAccess: '["wh-01"]' };
  jest.mocked(createActorFromSession).mockResolvedValue(staff);
  expect((await route.GET(request())).status).toBe(403);
  const grants = getGrantedPermissions(staff.role, [PLANNED_SHELF_BARCODES_HREF]);
  expect(grants).toEqual([PERMISSIONS.STOCK_VIEW, PERMISSIONS.PLANNED_LOCATION_VIEW]);
  expect(grants).not.toContain(PERMISSIONS.LOCATION_MANAGE);
  expect(grants).not.toContain(PERMISSIONS.STOCK_MOVE);
  jest.mocked(createActorFromSession).mockResolvedValue({ ...staff, grantedPermissions: grants });
  expect((await route.GET(request())).status).toBe(200);
  expect(getPlannedLocations).toHaveBeenLastCalledWith(["wh-1"]);
});

test("warehouse restrictions remain enforced for explicitly granted users", async () => {
  jest.mocked(createActorFromSession).mockResolvedValue({ ...admin, role: "WAREHOUSE_STAFF", warehouseAccess: '["wh-01"]', grantedPermissions: [PERMISSIONS.PLANNED_LOCATION_VIEW] });
  expect((await route.GET(request("?warehouse_id=wh-06"))).status).toBe(403);
  expect(getPlannedLocations).not.toHaveBeenCalled();
});

test("empty warehouse access does not become unrestricted access", async () => {
  jest.mocked(createActorFromSession).mockResolvedValue({ ...admin, role: "VIEWER", warehouseAccess: "", grantedPermissions: [PERMISSIONS.PLANNED_LOCATION_VIEW] });
  expect((await route.GET(request())).status).toBe(200);
  expect(getPlannedLocations).toHaveBeenCalledWith([]);
});

test("invalid warehouse identifiers are rejected before querying the catalogue", async () => {
  expect((await route.GET(request("?warehouse_id=unknown"))).status).toBe(400);
  expect(getPlannedLocations).not.toHaveBeenCalled();
});

test("unavailable prepared-location storage returns an error instead of manufacturing shelf codes", async () => {
  jest.mocked(getStorageDriver).mockReturnValue("sheets");
  expect((await route.GET(request())).status).toBe(503);
  expect(getPlannedLocations).not.toHaveBeenCalled();
  jest.mocked(getStorageDriver).mockReturnValue("postgres");
  jest.mocked(getPlannedLocations).mockRejectedValue({ code: "42P01" });
  expect((await route.GET(request())).status).toBe(503);
});

test("the catalogue endpoint exposes no write methods", () => {
  expect(route).not.toHaveProperty("POST");
  expect(route).not.toHaveProperty("PATCH");
  expect(route).not.toHaveProperty("DELETE");
});
