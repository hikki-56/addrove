"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { getActiveWarehouse, getWarehouseName } from "@/lib/warehouse-utils";
import {
  getPendingTransferNotifications,
  getTransferNotifications,
  saveTransferNotification,
  markTransferCompleted,
  isTransferCompleted,
  cleanProductName,
  purgeInvalidNotifications,
  fetchAndSyncTransferNotifications,
  type TransferNotification,
} from "@/lib/transfer-notification-utils";

export default function StaffDashboard() {
  const { user: tabUser } = useTabAuth();
  const [activeWh, setActiveWh] = useState<string>("wh-01");
  const [pendingTransfers, setPendingTransfers] = useState<TransferNotification[]>([]);

  useEffect(() => {
    // Clean up stale/invalid localStorage notifications from old app versions
    purgeInvalidNotifications();

    // Always read from URL first — URL is the authoritative source after QR scan
    const urlWh =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("warehouse_id") ||
          new URLSearchParams(window.location.search).get("wh")
        : null;
    const wh = getActiveWarehouse(urlWh);
    setActiveWh(wh);

    const updateNotifications = () => {
      const staffFilter = tabUser?.name || undefined;
      setPendingTransfers(getPendingTransferNotifications(staffFilter, wh));
    };

    updateNotifications();

    const doSync = async () => {
      try {
        await fetchAndSyncTransferNotifications();
        updateNotifications();
      } catch (e) {
        console.error("[StaffDashboard] Sync error:", e);
      }
    };

    doSync();
    const interval = setInterval(doSync, 5000);

    window.addEventListener("stockify-transfer-created", updateNotifications);
    window.addEventListener("stockify-transfer-updated", updateNotifications);
    window.addEventListener("storage", updateNotifications);

    return () => {
      clearInterval(interval);
      window.removeEventListener("stockify-transfer-created", updateNotifications);
      window.removeEventListener("stockify-transfer-updated", updateNotifications);
      window.removeEventListener("storage", updateNotifications);
    };
  }, [tabUser, activeWh]);

  const whName = getWarehouseName(activeWh);
  const pendingCount = pendingTransfers.length;

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center py-8 px-4 w-full">
      <div className="w-full max-w-md space-y-6 text-center">
        
        {/* Warehouse Header Title */}
        <div className="flex items-center justify-center gap-3 py-1">
          <img
            src="/warehouse-icon.png"
            alt="Warehouse Icon"
            className="w-10 h-10 sm:w-11 sm:h-11 object-contain flex-shrink-0 drop-shadow-sm"
          />
          <span className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-wide leading-none">
            {whName}
          </span>
        </div>

        {/* 4 Centered Square Buttons (2x2 Grid) */}
        <div className="grid grid-cols-2 gap-4 w-full pt-2">
          
          {/* Square 1: รับสินค้าเข้าคลัง */}
          <Link
            href={`/movements/receive?warehouse_id=${activeWh}`}
            id="staff-btn-receive"
            className="group relative aspect-square w-full rounded-3xl p-5 bg-white border border-slate-200/90 hover:border-indigo-500/50 shadow-md hover:shadow-xl transition-all duration-200 active:scale-95 flex flex-col items-center justify-center text-center cursor-pointer"
          >
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 p-2 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform mb-3">
              <img src="/receive-stock-icon.png" alt="รับสินค้าเข้าคลัง" className="w-full h-full object-contain" />
            </div>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900 group-hover:text-indigo-600 transition-colors">
              รับสินค้าเข้าโกดัง
            </h2>
            <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">สแกนและนำเข้า</p>
          </Link>

          {/* Square 2: จัดตำแหน่งสินค้า */}
          <Link
            href={`/movements/move?warehouse_id=${activeWh}`}
            id="staff-btn-move"
            className="group relative aspect-square w-full rounded-3xl p-5 bg-white border border-slate-200/90 hover:border-emerald-500/50 shadow-md hover:shadow-xl transition-all duration-200 active:scale-95 flex flex-col items-center justify-center text-center cursor-pointer"
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 p-2 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform mb-3">
              <img src="/move-location-icon.png" alt="จัดตำแหน่งสินค้า" className="w-full h-full object-contain" />
            </div>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900 group-hover:text-emerald-600 transition-colors">
              จัดตำแหน่งสินค้า
            </h2>
            <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">จัดตำแหน่งจัดเก็บ</p>
          </Link>

          {/* Square 3: ย้ายสินค้า */}
          <Link
            href={`/movements/transfer?warehouse_id=${activeWh}`}
            id="staff-btn-transfer"
            className="group relative aspect-square w-full rounded-3xl p-5 bg-white border border-slate-200/90 hover:border-sky-500/50 shadow-md hover:shadow-xl transition-all duration-200 active:scale-95 flex flex-col items-center justify-center text-center cursor-pointer"
          >
            <div className="relative w-14 h-14 rounded-2xl bg-sky-50 border border-sky-100 p-2 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform mb-3">
              <img src="/transfer-stock-icon.png" alt="ย้ายสินค้า" className="w-full h-full object-contain" />
              {pendingCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs font-black text-white shadow-md animate-pulse">
                  {pendingCount}
                </span>
              )}
            </div>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900 group-hover:text-sky-600 transition-colors">
              ย้ายสินค้า
            </h2>
            <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">ย้ายระหว่างโกดัง</p>
          </Link>

          {/* Square 4: สินค้าทั้งหมด */}
          <Link
            href="/products"
            id="staff-btn-products"
            className="group relative aspect-square w-full rounded-3xl p-5 bg-white border border-slate-200/90 hover:border-amber-500/50 shadow-md hover:shadow-xl transition-all duration-200 active:scale-95 flex flex-col items-center justify-center text-center cursor-pointer"
          >
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 p-2 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform mb-3">
              <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900 group-hover:text-amber-600 transition-colors">
              สินค้าทั้งหมด
            </h2>
            <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">ค้นหาและดูสต็อก</p>
          </Link>

        </div>
      </div>
    </div>
  );
}
