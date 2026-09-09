import { useCallback, useEffect, useRef, useState } from "react";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * ค่าที่ควรแสดงบนจอเมื่อ animation ก้าวไปถึง `progress` (0..1)
 * pure function แยกออกมาเพื่อทดสอบว่าค่าปลายทางตรงกับ target เสมอ
 * progress = 1 → คืน target พอดี (ไม่มีผลจากการปัดเศษค้าง)
 */
export function countUpDisplayValue(target: number, progress: number): number {
  // progress ผิดปกติ (NaN/Infinity) → ถือเป็นจุดเริ่มต้น กันเลขที่แสดงกลายเป็น NaN
  if (!Number.isFinite(progress)) return 0;
  const clamped = Math.min(1, Math.max(0, progress));
  const value = Math.round(target * easeOutCubic(clamped));
  // ปรับ -0 กลับเป็น 0 ปกติ (target ติดลบ ที่ progress ต่ำจะได้ Math.round(-0))
  return value === 0 ? 0 : value;
}

/**
 * Animate a number from 0 to `target` once `active` becomes true.
 * Writes the formatted text straight to the attached DOM node, so it never
 * triggers React re-renders — keeps heavy pages (big tables, charts) smooth.
 * Attach the returned ref to a <span> and render that span only while `active`.
 * Respects prefers-reduced-motion by jumping straight to the target.
 *
 * เลขที่แสดงต้องตรงกับ state จริงหลังโหลดเสร็จเสมอ:
 * - effect รันทุกครั้งที่ node แปะใหม่ (attached counter) แม้ target/active ไม่เปลี่ยน
 * - ยกเลิก animation กลางคัน (dep เปลี่ยน/unmount) → เขียนค่าปลายทางทันที กันเลขค้างที่ 0
 *
 * @param target   Final value to count up to
 * @param active   Start the animation (e.g. when data finished loading)
 * @param duration Animation length in ms
 */
export function useCountUpText(target: number, active: boolean, duration = 800) {
  const nodeRef = useRef<HTMLElement | null>(null);
  // นับครั้งที่ node ถูกแปะเพื่อบังคับให้ effect รันซ้ำ — กันกรณี span mount
  // ตอนที่ target/active ไม่เปลี่ยนแล้วเลขค้างเป็นช่องว่าง/0
  const [attached, setAttached] = useState(0);

  // ref callback คงที่ (ไม่ผูกกับ active) — node เดิมไม่ถูก reset เป็น "0" กลางคัน
  const ref = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
    if (node) setAttached((count) => count + 1);
  }, []);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !active) return;

    const write = (value: number) => {
      node.textContent = value.toLocaleString();
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      write(target);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      write(countUpDisplayValue(target, progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // ถูกยกเลิกก่อนจบ → กระโดดไปค่าปลายทาง ไม่ปล่อยให้เลขค้างที่ค่ากลางทาง
      write(target);
    };
  }, [target, active, duration, attached]);

  return ref;
}
