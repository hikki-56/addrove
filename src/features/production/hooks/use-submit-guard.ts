"use client";

// กันกดซ้ำสำหรับทุก action ที่เปลี่ยนข้อมูล (ส่งงาน/เริ่ม/รายงาน/ยกเลิก/เปิดต่อ/ปรับยอด/ลบ/สร้าง/แก้ไข)
// - ใช้ ref กันซ้ำแบบ synchronous (กันดับเบิลคลิกก่อน React re-render)
// - pending ใช้ disable ปุ่ม · pendingKey บอกว่า action ไหน/งานไหนกำลังทำ
import { useCallback, useRef, useState } from "react";

export interface SubmitGuard {
  /** มี action กำลังทำอยู่ */
  pending: boolean;
  /** key ของ action ที่กำลังทำ (เช่น `start:PRD-...`) หรือ null */
  pendingKey: string | null;
  /** รัน fn ถ้าไม่มี action อื่นค้างอยู่ — คืน undefined เมื่อถูกบล็อก */
  run: <T>(fn: () => Promise<T>, key?: string) => Promise<T | undefined>;
  isPending: (key: string) => boolean;
}

export function useSubmitGuard(): SubmitGuard {
  const inFlight = useRef(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>, key = "default"): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPendingKey(key);
    try {
      return await fn();
    } finally {
      inFlight.current = false;
      setPendingKey(null);
    }
  }, []);

  const isPending = useCallback((key: string) => pendingKey === key, [pendingKey]);

  return { pending: pendingKey !== null, pendingKey, run, isPending };
}
