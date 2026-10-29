import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { POST } from "@/app/api/auth/qr-login/route";
import { GET as getQrToken } from "@/app/api/auth/qr-token/route";
import { getRepository } from "@/server/repositories";
import { getAuthSession } from "@/server/auth-session";
import { generateEmployeeQrToken, verifyEmployeeQrToken } from "@/server/qr-token";
import { clearFailedAttempts } from "@/server/rate-limit";
import { recordLoginLog } from "@/server/services/login-log.service";
import { employeeCardCode } from "@/lib/employee-card";
import type { User } from "@/types/models";

jest.mock("@/server/repositories", () => ({ getRepository: jest.fn() }));
jest.mock("@/server/auth-session", () => ({ getAuthSession: jest.fn() }));
jest.mock("@/server/storage-transaction", () => ({ withStorageRequest: (handler: unknown) => handler }));
jest.mock("@/server/services/login-log.service", () => ({ recordLoginLog: jest.fn() }));
jest.mock("@/server/server-secrets", () => ({
  getAuthSecret: () => "test-only-auth-secret-at-least-32-characters",
  getQrTokenSecret: () => "test-only-qr-secret-at-least-32-characters",
}));
jest.mock("next-auth/jwt", () => ({ encode: jest.fn() }));

const admin: User = {
  user_id: "usr-admin-test", full_name: "Test Admin", email: "admin@example.invalid",
  role: "ADMIN", active: true, password_hash: "unused", pin_hash: bcrypt.hashSync("0471", 4),
  warehouse_access: '["*"]', created_at: "", updated_at: "",
};
const staff: User = {
  ...admin, user_id: "usr-staff-test", email: "staff@example.invalid", role: "WAREHOUSE_STAFF",
  pin_hash: bcrypt.hashSync("2586", 4), warehouse_access: '["wh-01"]',
};
let records: User[];
const users = {
  findById: jest.fn(async (id: string) => records.find((user) => user.user_id === id) ?? null),
  findAll: jest.fn(async () => records),
};
const request = (body: unknown) => new Request("http://localhost/api/auth/qr-login", {
  method: "POST", body: JSON.stringify(body),
  headers: { "Content-Type": "application/json", "x-forwarded-for": "192.0.2.71" },
});

beforeEach(() => {
  jest.clearAllMocks();
  clearFailedAttempts("pin-login:192.0.2.71");
  records = [{ ...admin }, { ...staff }];
  (getRepository as jest.Mock).mockReturnValue({ users });
  (encode as jest.Mock).mockResolvedValue("test-session-token");
  (recordLoginLog as jest.Mock).mockResolvedValue(undefined);
  (getAuthSession as jest.Mock).mockResolvedValue({ user: { id: admin.user_id, role: "ADMIN" } });
});

test.each([
  ["warehouse PIN", {}],
  ["packer barcode", { section: "packer" }],
  ["personal barcode", { card_code: employeeCardCode(admin.user_id) }],
  ["signed QR", { token: generateEmployeeQrToken(admin.user_id) }],
])("admin can enter through %s and retains the ADMIN role", async (_label, context) => {
  const response = await POST(request({ ...context, pin: "0471" }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.user).toMatchObject({ id: admin.user_id, role: "ADMIN", warehouse_access: ["*"] });
  expect(body.user).not.toHaveProperty("pin_hash");
  expect(body.user).not.toHaveProperty("password_hash");
  expect(encode).toHaveBeenCalledWith(expect.objectContaining({
    token: expect.objectContaining({ id: admin.user_id, role: "ADMIN" }), maxAge: 5 * 3600,
  }));
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(recordLoginLog).toHaveBeenCalledWith(expect.objectContaining({ user_id: admin.user_id, user_role: "ADMIN" }));
});

test.each([
  { card_code: employeeCardCode(staff.user_id) },
  { token: generateEmployeeQrToken(staff.user_id) },
  { card_code: "EMP-UNKNOWN-USER" },
  { card_code: "invalid-card" },
])("a bound card or QR cannot fall back to another account's PIN: %j", async (context) => {
  const response = await POST(request({ ...context, pin: "0471" }));
  expect(response.status).toBe(401);
  expect(encode).not.toHaveBeenCalled();
});

test("inactive admins cannot sign in using a valid PIN or their personal QR", async () => {
  records[0].active = false;
  for (const context of [{}, { token: generateEmployeeQrToken(admin.user_id) }]) {
    expect((await POST(request({ ...context, pin: "0471" }))).status).toBe(401);
  }
  expect(encode).not.toHaveBeenCalled();
});

test("wrong PIN attempts lock out an admin after five failures", async () => {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await POST(request({ pin: "9999" }));
    expect(response.status).toBe(attempt < 5 ? 401 : 429);
  }
  const blocked = await POST(request({ pin: "0471" }));
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(encode).not.toHaveBeenCalled();
});

test("PIN shared by an admin and staff is ambiguous without a personal card", async () => {
  records[1].pin_hash = admin.pin_hash;
  expect((await POST(request({ pin: "0471" }))).status).toBe(400);
  expect(encode).not.toHaveBeenCalled();
  const bound = await POST(request({ card_code: employeeCardCode(admin.user_id), pin: "0471" }));
  expect(bound.status).toBe(200);
  expect((await bound.json()).user.id).toBe(admin.user_id);
});

test("warehouse staff retain their role and cannot use the packer entry", async () => {
  const response = await POST(request({ pin: "2586" }));
  expect((await response.json()).user).toMatchObject({ role: "WAREHOUSE_STAFF", warehouse_access: ["wh-1"] });
  expect((await POST(request({ pin: "2586", section: "packer" }))).status).toBe(403);
  records[1].role = "PACKER";
  expect((await POST(request({ pin: "2586", section: "packer" }))).status).toBe(200);
});

test("only an admin may issue a QR for an active admin account", async () => {
  const req = new NextRequest(`http://localhost/api/auth/qr-token?userId=${admin.user_id}`);
  const response = await getQrToken(req);
  expect(response.status).toBe(200);
  expect(verifyEmployeeQrToken((await response.json()).token)?.employee_id).toBe(admin.user_id);
  records[0].active = false;
  expect((await getQrToken(req)).status).toBe(404);
  (getAuthSession as jest.Mock).mockResolvedValue({ user: { role: "WAREHOUSE_STAFF" } });
  expect((await getQrToken(req)).status).toBe(403);
  (getAuthSession as jest.Mock).mockResolvedValue(null);
  expect((await getQrToken(req)).status).toBe(403);
});
