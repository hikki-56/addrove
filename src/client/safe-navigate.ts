"use client";

interface SafeRouterLike {
  push?: (href: string) => void;
  replace?: (href: string) => void;
}

/**
 * นำทางแบบทนทานสำหรับ App Router
 *
 * Next.js 16 (โหมด dev + Turbopack) บางสถานะ เช่น ผู้ใช้คลิกก่อน hydration เสร็จ
 * หรือ HMR ทิ้ง state ค้าง ทำให้ router action ถูก dispatch ก่อน App Router
 * initialize เสร็จ แล้วโยน "Internal Next.js error: Router action dispatched
 * before initialization" (dispatch โยนแบบ synchronous จาก router.push/replace)
 *
 * กรณีนั้นให้ตกไปใช้การนำทางเต็มผ่าน window.location แทน — ผู้ใช้ไปหน้าปลายทาง
 * ได้เสมอแม้ router instance จะอยู่ในสภาพเสียชั่วคราว
 */
export function safeNavigate(
  router: SafeRouterLike,
  href: string,
  method: "push" | "replace" = "push"
): void {
  try {
    if (method === "replace") {
      router.replace?.(href);
    } else {
      router.push?.(href);
    }
  } catch (err) {
    console.warn(`[safeNavigate] router.${method}("${href}") failed, falling back to window.location:`, err);
    if (method === "replace") {
      window.location.replace(href);
    } else {
      window.location.assign(href);
    }
  }
}
