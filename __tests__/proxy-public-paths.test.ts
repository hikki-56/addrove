import { isPublicPath } from "@/lib/public-paths";

describe("isPublicPath (proxy auth bypass)", () => {
  it.each([
    "/", "/login", "/employee-login", "/admin-login", "/warehouses/qr",
    "/api/auth/session", "/api/auth/callback/credentials", "/api/system/health",
    "/_next/static/chunks/main.js", "/products/A002.jpg", "/fonts/Sarabun-Regular.woff2", "/favicon.ico",
  ])("allows %s", (p) => expect(isPublicPath(p)).toBe(true));

  it.each([
    "/dashboard", "/users", "/users/a.b", "/products/abc.def", "/approvals/x.y",
    "/api/users", "/api/users/x.json", "/api/products/1.png", "/api/approvals/a.b/approve",
    "/api/authx", "/api/systemfoo", "/loginx",
  ])("requires login for %s", (p) => expect(isPublicPath(p)).toBe(false));
});
