import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/office/route";
import { GET as getCuts, POST as postCut } from "@/app/api/office/stock-cuts/route";
import { createActorFromSession, PERMISSIONS, type Actor } from "@/server/security";
import { getAuthSession } from "@/server/auth-session";
import { getOfficeSetup, getOfficeProducts, getOfficeHistory, transferToOffice } from "@/server/services/office.service";
import { getRoleMenuItems } from "@/components/layout/nav-items";
import { getGrantedPermissions } from "@/lib/menu-grants";

jest.mock("@/server/auth-session", () => ({ getAuthSession: jest.fn() }));
jest.mock("@/server/repositories", () => ({
  getRepository: () => ({ warehouses: { findAll: async () => [{ active: true, warehouse_id: "wh-6", warehouse_code: "WH06" }] } }),
}));
jest.mock("@/server/storage-transaction", () => ({ withStorageRequest: (handler: unknown) => handler }));
jest.mock("@/server/security", () => ({ ...jest.requireActual("@/server/security"), createActorFromSession: jest.fn() }));
jest.mock("@/server/services/office.service", () => ({
  ...jest.requireActual("@/server/services/office.service"),
  getOfficeSetup: jest.fn(), getOfficeProducts: jest.fn(), getOfficeHistory: jest.fn(), transferToOffice: jest.fn(),
}));

const actor: Actor = { id: "staff", username: "Staff", role: "WAREHOUSE_STAFF", warehouseAccess: '["wh-1","wh-6"]', correlationId: "office-test", grantedPermissions: [PERMISSIONS.OFFICE_TRANSFER] };
const setup = { warehouses: [{ warehouse_id: "wh-1" }, { warehouse_id: "wh-2" }], office: { warehouse_id: "wh-6" }, locations: [] };
const body = { from_warehouse_id: "wh-1", idempotency_key: "office-api-test", lines: [{ product_id: "p13", quantity: 2, location_code: "OF-A-01" }] };
const post = (input: unknown = body) => new NextRequest("http://localhost/api/office", { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } });
const get = (query = "") => new NextRequest(`http://localhost/api/office${query}`);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAuthSession).mockResolvedValue({ user: { id: "staff", name: "Staff", role: "WAREHOUSE_STAFF" }, expires: "2099-01-01" } as never);
  jest.mocked(createActorFromSession).mockResolvedValue({ ...actor });
  jest.mocked(getOfficeSetup).mockResolvedValue(setup as never);
  jest.mocked(getOfficeProducts).mockResolvedValue([]);
  jest.mocked(getOfficeHistory).mockResolvedValue([]);
  jest.mocked(transferToOffice).mockResolvedValue({ document_id: "posted" } as never);
});

test("anonymous users cannot read or submit office stock", async () => {
  jest.mocked(createActorFromSession).mockResolvedValue(null);
  expect((await GET(get())).status).toBe(401);
  expect((await POST(post())).status).toBe(401);
  expect(transferToOffice).not.toHaveBeenCalled();
});

test("office catalog is scoped to the fixed office warehouse and setup lists accessible sources", async () => {
  expect((await GET(get())).status).toBe(200);
  expect(getOfficeProducts).toHaveBeenCalledWith(expect.anything(), "wh-6", false);
  jest.mocked(createActorFromSession).mockResolvedValue({ ...actor, warehouseAccess: '["wh-1"]' });
  expect((await GET(get())).status).toBe(200);
  expect((await GET(get("?warehouse_id=wh-2"))).status).toBe(403);
  const response = await GET(get("?view=setup"));
  expect((await response.json()).data.warehouses).toEqual([{ warehouse_id: "wh-1" }]);
});

test("warehouse restrictions apply to source and destination on posting", async () => {
  expect((await POST(post({ ...body, from_warehouse_id: "wh-2" }))).status).toBe(403);
  jest.mocked(createActorFromSession).mockResolvedValue({ ...actor, warehouseAccess: '["wh-1"]' });
  expect((await POST(post())).status).toBe(403);
  expect(transferToOffice).not.toHaveBeenCalled();
});

test("read-only employee cannot mutate office stock; explicit office-transfer menu grants allow it", async () => {
  const viewer = { ...actor, role: "VIEWER" as const, grantedPermissions: [] };
  jest.mocked(createActorFromSession).mockResolvedValue(viewer);
  expect((await POST(post())).status).toBe(403);
  expect(getGrantedPermissions("VIEWER", ["/products/office"])).not.toContain(PERMISSIONS.OFFICE_TRANSFER);
  jest.mocked(createActorFromSession).mockResolvedValue({ ...viewer, grantedPermissions: getGrantedPermissions("VIEWER", ["/outbound/office"]) });
  expect((await POST(post())).status).toBe(201);
  expect(transferToOffice).toHaveBeenCalledTimes(1);
});

test("invalid quantities and missing locations never reach the stock service", async () => {
  expect((await POST(post({ ...body, lines: [{ ...body.lines[0], quantity: -1 }] }))).status).toBe(400);
  expect((await POST(post({ ...body, lines: [{ ...body.lines[0], location_code: " " }] }))).status).toBe(400);
  expect(transferToOffice).not.toHaveBeenCalled();
});

test("employee roles have an office-products menu", () => {
  for (const role of ["WAREHOUSE_STAFF", "PACKER", "STAFF", "VIEWER"] as const) {
    expect(getRoleMenuItems({ role }).some((item) => item.href === "/products/office")).toBe(true);
    expect(getRoleMenuItems({ role }).some((item) => item.href === "/outbound/office")).toBe(false);
  }
});

test("the headquarters cut menu grants only that operation and still requires headquarters access", async () => {
  const href = "/office-stock-cuts";
  expect(getRoleMenuItems({ role: "ADMIN" }).some(item => item.href === href)).toBe(true);
  expect(getGrantedPermissions("VIEWER", [href])).toEqual([PERMISSIONS.OFFICE_STOCK_CUT]);
  jest.mocked(createActorFromSession).mockResolvedValue(null);
  expect((await postCut(post())).status).toBe(401);
  jest.mocked(createActorFromSession).mockResolvedValue(actor);
  expect((await postCut(post())).status).toBe(403);
  const granted = { ...actor, grantedPermissions: [PERMISSIONS.OFFICE_STOCK_CUT] };
  jest.mocked(createActorFromSession).mockResolvedValue({ ...granted, warehouseAccess: '["wh-1"]' });
  expect((await getCuts(get())).status).toBe(403);
  expect((await postCut(post())).status).toBe(403);
  jest.mocked(createActorFromSession).mockResolvedValue(granted);
  expect((await getCuts(get("?warehouse_id=wh-1"))).status).toBe(200);
  expect(getOfficeProducts).toHaveBeenCalledWith(expect.anything(), "wh-6", true);
  expect((await postCut(post({ ...body, warehouse_id: "wh-1" }))).status).toBe(400);
});
