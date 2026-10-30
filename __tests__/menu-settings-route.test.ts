import { NextRequest } from "next/server";
import { GET, PATCH } from "@/app/api/menu-settings/route";
import { GET as getMine } from "@/app/api/menu-settings/me/route";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import type { User } from "@/types/models";

jest.mock("@/server/auth-session", () => ({ getAuthSession: jest.fn() }));
jest.mock("@/server/repositories", () => ({ getRepository: jest.fn() }));
jest.mock("@/server/storage-transaction", () => ({ withStorageRequest: (handler: unknown) => handler }));

const owner: User = { user_id: "owner", full_name: "Owner", email: "ty@stockify.com", role: "ADMIN", active: true, password_hash: "secret", pin_hash: "secret-pin", warehouse_access: '["*"]', created_at: "", updated_at: "" };
const target: User = { ...owner, user_id: "staff", email: "staff@stockify.com", role: "WAREHOUSE_STAFF", menu_hrefs: null };
let records: User[];
const users = {
  findById: jest.fn(async (id: string) => records.find(({ user_id }) => user_id === id) ?? null),
  findAll: jest.fn(async () => records),
  update: jest.fn(async (id: string, updates: Partial<User>) => {
    const user = records.find(({ user_id }) => user_id === id);
    return user ? Object.assign(user, updates) : null;
  }),
};
const request = (body?: unknown) => new NextRequest("http://localhost/api/menu-settings", body === undefined ? undefined : { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const session = (id = "owner", email = "ty@stockify.com") => ({ user: { id, email, role: "ADMIN", name: "Owner" }, expires: "2099-01-01" });

beforeEach(() => {
  jest.clearAllMocks();
  records = [{ ...owner }, { ...target }];
  (getRepository as jest.Mock).mockReturnValue({ users });
  (getAuthSession as jest.Mock).mockResolvedValue(session());
});

test("anonymous requests cannot read or write settings", async () => {
  (getAuthSession as jest.Mock).mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect((await PATCH(request({ user_id: "staff", menu_hrefs: [] }))).status).toBe(401);
  expect(users.update).not.toHaveBeenCalled();
});

test("another admin is denied even when their token claims the owner email", async () => {
  (getAuthSession as jest.Mock).mockResolvedValue(session("staff"));
  expect((await GET(request())).status).toBe(403);
  expect((await PATCH(request({ user_id: "staff", menu_hrefs: [] }))).status).toBe(403);
  expect(users.findAll).not.toHaveBeenCalled();
  expect(users.update).not.toHaveBeenCalled();
});

test("an inactive owner cannot manage menus", async () => {
  records[0].active = false;
  expect((await GET(request())).status).toBe(403);
  expect((await PATCH(request({ user_id: "staff", menu_hrefs: [] }))).status).toBe(403);
});

test("owner receives only settings fields, without credentials", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data).toHaveLength(2);
  expect(data[0]).not.toHaveProperty("password_hash");
  expect(data[0]).not.toHaveProperty("pin_hash");
  expect(data[1].available_menus.map((item: { href: string }) => item.href)).toContain("/staff/receive");
});

test("saving affects only the selected account and distinguishes [] from defaults", async () => {
  expect((await PATCH(request({ user_id: "staff", menu_hrefs: ["/staff/receive", "/staff/receive"] }))).status).toBe(200);
  expect(records[1].menu_hrefs).toEqual(["/staff/receive"]);
  expect(records[0].menu_hrefs).toBeUndefined();
  await PATCH(request({ user_id: "staff", menu_hrefs: [] }));
  expect(records[1].menu_hrefs).toEqual([]);
  await PATCH(request({ user_id: "staff", menu_hrefs: null }));
  expect(records[1].menu_hrefs).toBeNull();
});

test("invalid menu grants and unrelated user updates are rejected", async () => {
  for (const menu_hrefs of [["/users"], ["/movements/receive"], ["/menu-settings"], ["/unknown"]]) { // /movements/receive is /staff/receive for staff
    expect((await PATCH(request({ user_id: "staff", menu_hrefs }))).status).toBe(400);
  }
  expect((await PATCH(request({ user_id: "staff", menu_hrefs: [], role: "ADMIN" }))).status).toBe(400);
  expect(users.update).not.toHaveBeenCalled();
});

test("a missing target returns 404", async () => {
  expect((await PATCH(request({ user_id: "missing", menu_hrefs: [] }))).status).toBe(404);
});

test("each employee reads only their own latest settings", async () => {
  (getAuthSession as jest.Mock).mockResolvedValue(session("staff", "staff@stockify.com"));
  records[1].menu_hrefs = [];
  const { data } = await (await getMine(request())).json();
  expect(data).toEqual({ menu_hrefs: [], can_manage: false });
  expect(users.findAll).not.toHaveBeenCalled();
});

test("owner can grant a menu outside the user's role; it is flagged and saved", async () => {
  const response = await GET(request());
  const { data } = await response.json();
  const express = data[1].available_menus.find((item: { href: string }) => item.href === "/express-import/receive");
  expect(express).toMatchObject({ outside_role: true });
  expect(data[1].available_menus.find((item: { href: string }) => item.href === "/staff/receive")).toMatchObject({ outside_role: false });
  expect((await PATCH(request({ user_id: "staff", menu_hrefs: ["/staff/receive", "/express-import/receive"] }))).status).toBe(200);
  expect(records[1].menu_hrefs).toEqual(["/staff/receive", "/express-import/receive"]);
});

test("every user gets the full menu catalog; ty-only system menus are listed but locked and cannot be saved", async () => {
  records.push({ ...target, user_id: "kaew", email: "kaew@stockify.com", role: "APPROVER", menu_hrefs: ["/production/jobs", "/movements/transfer"] });
  const { data } = await (await GET(request())).json();
  const ownerHrefs = data[0].available_menus.map((item: { href: string }) => item.href);
  const kaew = data.find((item: { user_id: string }) => item.user_id === "kaew");
  expect(kaew.available_menus.length).toBe(ownerHrefs.length);
  expect(kaew.available_menus.length).toBeGreaterThan(20);
  expect(kaew.available_menus.find((item: { href: string }) => item.href === "/users")).toMatchObject({ locked: true });
  expect(kaew.available_menus.find((item: { href: string }) => item.href === "/movements/receive")).toMatchObject({ outside_role: true });
  expect(kaew.available_menus.find((item: { href: string }) => item.href === "/movements/receive").locked).toBeUndefined();
  expect((await PATCH(request({ user_id: "kaew", menu_hrefs: ["/users"] }))).status).toBe(400);
  expect((await PATCH(request({ user_id: "kaew", menu_hrefs: ["/production/jobs", "/movements/receive"] }))).status).toBe(200);
});
