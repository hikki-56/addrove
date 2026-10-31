// เส้นทางที่ proxy ปล่อยผ่านโดยไม่ต้องล็อกอิน
// เดิมใช้ pathname.includes(".") ทำให้ path ใดก็ได้ที่มีจุด (เช่น /users/a.b) ข้ามการตรวจล็อกอิน
// ตอนนี้ปล่อยเฉพาะไฟล์ static ตามนามสกุลที่รู้จัก และไม่ปล่อย /api/* ด้วยเหตุผลนี้เด็ดขาด

const PUBLIC_PAGES = new Set(["/", "/login", "/employee-login", "/admin-login", "/warehouses/qr"]);
const PUBLIC_PREFIXES = ["/api/auth", "/api/system", "/_next"];
const STATIC_FILE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|map|txt|xml|webmanifest|woff2?|ttf|otf)$/i;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGES.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
  if (!pathname.startsWith("/api/") && STATIC_FILE.test(pathname)) return true;
  return false;
}
