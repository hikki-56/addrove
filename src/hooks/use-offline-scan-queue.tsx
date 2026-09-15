"use client";

import { useState, useEffect, useCallback } from "react";
import {
  flushScanQueue,
  getPendingScans,
  getFailedScans,
  clearFailedScans,
} from "@/lib/offline-scan-queue";

/**
 * Hook คิวสแกนออฟไลน์ — ผูกกับหน้างานสแกน (หยิบ/แพ็ก/ขึ้นรถ)
 * แสดงจำนวนรายการรอ sync + รายการที่ส่งไม่สำเร็จจริง (ให้หัวหน้าเห็น)
 * auto-flush เมื่อ online กลับมา หรือทุก 10 วินาทีถ้ามีรายการค้าง
 */
export function useOfflineScanQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [failed, setFailed] = useState(() => getFailedScans());

  const refreshCounts = useCallback(() => {
    setPendingCount(getPendingScans().length);
    setFailed(getFailedScans());
  }, []);

  const flush = useCallback(async () => {
    const result = await flushScanQueue();
    refreshCounts();
    return result;
  }, [refreshCounts]);

  useEffect(() => {
    refreshCounts();
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);

    const onOnline = () => {
      setOnline(true);
      void flush();
    };
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const timer = window.setInterval(() => {
      if (getPendingScans().length > 0) void flush();
    }, 10000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(timer);
    };
  }, [flush, refreshCounts]);

  return {
    pendingCount,
    online,
    failed,
    flush,
    refreshCounts,
    dismissFailed: () => {
      clearFailedScans();
      setFailed([]);
    },
  };
}

/** ป้ายสถานะคิว — วางไว้บนหน้าสแกน (โปร่งใสเมื่อทุกอย่างปกติ) */
export function OfflineQueueBadge({
  pendingCount,
  online,
}: {
  pendingCount: number;
  online: boolean;
}) {
  if (online && pendingCount === 0) return null;
  return (
    <div
      className={`rounded-xl px-3 py-2 text-sm font-semibold flex items-center gap-2 ${
        online ? "bg-amber-50 border border-amber-200 text-amber-800" : "bg-orange-100 border border-orange-300 text-orange-900"
      }`}
    >
      <span>{online ? "🟠" : "⛔"}</span>
      {online ? "กำลัง sync" : "ออฟไลน์"} {pendingCount > 0 ? `— ${pendingCount} รายการรอ Sync` : ""}
    </div>
  );
}
