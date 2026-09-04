import { useEffect } from "react";

/**
 * Poll `callback` เป็นรอบ ๆ ตาม interval เฉพาะตอนที่แท็บมองเห็นอยู่ (visible)
 * - callback รับ flag `initial`: ครั้งแรกของแต่ละ callback (mount / callback เปลี่ยน
 *   เช่น filter เปลี่ยน) จะได้ `true` (ปกติใช้โชว์ loading) ส่วนรอบ polling และ
 *   ตอนกลับมาที่แท็บจะได้ `false` (refresh เงียบ ๆ ไม่กระพริบ loading)
 * - ระหว่างที่แท็บถูกซ่อน (สลับแท็บ/ย่อหน้าต่าง) จะหยุด interval ชั่วคราว
 *   เพื่อไม่ให้แท็บที่ไม่ได้ดูกิน CPU/เครือข่าย แล้วดึงข้อมูลล่าสุดทันทีเมื่อกลับมาดู
 */
export function usePollingWhenVisible(
  callback: (initial?: boolean) => void,
  intervalMs: number
): void {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      if (timer !== null || document.hidden) return;
      timer = setInterval(() => callback(false), intervalMs);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        callback(false);
        start();
      }
    };

    callback(true);
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [callback, intervalMs]);
}
