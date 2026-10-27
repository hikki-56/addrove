"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StaffNavigationPending from "./StaffNavigationPending";
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
  type TransferNotification,
} from "@/lib/transfer-notification-utils";
import { subscribeTransferSync } from "@/client/transfer-sync-scheduler";
import {
  SolarBox,
  SolarBuildings,
  SolarInboxIn,
  SolarMapPoint,
  SolarNavigationArrow,
  SolarTransferHorizontal,
} from "@/components/icons";

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

    const unsubscribeSync = subscribeTransferSync(updateNotifications);

    window.addEventListener("stockify-transfer-created", updateNotifications);
    window.addEventListener("stockify-transfer-updated", updateNotifications);
    window.addEventListener("storage", updateNotifications);

    return () => {
      unsubscribeSync();
      window.removeEventListener("stockify-transfer-created", updateNotifications);
      window.removeEventListener("stockify-transfer-updated", updateNotifications);
      window.removeEventListener("storage", updateNotifications);
    };
  }, [tabUser, activeWh]);

  const whName = getWarehouseName(activeWh);
  const pendingCount = pendingTransfers.length;

  // ไทล์ Minimal v3 (M03) — ลิงก์/ลำดับ/เงื่อนไขเหมือนเดิม เปลี่ยนเฉพาะหน้าตา
  const tileClass =
    "rise-in group relative aspect-square w-full h-full rounded-2xl bg-white border border-[rgba(145,158,171,0.12)] shadow-[0_8px_24px_rgba(145,158,171,0.2)] hover:shadow-m3-dropdown transition-all duration-200 active:scale-95 flex flex-col items-center justify-center gap-3.5 p-3.5 sm:p-5 text-center cursor-pointer";
  const iconTileClass =
    "size-16 rounded-[18px] flex items-center justify-center shrink-0 transition-transform group-hover:scale-110";
  const labelClass = "text-[16px] font-extrabold leading-[1.25] text-m3-grey-800 text-center";

  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-start py-2 sm:py-8 w-full">
      <div className="w-full max-w-md text-center">

        {/* Warehouse Header Title */}
        <div className="rise-in flex items-center justify-center gap-3 pt-1.5 pb-[18px]">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[rgba(0,167,111,0.12)] text-m3-primary">
            <SolarBuildings size={26} />
          </span>
          <span className="text-[32px] font-extrabold leading-none tracking-[0.01em] text-m3-grey-800">
            {whName}
          </span>
        </div>

        {/* Staff home tiles (2-col grid) */}
        <div className="grid grid-cols-2 auto-rows-fr gap-3.5 sm:gap-4 w-full">

          {/* Square 1: รับสินค้าเข้าโกดัง */}
          <Link
            href={`/movements/receive?warehouse_id=${activeWh}`}
            prefetch={true}
            id="staff-btn-receive"
            className={tileClass}
            style={{ animationDelay: "90ms" }}
          >
            <span className={`${iconTileClass} bg-[rgba(0,167,111,0.08)] text-m3-primary`}>
              <SolarInboxIn size={36} />
            </span>
            <h2 className={labelClass}>
              <span>รับสินค้าเข้า</span>
              <span className="block">โกดัง</span>
            </h2>
            <StaffNavigationPending />
          </Link>

          {/* Square 2: จัดตำแหน่งสินค้า */}
          <Link
            href={`/movements/move?warehouse_id=${activeWh}`}
            prefetch={true}
            id="staff-btn-move"
            className={tileClass}
            style={{ animationDelay: "180ms" }}
          >
            <span className={`${iconTileClass} bg-[rgba(0,167,111,0.08)] text-m3-primary`}>
              <SolarNavigationArrow size={36} />
            </span>
            <h2 className={labelClass}>
              <span>จัดตำแหน่ง</span>
              <span className="block">สินค้า</span>
            </h2>
            <StaffNavigationPending />
          </Link>

          {/* Square: ระบุตำแหน่งสินค้า */}
          <Link
            href={`/movements/assign-location?warehouse_id=${activeWh}`}
            prefetch={true}
            id="staff-btn-assign-location"
            className={tileClass}
            style={{ animationDelay: "225ms" }}
          >
            <span className={`${iconTileClass} bg-[rgba(255,171,0,0.12)] text-m3-warning`}>
              <SolarMapPoint size={36} />
            </span>
            <h2 className={labelClass}>
              <span>ระบุตำแหน่ง</span>
              <span className="block">สินค้า</span>
            </h2>
            <StaffNavigationPending />
          </Link>

          {/* Square 3: ย้ายสินค้า */}
          <Link
            href={`/staff/transfer?warehouse_id=${activeWh}`}
            prefetch={true}
            id="staff-btn-transfer"
            className={tileClass}
            style={{ animationDelay: "270ms" }}
          >
            {pendingCount > 0 && (
              <span className="absolute top-3 right-3 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-m3-error px-1.5 text-[12px] font-bold text-white">
                {pendingCount}
              </span>
            )}
            <span className={`${iconTileClass} bg-[rgba(0,184,217,0.12)] text-m3-info`}>
              <SolarTransferHorizontal size={36} />
            </span>
            <h2 className={labelClass}>
              ย้ายสินค้า
            </h2>
            <StaffNavigationPending />
          </Link>

          {/* Square 4: สินค้าทั้งหมด */}
          <Link
            href="/products"
            prefetch={true}
            id="staff-btn-products"
            className={tileClass}
            style={{ animationDelay: "360ms" }}
          >
            <span className={`${iconTileClass} bg-[rgba(142,51,255,0.12)] text-m3-secondary`}>
              <SolarBox size={36} />
            </span>
            <h2 className={labelClass}>
              <span>สินค้า</span>
              <span className="block">ทั้งหมด</span>
            </h2>
            <StaffNavigationPending />
          </Link>

        </div>
      </div>
    </div>
  );
}
