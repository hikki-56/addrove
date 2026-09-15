"use client";

import React from "react";
import type { TransferNotification } from "@/lib/transfer-notification-utils";
import { getInStockSourceLocations, isUsableLocationCode, parseTransferMetadata } from "@/lib/transfer-notification-utils";
import type { Product } from "@/types/models";

export interface TransferNotificationListProps {
  notifications: TransferNotification[];
  isAdmin: boolean;
  products?: Product[];
  onSelectTask: (task: TransferNotification) => void;
  onCancelTask?: (e: React.MouseEvent, task: TransferNotification) => void;
  onApproveTask?: (task: TransferNotification) => void;
  onRejectTask?: (e: React.MouseEvent, task: TransferNotification) => void;
  onCleanupHistory?: () => void;
  isCleaningUp?: boolean;
  cancellingId?: string | null;
  approvingId?: string | null;
  /** แถบ error ของบ้านจาก action ที่ล้มเหลว (แทน alert) */
  errorBanner?: string;
  onDismissError?: () => void;
}

function formatThaiDateTime(dateStr?: string | null): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const datePart = d.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const timePart = d.toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${datePart} ${timePart} น.`;
  } catch {
    return String(dateStr);
  }
}

export default function TransferNotificationList({
  notifications,
  isAdmin,
  products,
  onSelectTask,
  onCancelTask,
  onApproveTask,
  onRejectTask,
  onCleanupHistory,
  isCleaningUp = false,
  cancellingId = null,
  approvingId = null,
  errorBanner,
  onDismissError,
}: TransferNotificationListProps) {
  const resolveProductLocation = (t: TransferNotification): string => {
    // 0. แสดงเฉพาะชั้นวางที่ยังมีสต็อกเหลืออยู่จริง (ตัดชั้นวางที่เคยสแกน/หยิบจนหมดไปแล้วออก)
    const liveLocs = getInStockSourceLocations(t, products);
    if (liveLocs) {
      if (liveLocs.length === 0) return "";
      const scannedKeys = new Set((t.source_allocations || []).map((a) => (a.location_id || "").toLowerCase().replace(/^loc-/, "").replace(/[\s\-_#]/g, "")));
      const notScanned = liveLocs.filter((l) => !scannedKeys.has(l.toLowerCase().replace(/^loc-/, "").replace(/[\s\-_#]/g, "")));
      return (notScanned.length > 0 ? notScanned : liveLocs).join(", ");
    }

    // 1. Direct from task from_location_id or location_code
    const rawTaskLoc = (t.from_location_id || t.location_code || "").trim();
    if (
      rawTaskLoc &&
      rawTaskLoc !== "-" &&
      rawTaskLoc !== "null" &&
      rawTaskLoc !== "undefined" &&
      !/^loc-?(a0?1|b0?1)?$/i.test(rawTaskLoc) &&
      rawTaskLoc !== "A1" &&
      rawTaskLoc !== "ตำแหน่งเริ่มต้น"
    ) {
      return rawTaskLoc.replace(/^loc-/, "");
    }

    const normSku = (t.sku || "").trim().toLowerCase().replace(/^prod-/, "");
    const normPid = (t.product_id || "").trim().toLowerCase().replace(/^prod-/, "");

    // 2. From products prop
    if (products && products.length > 0) {
      const matched = products.find((p) => {
        const pSku = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
        const pId = (p.product_id || "").trim().toLowerCase().replace(/^prod-/, "");
        const pBcode = (p.barcode || "").trim().toLowerCase();
        if (normSku && (pSku === normSku || pId === normSku)) return true;
        if (normPid && (pId === normPid || pSku === normPid)) return true;
        if (t.barcode && pBcode === t.barcode.trim().toLowerCase()) return true;
        return false;
      });

      if (matched) {
        // Direct product location
        const pLoc = (matched.location || "").trim();
        if (pLoc && pLoc !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(pLoc) && pLoc !== "A1") {
          const whNumMatch = (t.from_warehouse_name || t.from_warehouse_id || "").match(/[1-9]/);
          if (whNumMatch && pLoc.includes(",")) {
            const whNum = whNumMatch[0];
            const parts = pLoc.split(",").map((s) => s.trim());
            const matchedPart = parts.find((part) => part.startsWith(whNum) || part.toLowerCase().startsWith(`wh${whNum}`) || part.toLowerCase().startsWith(`loc-${whNum}`));
            if (matchedPart) return matchedPart.replace(/^loc-/, "");
          }
          return pLoc.replace(/^loc-/, "");
        }
      }
    }

    return "";
  };
  if (notifications.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 sm:p-10 text-center border border-[#E8ECEA] shadow-xs space-y-3">
        <div className="w-12 h-12 rounded-xl bg-[#EAF2EE] border border-[#C9DFD4] flex items-center justify-center mx-auto text-[#053425]">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <div className="text-base sm:text-lg font-bold text-slate-900">ไม่มีรายการงานที่กำลังดำเนินการในขณะนี้</div>
          <p className="text-sm text-slate-600 font-medium mt-1 max-w-md mx-auto">
            เมื่อมีการสร้างใบเบิกสินค้า ระบบจะแสดงรายการที่ต้องดำเนินการที่นี่ทันที
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error Banner — ผลลัพธ์ action ที่ล้มเหลว (แทน alert ของเบราว์เซอร์) */}
      {errorBanner && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold leading-relaxed fade-in flex items-start gap-2.5 whitespace-pre-line"
        >
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z" />
          </svg>
          <span className="flex-1">{errorBanner}</span>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              aria-label="ปิดข้อความแจ้งเตือน"
              className="w-11 h-11 -m-2 shrink-0 rounded-xl flex items-center justify-center text-rose-700 hover:bg-rose-100 cursor-pointer transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Task Cards List */}
      <div className="space-y-3.5">
        {notifications.map((t) => {
          const barcode = t.barcode && t.barcode.trim() !== "-" ? t.barcode.trim() : "";
          // วิธีเดิม: แสดงจากข้อมูลที่แนบมากับ task เอง — ถ้า sku/barcode ว่าง ให้ parse จาก
          // note ที่เก็บมาพร้อมใบ (JSON metadata ตอนสร้างใบ) แทนการไปดึงด้วยรหัสสินค้า
          const noteMeta = parseTransferMetadata(t.note);
          const displayBarcode = barcode || (noteMeta.barcode || "").trim();
          const displaySku = (t.sku || "").trim() || (noteMeta.sku || "").trim();
          // สแกนยืนยันตัวตนสินค้าต้องมีบาร์โค้ดหรือ SKU อย่างน้อย 1 ตัว — ถ้าไม่มีเลยให้เตือนบนการ์ด ห้ามปล่อยว่างเงียบ ๆ
          const hasIdentifier = Boolean(displayBarcode || displaySku);
          const isCancelling = cancellingId === t.id;
          const isApproving = approvingId === t.id;
          const isWaitingApproval = t.status === "WAITING_APPROVAL";
          const step = t.current_step || 0; // 0 = Pending, 1 = Scan Prod, 2 = Source Pick, 3 = Dest Putaway, 4 = Done

          // Step badge config — pill แบบ premium: slate = ยังไม่เริ่ม, amber = กำลังดำเนินการ/รออนุมัติ, green = เสร็จสิ้น
          const stepConfig = isWaitingApproval
            ? {
              title: "เบิกแล้ว (รอ Admin อนุมัติ)",
              detail: "",
              badge: "bg-amber-50 text-amber-700 border-amber-200/70",
              dot: "bg-amber-500",
            }
            : step === 1
              ? {
                title: "กำลังสแกนสินค้า",
                detail: "พนักงานกำลังสแกนบาร์โค้ดสินค้าบนตัวสินค้า",
                badge: "bg-amber-50 text-amber-700 border-amber-200/70",
                dot: "bg-amber-500",
              }
              : step === 2
                ? {
                  title: "กำลังหยิบสินค้าต้นทาง",
                  detail: `พนักงานกำลังสแกนตำแหน่งและหยิบของใน ${t.from_warehouse_name}`,
                  badge: "bg-amber-50 text-amber-700 border-amber-200/70",
                  dot: "bg-amber-500",
                }
                  : step === 3
                    ? {
                      title: "กำลังสแกนตำแหน่งปลายทาง",
                      detail: `พนักงานกำลังนำสินค้าเข้าตำแหน่งปลายทางใน ${t.to_warehouse_name}`,
                      badge: "bg-amber-50 text-amber-700 border-amber-200/70",
                      dot: "bg-amber-500",
                    }
                    : step >= 4
                      ? {
                        title: "เบิกสินค้าสำเร็จ",
                        detail: "ตัดสต็อกต้นทางและนำส่งปลายทางแล้ว",
                        badge: "bg-[#EAF5F0] text-[#064E3B] border-[#C9E4D8]",
                        dot: "bg-[#0B5D46]",
                      }
                      : {
                        title: "รอดำเนินการ (ยังไม่เริ่ม)",
                        detail: "สร้างใบงานแล้ว รอพนักงานกดเริ่มงาน",
                        badge: "bg-slate-100 text-slate-600 border-slate-200/70",
                        dot: "bg-slate-400",
                      };

          return (
            <div
              key={t.id}
              {...(!isAdmin && !isWaitingApproval
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": `เปิดงานเบิก ${t.doc_no} — ${t.product_name} ${t.qty.toLocaleString()} ชิ้น`,
                    onClick: () => onSelectTask(t),
                    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                      // ทำงานเฉพาะโฟกัสที่ตัวการ์ด — ปุ่มข้างในจัดการคีย์ของตัวเอง
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectTask(t);
                      }
                    },
                  }
                : {})}
              className={`p-4 sm:p-[18px] rounded-[18px] bg-white border border-[#E7ECE9] shadow-[0_1px_3px_rgba(16,24,40,0.04)] transition-all duration-200 space-y-4 relative min-w-0 max-w-full overflow-hidden group ${!isAdmin && !isWaitingApproval
                ? "cursor-pointer hover:shadow-[0_6px_18px_-8px_rgba(16,24,40,0.12)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0F5C3F]/15"
                : "cursor-default"
              }`}
            >
              {/* Header: เลขเอกสาร + สร้างเมื่อ + Status Pill */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <svg className="w-[18px] h-[18px] text-[#94A09A] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="min-w-0">
                    <div className="font-mono font-semibold text-[13px] sm:text-sm text-[#1E293B] tracking-tight truncate">
                      {t.doc_no}
                    </div>
                    <div className="text-xs text-[#94A09A] mt-0.5">
                      สร้างเมื่อ: {formatThaiDateTime(t.created_at)}
                    </div>
                  </div>
                </div>

                {/* Status Pill */}
                <div className={`shrink-0 px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-medium text-xs ${stepConfig.badge}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${stepConfig.dot}`} />
                  <span>{stepConfig.title}</span>
                  {step > 0 && step < 3 && (
                    <span className="font-mono text-[20px] opacity-70">({step}/3)</span>
                  )}
                </div>
              </div>

              {/* Product Info & Quantity Row */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1 min-w-0">
                  {/* Barcode */}
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-medium text-[#94A09A] shrink-0">บาร์โค้ด</span>
                    <span className="font-mono font-bold text-[15px] sm:text-base text-[#17201D] tracking-wide truncate">
                      {displayBarcode || displaySku}
                    </span>
                  </div>

                  {/* SKU */}
                  <div className="text-[13px] flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-medium text-[#94A09A] shrink-0">SKU</span>
                    <span className="font-mono font-semibold text-[#66736D] truncate">{displaySku}</span>
                  </div>

                  {/* Product Title */}
                  <div className="text-[15px] sm:text-base font-semibold text-[#17201D] leading-[1.45] line-clamp-3">
                    {t.product_name}
                  </div>

                  {/* Current Location (แสดงเฉพาะในรายการที่ต้องไปเบิก ไม่แสดงในแท็บรออนุมัติ) */}
                  {!isWaitingApproval ? (
                    <div className="text-[13px] flex items-center gap-1.5 pt-0.5">
                      <svg className="w-3.5 h-3.5 text-[#94A09A] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-xs font-medium text-[#94A09A] shrink-0">ตำแหน่ง</span>
                      <span className={`font-mono font-semibold truncate ${resolveProductLocation(t) ? "text-[#17201D]" : "text-[#94A09A]"}`}>
                        {resolveProductLocation(t) || "ไม่ระบุ"}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Quantity Chip */}
                <div className="shrink-0 text-right">
                  <div className="px-3 py-2 rounded-xl bg-[#EAF5F0] text-[#064E3B] border border-[#D3E8DD] text-right tabular-nums">
                    <span className="font-mono font-bold text-lg sm:text-xl leading-none">{t.qty.toLocaleString()}</span>
                    <span className="text-xs font-semibold ml-1">ชิ้น</span>
                  </div>
                </div>
              </div>

              {/* แถบเตือนเมื่อสินค้าไม่มีตัวระบุ (SKU/บาร์โค้ด) — ตำแหน่งจะหาไม่ได้และสแกนยืนยันไม่ได้ */}
              {!hasIdentifier && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm" role="status">
                  <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z" />
                  </svg>
                  <span className="flex-1 font-bold leading-relaxed">
                    ข้อมูลสินค้าไม่ครบ — รายการนี้ไม่มี SKU และบาร์โค้ด ระบบตรวจสอบตัวตนสินค้าตอนสแกนไม่ได้ กรุณาแก้ข้อมูลสินค้าในระบบ หรือยกเลิกใบนี้แล้วสร้างใหม่
                  </span>
                </div>
              )}

              {/* Warehouse Route Card */}
              <div className="rounded-[14px] bg-[#F7F9F8] border border-[#EDF1EE] px-4 py-3 space-y-2">
                <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[11px] font-medium text-[#94A09A] leading-none">ต้นทาง</span>
                    <span className="inline-flex px-2.5 py-1 rounded-lg bg-white border border-[#E5EAE7] text-[13px] font-semibold text-[#17201D] truncate">
                      {t.from_warehouse_name}
                    </span>
                  </div>
                  <svg className="w-4 h-4 text-[#94A09A] shrink-0 self-center" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-[11px] font-medium text-[#94A09A] leading-none">ปลายทาง</span>
                    <span className="inline-flex px-2.5 py-1 rounded-lg bg-[#EAF5F0] border border-[#D3E8DD] text-[13px] font-semibold text-[#064E3B] truncate">
                      {t.to_warehouse_name}
                    </span>
                  </div>
                </div>
                {stepConfig.detail && (
                  <div className="flex items-center gap-1.5 text-xs text-[#66736D]">
                    <svg className="w-3.5 h-3.5 text-[#94A09A] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{stepConfig.detail}</span>
                  </div>
                )}
              </div>

              {/* Scanned Locations info if available (แสดงเฉพาะเมื่อพนักงานสแกนจริงแล้วเท่านั้น ไม่ใช่ค่าตำแหน่งจากตอนสร้างใบ) */}
              {(t.to_location_id || (t.source_allocations && t.source_allocations.length > 0) || (t.status === "WAITING_APPROVAL" && t.from_location_id)) && (
                <div className="rounded-[14px] bg-[#F7F9F8] border border-[#EDF1EE] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-[#94A09A]">ตำแหน่งที่สแกนจริง</span>
                    {t.source_allocations && t.source_allocations.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {t.source_allocations.map((a, idx) => (
                          <span key={idx} className="bg-white px-2.5 py-1 rounded-lg border border-[#E5EAE7] font-mono text-[13px] text-[#17201D] font-semibold">
                            ต้นทาง: {a.location_name || a.location_id} ({a.qty.toLocaleString()} ชิ้น)
                          </span>
                        ))}
                      </div>
                    ) : t.from_location_id ? (
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-[#E5EAE7] font-mono text-[13px] text-[#17201D] font-semibold">
                        ต้นทาง: {t.from_location_id}
                      </span>
                    ) : null}
                    <svg className="w-3.5 h-3.5 text-[#94A09A] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    {t.to_location_id && (
                      <span className="bg-[#EAF5F0] px-2.5 py-1 rounded-lg border border-[#D3E8DD] font-mono text-[13px] text-[#064E3B] font-semibold">
                        ปลายทาง: {t.to_location_id}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Action Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                {isWaitingApproval ? (
                  isAdmin && onApproveTask ? (
                    <div className="w-full flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-[200px]">
                        <div className="text-[13px] font-semibold text-amber-700 flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                          <span>พนักงานเบิกสินค้าเรียบร้อยแล้ว รอ Admin อนุมัติ</span>
                        </div>
                        {/* Creator & Performer info */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-[#66736D]">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-xs font-medium text-[#94A09A]">ผู้สร้างใบเบิก:</span>
                            <span className="font-semibold text-[#17201D]">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</span>
                          </span>
                          {(t.moved_by || t.assigned_to_name) && (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs font-medium text-[#94A09A]">ผู้เบิกสินค้า:</span>
                              <span className="font-semibold text-[#064E3B]">{t.moved_by || t.assigned_to_name}</span>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                            เวลาเบิก: {formatThaiDateTime(t.last_active_at || t.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          disabled={isCancelling || isApproving}
                          onClick={(e) => (onRejectTask ? onRejectTask(e, t) : onCancelTask?.(e, t))}
                          className="px-4 min-h-[42px] rounded-xl bg-white hover:bg-[#FFF1F2] text-[#D6455D] border border-rose-200/80 text-sm font-semibold transition-all duration-200 cursor-pointer disabled:opacity-50 active:scale-[0.98]"
                        >
                          {isCancelling ? "กำลังปฏิเสธ..." : "ปฏิเสธ"}
                        </button>
                        <button
                          type="button"
                          disabled={isApproving || isCancelling}
                          onClick={() => onApproveTask?.(t)}
                          className="px-5 min-h-[44px] rounded-xl bg-[#064E3B] hover:bg-[#054237] text-white text-sm font-semibold shadow-sm transition-all duration-200 cursor-pointer disabled:opacity-50 active:scale-[0.98] flex items-center gap-2"
                        >
                          {isApproving ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                              <span>กำลังบันทึก...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              <span>อนุมัติการเบิก</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <div className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200/70 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                          <span>เบิกสินค้าแล้ว (ส่งให้ Admin อนุมัติเรียบร้อยแล้ว)</span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-[#66736D]">
                          <span className="text-xs font-medium text-[#94A09A]">ผู้สร้าง:</span>
                          <span className="font-semibold text-[#17201D]">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</span>
                        </span>
                      </div>
                      {isAdmin && onCancelTask && (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={(e) => onCancelTask(e, t)}
                          className="px-4 min-h-[42px] rounded-xl bg-white hover:bg-[#FFF1F2] text-[#D6455D] border border-rose-200/80 text-sm font-semibold transition-all duration-200 cursor-pointer disabled:opacity-50 active:scale-[0.98] flex items-center gap-1.5"
                        >
                          {isCancelling ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-[#D6455D] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                              <span>กำลังยกเลิก...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-[#D6455D]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              <span>ยกเลิกรายการ</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <div className="w-full flex items-center justify-between gap-3 flex-wrap pt-1">
                    <div className="flex items-center gap-1.5 text-[13px] text-[#66736D] min-w-0">
                      <svg className="w-3.5 h-3.5 text-[#94A09A] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span className="truncate">
                        สร้างโดย <span className="font-semibold text-[#17201D]">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 ml-auto">
                      {isAdmin && onCancelTask && (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={(e) => onCancelTask(e, t)}
                          className="px-4 min-h-[42px] rounded-xl bg-white hover:bg-[#FFF1F2] text-[#D6455D] border border-rose-200/80 text-sm font-semibold transition-all duration-200 cursor-pointer disabled:opacity-50 active:scale-[0.98] flex items-center gap-1.5"
                        >
                          {isCancelling ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-[#D6455D] border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                              <span>กำลังยกเลิก...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-[#D6455D]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              <span>ยกเลิก</span>
                            </>
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onSelectTask(t)}
                        className="px-5 sm:px-6 min-h-[42px] rounded-xl bg-[#064E3B] hover:bg-[#054237] text-white font-semibold text-sm shadow-sm cursor-pointer transition-all duration-200 active:scale-[0.98] flex items-center gap-1.5"
                      >
                        <span>{step === 0 ? "เริ่มเบิกสินค้า / สแกน" : "สแกนต่อ"}</span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
