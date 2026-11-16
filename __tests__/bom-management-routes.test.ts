import { NextRequest } from "next/server";

let mockSession: { user: { id: string; name: string; role: string } } | null = null;
jest.mock("@/server/auth-session", () => ({ getAuthSession: jest.fn(async () => mockSession) }));
jest.mock("@/server/security/menu-grants", () => ({ loadGrantedPermissions: jest.fn(async () => []) }));
jest.mock("@/server/storage-transaction", () => ({ withStorageRequest: (handler: unknown) => handler }));
jest.mock("@/server/production/production-job.service", () => jest.requireActual("@/server/production/production-error"));
jest.mock("@/server/production/bom-management.service", () => ({
  getBomManagementData: jest.fn(async () => ({ product: { product_id: "fg" }, formulas: [], production_formulas: [], materials: [] })),
  createBomFormula: jest.fn(async () => "BOM-NEW"), updateProductBomFormula: jest.fn(async () => undefined), deleteBomFormula: jest.fn(async () => undefined),
}));

import { GET, POST, PATCH, DELETE } from "@/app/api/production/boms/manage/route";
import { createBomFormula, deleteBomFormula, getBomManagementData, updateProductBomFormula } from "@/server/production/bom-management.service";
import { ProductionError } from "@/server/production/production-error";
import { loadGrantedPermissions } from "@/server/security/menu-grants";
import { PERMISSIONS } from "@/server/security/permissions";

const valid = { product_id: "fg", bom_id: "BOM-1", revision: "revision-1", unit: "ชุด", base_qty: 1,
  items: [{ sku: "RM", qty: 1, unit: "ตัว", waste_percentage: 0, is_primary: 1 }] };
const request = (method: string, body: unknown = valid) => new NextRequest("http://localhost/api/production/boms/manage?product_id=fg", {
  method, ...(method === "GET" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});

beforeEach(() => { mockSession = null; jest.clearAllMocks(); });

test("every formula management operation requires authentication", async () => {
  for (const [method, handler] of [["GET", GET], ["POST", POST], ["PATCH", PATCH], ["DELETE", DELETE]] as const) expect((await handler(request(method))).status).toBe(401);
  expect(getBomManagementData).not.toHaveBeenCalled();
  expect(createBomFormula).not.toHaveBeenCalled();
  expect(updateProductBomFormula).not.toHaveBeenCalled();
  expect(deleteBomFormula).not.toHaveBeenCalled();
});

test.each(["APPROVER", "STAFF", "PACKER", "VIEWER", "MANAGER"])("%s cannot create, change or delete master recipes", async role => {
  mockSession = { user: { id: "user", name: "User", role } };
  for (const [method, handler] of [["GET", GET], ["POST", POST], ["PATCH", PATCH], ["DELETE", DELETE]] as const) expect((await handler(request(method))).status).toBe(403);
  expect(createBomFormula).not.toHaveBeenCalled();
  expect(updateProductBomFormula).not.toHaveBeenCalled();
  expect(deleteBomFormula).not.toHaveBeenCalled();
});

test("an admin can manage formulas for the selected product and gets refreshed recipes", async () => {
  mockSession = { user: { id: "admin", name: "Admin", role: "ADMIN" } };
  expect((await GET(request("GET"))).status).toBe(200);
  const created = await POST(request("POST"));
  expect(created.status).toBe(201);
  expect((await created.json()).bom_id).toBe("BOM-NEW");
  expect((await PATCH(request("PATCH"))).status).toBe(200);
  expect(updateProductBomFormula).toHaveBeenCalledWith("fg", valid);
  expect((await DELETE(request("DELETE"))).status).toBe(200);
  expect(deleteBomFormula).toHaveBeenCalledWith("fg", "BOM-1", "revision-1");
  expect(getBomManagementData).toHaveBeenCalledWith("fg");
});

test("invalid quantities and missing revisions are rejected before changes", async () => {
  mockSession = { user: { id: "admin", name: "Admin", role: "ADMIN" } };
  expect((await POST(request("POST", { ...valid, items: [{ ...valid.items[0], qty: 0 }] }))).status).toBe(400);
  expect((await PATCH(request("PATCH", { ...valid, revision: "" }))).status).toBe(400);
  expect((await DELETE(request("DELETE", { ...valid, revision: "" }))).status).toBe(400);
  expect(createBomFormula).not.toHaveBeenCalled();
  expect(updateProductBomFormula).not.toHaveBeenCalled();
  expect(deleteBomFormula).not.toHaveBeenCalled();
});

test("a concurrent edit is surfaced as a conflict", async () => {
  mockSession = { user: { id: "admin", name: "Admin", role: "ADMIN" } };
  jest.mocked(deleteBomFormula).mockRejectedValueOnce(new ProductionError("สูตรเปลี่ยนแล้ว", 409));
  expect((await DELETE(request("DELETE"))).status).toBe(409);
});

test("a production-menu grant does not let a non-admin manage master formulas", async () => {
  mockSession = { user: { id: "staff", name: "Staff", role: "STAFF" } };
  jest.mocked(loadGrantedPermissions).mockResolvedValue([PERMISSIONS.PRODUCTION_MANAGE]);
  try {
    for (const [method, handler] of [["GET", GET], ["POST", POST], ["PATCH", PATCH], ["DELETE", DELETE]] as const) expect((await handler(request(method))).status).toBe(403);
    expect(createBomFormula).not.toHaveBeenCalled();
    expect(deleteBomFormula).not.toHaveBeenCalled();
  } finally { jest.mocked(loadGrantedPermissions).mockResolvedValue([]); }
});
