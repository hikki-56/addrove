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

          // Step badge config — สีตาม Design Tokens หัวข้อ 7 (emerald เป็น accent เดียว, amber = รอ, slate = ยังไม่เริ่ม)
          const stepConfig = isWaitingApproval
            ? {
              title: "เบิกแล้ว (รอ Admin อนุมัติ)",
              detail: "",
              badge: "bg-amber-100 text-amber-800 border-amber-200",
              dot: "bg-amber-500",
            }
            : step === 1
              ? {
                title: "กำลังสแกนสินค้า",
                detail: "พนักงานกำลังสแกนบาร์โค้ดสินค้าบนตัวสินค้า",
                badge: "bg-[#DFEDE6] text-[#053425] border-[#C9DFD4]",
                dot: "bg-[#0F5C3F]",
              }
              : step === 2
                ? {
                  title: "กำลังหยิบสินค้าต้นทาง",
                  detail: `พนักงานกำลังสแกนตำแหน่งและหยิบของใน ${t.from_warehouse_name}`,
                  badge: "bg-amber-100 text-amber-700 border-amber-200",
                  dot: "bg-amber-500",
                }
                : step === 3
                  ? {
                    title: "กำลังสแกนตำแหน่งปลายทาง",
                    detail: `พนักงานกำลังนำสินค้าเข้าตำแหน่งปลายทางใน ${t.to_warehouse_name}`,
                    badge: "bg-[#DFEDE6] text-[#053425] border-[#C9DFD4]",
                    dot: "bg-[#0F5C3F]",
                  }
                  : step >= 4
                    ? {
                      title: "เบิกสินค้าสำเร็จ",
                      detail: "ตัดสต็อกต้นทางและนำส่งปลายทางแล้ว",
                      badge: "bg-[#DFEDE6] text-[#053425] border-[#C9DFD4]",
                      dot: "bg-[#0F5C3F]",
                    }
                    : {
                      title: "รอดำเนินการ (ยังไม่เริ่ม)",
                      detail: "สร้างใบงานแล้ว รอพนักงานกดเริ่มงาน",
                      badge: "bg-slate-100 text-slate-700 border-[#E8ECEA]",
                      dot: "bg-slate-500",
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
              className={`p-4 sm:p-5 rounded-2xl bg-white border border-[#E8ECEA] shadow-xs transition-colors duration-150 space-y-3.5 relative min-w-0 max-w-full overflow-hidden ${!isAdmin && !isWaitingApproval
                  ? "cursor-pointer hover:border-[#0F5C3F] hover:shadow-md group focus-visible:outline-none focus-visible:border-[#0F5C3F] focus-visible:ring-4 focus-visible:ring-[#0F5C3F]/20"
                  : "cursor-default"
                }`}
            >
              {/* Top Row: Staff Assigned & Realtime Live Status Badge */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-[#EEF1EF]">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-[#EAF2EE] border border-[#DFEDE6] text-[#053425] flex items-center justify-center shrink-0 shadow-2xs">
                    <svg className="w-5 h-5 text-[#053425]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-800 font-mono font-bold text-sm border border-[#E8ECEA]">
                        {t.doc_no}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600 font-medium mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>สร้างเมื่อ: {formatThaiDateTime(t.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Live Current Step Badge */}
                <div className={`px-3 py-1 rounded-full border flex items-center gap-1.5 font-bold text-sm ${stepConfig.badge}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${stepConfig.dot}`} />
                  <span>{stepConfig.title}</span>
                  {step > 0 && step < 3 && (
                    <span className="font-mono text-[13px]">({step}/3)</span>
                  )}
                </div>
              </div>

              {/* Product Info & Quantity Row */}
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1 min-w-0">
                  {/* Barcode */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold text-slate-700 bg-slate-100 border border-[#E8ECEA] px-2 py-0.5 rounded-lg shrink-0">
                      บาร์โค้ด
                    </span>
                    <span className="font-mono font-bold text-lg sm:text-xl text-slate-900 tracking-wide truncate">
                      {displayBarcode || displaySku}
                    </span>
                  </div>

                  {/* SKU */}
                  <div className="text-sm text-slate-600 font-mono flex items-center gap-2">
                    <span>SKU:</span>
                    <strong className="text-slate-900 font-bold">{displaySku}</strong>
                  </div>

                  {/* Product Title */}
                  <div className={`text-base text-slate-900 font-bold leading-normal line-clamp-2 ${!isAdmin && !isWaitingApproval ? "group-hover:text-[#052B1F] transition-colors" : ""}`}>
                    {t.product_name}
                  </div>

                  {/* Current Location (แสดงเฉพาะในรายการที่ต้องไปเบิก ไม่แสดงในแท็บรออนุมัติ) */}
                  {!isWaitingApproval ? (
                    <div className="text-sm font-mono flex items-center gap-2 pt-0.5">
                      <span className="text-slate-600 font-bold">ตำแหน่ง:</span>
                      <strong className="text-slate-900 font-black">{resolveProductLocation(t) || "ไม่ระบุ"}</strong>
                    </div>
                  ) : null}
                </div>

                {/* Quantity Badge */}
                <div className="shrink-0 text-right">
                  <div className="px-3.5 py-1.5 rounded-xl bg-[#EAF2EE] text-[#052B1F] font-mono font-bold text-lg sm:text-xl border border-[#C9DFD4]">
                    {t.qty.toLocaleString()} <span className="font-sans font-bold text-sm text-[#053425]">ชิ้น</span>
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

              {/* Warehouse Route Bar */}
              <div className="p-3 rounded-xl bg-slate-50 border border-[#E8ECEA] flex flex-wrap items-center justify-between gap-2.5 text-sm">
                <div className="flex items-center gap-2 font-bold">
                  <span className="text-slate-800 bg-white px-2.5 py-1 rounded-lg border border-[#E8ECEA]">
                    {t.from_warehouse_name}
                  </span>
                  <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <span className="text-[#052B1F] bg-[#EAF2EE] px-2.5 py-1 rounded-lg border border-[#C9DFD4] font-bold">
                    {t.to_warehouse_name}
                  </span>
                </div>
                <div className="text-sm text-slate-600 font-medium">
                  {stepConfig.detail}
                </div>
              </div>

              {/* Scanned Locations info if available (แสดงเฉพาะเมื่อพนักงานสแกนจริงแล้วเท่านั้น ไม่ใช่ค่าตำแหน่งจากตอนสร้างใบ) */}
              {(t.to_location_id || (t.source_allocations && t.source_allocations.length > 0) || (t.status === "WAITING_APPROVAL" && t.from_location_id)) && (
                <div className="p-3 rounded-xl bg-slate-50 border border-[#E8ECEA] flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-600 font-bold">ตำแหน่งที่สแกนจริง:</span>
                    {t.source_allocations && t.source_allocations.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {t.source_allocations.map((a, idx) => (
                          <span key={idx} className="bg-white px-2.5 py-1 rounded-lg border border-[#E8ECEA] font-mono text-[13px] text-slate-800 font-bold">
                            ต้นทาง: {a.location_name || a.location_id} ({a.qty.toLocaleString()} ชิ้น)
                          </span>
                        ))}
                      </div>
                    ) : t.from_location_id ? (
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-[#E8ECEA] font-mono text-[13px] text-slate-800 font-bold">
                        ต้นทาง: {t.from_location_id}
                      </span>
                    ) : null}
                    <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    {t.to_location_id && (
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-[#C9DFD4] font-mono text-[13px] text-[#052B1F] font-bold">
                        ปลายทาง: {t.to_location_id}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons Row */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-[#EEF1EF]">
                {isWaitingApproval ? (
                  isAdmin && onApproveTask ? (
                    <div className="w-full flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-[200px]">
                        <div className="text-sm font-bold text-amber-800 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                          <span>พนักงานเบิกสินค้าเรียบร้อยแล้ว รอ Admin อนุมัติ</span>
                        </div>
                        {/* Creator & Performer info */}
                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 text-slate-700 border border-[#E8ECEA] font-medium">
                            <span className="text-slate-600">ผู้สร้างใบเบิก:</span>
                            <strong className="text-slate-900 font-bold">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</strong>
                          </span>
                          {(t.moved_by || t.assigned_to_name) && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#EAF2EE] text-[#04231A] border border-[#C9DFD4] font-medium">
                              <span className="text-[#053425] font-bold">ผู้เบิกสินค้า:</span>
                              <strong className="text-[#031B14] font-bold">{t.moved_by || t.assigned_to_name}</strong>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-[#E8ECEA] font-mono">
                            เวลาเบิก: {formatThaiDateTime(t.last_active_at || t.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={isCancelling || isApproving}
                          onClick={(e) => (onRejectTask ? onRejectTask(e, t) : onCancelTask?.(e, t))}
                          className="px-4 min-h-[44px] rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50 active:scale-95"
                        >
                          {isCancelling ? "กำลังปฏิเสธ..." : "ปฏิเสธ"}
                        </button>
                        <button
                          type="button"
                          disabled={isApproving || isCancelling}
                          onClick={() => onApproveTask?.(t)}
                          className="px-5 min-h-[48px] rounded-xl bg-[#06402B] hover:bg-[#053425] text-white text-sm font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-2"
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
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm text-amber-800 font-bold bg-amber-100 px-3 py-1 rounded-lg border border-amber-200 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                          <span>เบิกสินค้าแล้ว (ส่งให้ Admin อนุมัติเรียบร้อยแล้ว)</span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-[#E8ECEA] text-sm font-medium">
                          <span>ผู้สร้าง:</span>
                          <strong className="text-slate-900 font-bold">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</strong>
                        </span>
                      </div>
                      {isAdmin && onCancelTask && (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={(e) => onCancelTask(e, t)}
                          className="px-4 min-h-[44px] rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-1.5"
                        >
                          {isCancelling ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-rose-600 border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                              <span>กำลังยกเลิก...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              <span>ยกเลิกรายการ</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <div className="w-full flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 text-slate-700 border border-[#E8ECEA] font-medium text-sm">
                        <span>ผู้สร้าง:</span>
                        <strong className="text-slate-900 font-bold">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {isAdmin && onCancelTask && (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={(e) => onCancelTask(e, t)}
                          className="px-4 min-h-[44px] rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold transition-colors cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-1.5"
                        >
                          {isCancelling ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-rose-600 border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                              <span>กำลังยกเลิก...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              <span>ยกเลิก</span>
                            </>
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onSelectTask(t)}
                        className="px-5 min-h-[44px] rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-sm shadow-sm cursor-pointer transition-colors active:scale-95 flex items-center gap-1.5"
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
