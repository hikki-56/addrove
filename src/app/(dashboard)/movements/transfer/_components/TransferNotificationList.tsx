"use client";

import React, { useState, useEffect } from "react";
import type { TransferNotification } from "@/lib/transfer-notification-utils";
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
}: TransferNotificationListProps) {
  const [skuLocationMap, setSkuLocationMap] = useState<Record<string, string>>({});

  // Auto-fetch current warehouse location for items in notifications if missing
  useEffect(() => {
    const missingItems = notifications.filter((t) => {
      const taskLoc = (t.from_location_id || t.location_code || "").trim();
      const hasTaskLoc = taskLoc && taskLoc !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(taskLoc) && taskLoc !== "A1";
      if (hasTaskLoc) return false;

      const normSku = (t.sku || "").trim().toLowerCase().replace(/^prod-/, "");
      if (normSku && skuLocationMap[normSku]) return false;

      const inProducts = products?.some((p) => {
        const pSku = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
        return pSku === normSku && p.location && p.location !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(p.location);
      });
      return !inProducts;
    });

    if (missingItems.length === 0) return;

    const uniqueKeys = Array.from(new Set(missingItems.map((t) => (t.sku || t.product_id || "").trim()).filter(Boolean)));
    uniqueKeys.forEach(async (term) => {
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(term)}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          const normTerm = term.toLowerCase().replace(/^prod-/, "");
          const matched = json.data.find((p: Product) => {
            const pSku = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
            const pId = (p.product_id || "").trim().toLowerCase().replace(/^prod-/, "");
            return pSku === normTerm || pId === normTerm;
          });
          if (matched) {
            const foundLoc = (matched.location || matched.locations_breakdown?.[0]?.location || "").trim();
            if (foundLoc && foundLoc !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(foundLoc) && foundLoc !== "A1") {
              setSkuLocationMap((prev) => ({ ...prev, [normTerm]: foundLoc.replace(/^loc-/, "") }));
            }
          }
        }
      } catch { }
    });
  }, [notifications, products, skuLocationMap]);

  const resolveProductLocation = (t: TransferNotification): string => {
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
        // Match specific source warehouse in locations_breakdown
        if (matched.locations_breakdown && matched.locations_breakdown.length > 0) {
          const normFromWh = (t.from_warehouse_id || "").toLowerCase();
          const normFromWhName = (t.from_warehouse_name || "").toLowerCase();
          const found = matched.locations_breakdown.find((b) => {
            const bId = (b.warehouse_id || "").toLowerCase();
            const bName = (b.warehouse_name || "").toLowerCase();
            return (
              (normFromWh && bId === normFromWh) ||
              (normFromWhName && bName === normFromWhName)
            );
          });
          const bLoc = (found?.location || "").trim();
          if (bLoc && bLoc !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(bLoc) && bLoc !== "A1") {
            return bLoc.replace(/^loc-/, "");
          }
        }

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

    // 3. From fetched skuLocationMap
    if (normSku && skuLocationMap[normSku]) {
      return skuLocationMap[normSku];
    }
    if (normPid && skuLocationMap[normPid]) {
      return skuLocationMap[normPid];
    }

    return "";
  };
  if (notifications.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 sm:p-10 text-center border border-slate-200 shadow-xs space-y-3">
        <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-700">
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
      {/* Task Cards List */}
      <div className="space-y-3.5">
        {notifications.map((t) => {
          const barcode = t.barcode && t.barcode.trim() !== "-" ? t.barcode.trim() : "";
          const isCancelling = cancellingId === t.id;
          const isApproving = approvingId === t.id;
          const isWaitingApproval = t.status === "WAITING_APPROVAL";
          const step = t.current_step || 0; // 0 = Pending, 1 = Scan Prod, 2 = Source Pick, 3 = Dest Putaway, 4 = Done

          // Step badge config
          const stepConfig = isWaitingApproval
            ? {
              title: "เบิกแล้ว (รอ Admin อนุมัติ)",
              detail: "",
              badge: "bg-amber-50 text-amber-900 border-amber-300",
              dot: "bg-amber-500",
            }
            : step === 1
              ? {
                title: "กำลังสแกนสินค้า",
                detail: "พนักงานกำลังสแกนบาร์โค้ดสินค้าบนตัวสินค้า",
                badge: "bg-sky-50 text-sky-700 border-sky-200",
                dot: "bg-sky-500",
              }
              : step === 2
                ? {
                  title: "กำลังหยิบสินค้าต้นทาง",
                  detail: `พนักงานกำลังสแกนตำแหน่งและหยิบของใน ${t.from_warehouse_name}`,
                  badge: "bg-amber-50 text-amber-700 border-amber-200",
                  dot: "bg-amber-500",
                }
                : step === 3
                  ? {
                    title: "กำลังสแกนตำแหน่งปลายทาง",
                    detail: `พนักงานกำลังนำสินค้าเข้าตำแหน่งปลายทางใน ${t.to_warehouse_name}`,
                    badge: "bg-indigo-50 text-indigo-700 border-indigo-200",
                    dot: "bg-indigo-500",
                  }
                  : step >= 4
                    ? {
                      title: "เบิกสินค้าสำเร็จ",
                      detail: "ตัดสต็อกต้นทางและนำส่งปลายทางแล้ว",
                      badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
                      dot: "bg-emerald-500",
                    }
                    : {
                      title: "รอดำเนินการ (ยังไม่เริ่ม)",
                      detail: "สร้างใบงานแล้ว รอพนักงานกดเริ่มงาน",
                      badge: "bg-slate-50 text-slate-700 border-slate-200",
                      dot: "bg-slate-500",
                    };

          return (
            <div
              key={t.id}
              onClick={!isAdmin && !isWaitingApproval ? () => onSelectTask(t) : undefined}
              className={`p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-xs transition-all duration-150 space-y-3.5 relative min-w-0 max-w-full overflow-hidden ${!isAdmin && !isWaitingApproval
                  ? "cursor-pointer hover:border-emerald-500 hover:shadow-md group"
                  : "cursor-default"
                }`}
            >
              {/* Top Row: Staff Assigned & Realtime Live Status Badge */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 shadow-2xs">
                    <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-800 font-mono font-bold text-xs sm:text-sm border border-slate-200">
                        {t.doc_no}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 font-medium mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>สร้างเมื่อ: {formatThaiDateTime(t.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Live Current Step Badge */}
                <div className={`px-3 py-1 rounded-full border flex items-center gap-1.5 font-bold text-xs sm:text-sm ${stepConfig.badge}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${stepConfig.dot}`} />
                  <span>{stepConfig.title}</span>
                  {step > 0 && step < 3 && (
                    <span className="font-mono text-xs opacity-85">({step}/3)</span>
                  )}
                </div>
              </div>

              {/* Product Info & Quantity Row */}
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1 min-w-0">
                  {/* Barcode */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-lg shrink-0">
                      บาร์โค้ด
                    </span>
                    <span className="font-mono font-bold text-base sm:text-lg text-slate-900 tracking-wide truncate">
                      {barcode || t.sku}
                    </span>
                  </div>

                  {/* SKU */}
                  <div className="text-sm text-slate-600 font-mono flex items-center gap-2">
                    <span>SKU:</span>
                    <strong className="text-slate-900 font-bold">{t.sku}</strong>
                  </div>

                  {/* Product Title */}
                  <div className={`text-sm sm:text-base text-slate-900 font-bold leading-normal line-clamp-2 ${!isAdmin && !isWaitingApproval ? "group-hover:text-emerald-800 transition-colors" : ""}`}>
                    {t.product_name}
                  </div>

                  {/* Current Location (แสดงเฉพาะในรายการที่ต้องไปเบิก ไม่แสดงในแท็บรออนุมัติ) */}
                  {!isWaitingApproval ? (
                    <div className="text-xs sm:text-sm font-mono flex items-center gap-2 pt-0.5">
                      <span className="text-slate-500 font-bold">ตำแหน่ง:</span>
                      <strong className="text-slate-900 font-black">{resolveProductLocation(t)}</strong>
                    </div>
                  ) : null}
                </div>

                {/* Quantity Badge */}
                <div className="shrink-0 text-right">
                  <div className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 font-mono font-bold text-sm sm:text-base border border-emerald-200">
                    {t.qty.toLocaleString()} <span className="font-sans font-bold text-xs sm:text-sm text-emerald-700">ชิ้น</span>
                  </div>
                </div>
              </div>

              {/* Warehouse Route Bar */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs sm:text-sm">
                <div className="flex items-center gap-2 font-bold">
                  <span className="text-slate-800 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                    {t.from_warehouse_name}
                  </span>
                  <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <span className="text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 font-bold">
                    {t.to_warehouse_name}
                  </span>
                </div>
                <div className="text-xs text-slate-600 font-medium">
                  {stepConfig.detail}
                </div>
              </div>

              {/* Scanned Locations info if available */}
              {(t.from_location_id || t.to_location_id || (t.source_allocations && t.source_allocations.length > 0)) && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-600 font-bold">ตำแหน่งที่สแกนจริง:</span>
                    {t.source_allocations && t.source_allocations.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {t.source_allocations.map((a, idx) => (
                          <span key={idx} className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 font-mono text-xs text-slate-800 font-bold">
                            ต้นทาง: {a.location_name || a.location_id} ({a.qty.toLocaleString()} ชิ้น)
                          </span>
                        ))}
                      </div>
                    ) : t.from_location_id ? (
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 font-mono text-xs text-slate-800 font-bold">
                        ต้นทาง: {t.from_location_id}
                      </span>
                    ) : null}
                    <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    {t.to_location_id && (
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-emerald-200 font-mono text-xs text-emerald-800 font-bold">
                        ปลายทาง: {t.to_location_id}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons Row */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-slate-100">
                {isWaitingApproval ? (
                  isAdmin && onApproveTask ? (
                    <div className="w-full flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1.5 flex-1 min-w-[200px]">
                        <div className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-amber-500" />
                          <span>พนักงานเบิกสินค้าเรียบร้อยแล้ว รอ Admin อนุมัติ</span>
                        </div>
                        {/* Creator & Performer info */}
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 font-medium">
                            <span className="text-slate-500">ผู้สร้างใบเบิก:</span>
                            <strong className="text-slate-900 font-bold">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</strong>
                          </span>
                          {(t.moved_by || t.assigned_to_name) && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-50 text-indigo-900 border border-indigo-200 font-medium">
                              <span className="text-indigo-600 font-bold">ผู้เบิกสินค้า:</span>
                              <strong className="text-indigo-950 font-bold">{t.moved_by || t.assigned_to_name}</strong>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 font-mono">
                            เวลาเบิก: {formatThaiDateTime(t.last_active_at || t.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isCancelling || isApproving}
                          onClick={(e) => (onRejectTask ? onRejectTask(e, t) : onCancelTask?.(e, t))}
                          className="px-4 py-2.5 rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                        >
                          {isCancelling ? "กำลังปฏิเสธ..." : "ปฏิเสธ"}
                        </button>
                        <button
                          type="button"
                          disabled={isApproving || isCancelling}
                          onClick={() => onApproveTask?.(t)}
                          className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-2"
                        >
                          {isApproving ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
                        <div className="text-xs sm:text-sm text-amber-900 font-bold bg-amber-50 px-3 py-1 rounded-lg border border-amber-200 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-amber-500" />
                          <span>เบิกสินค้าแล้ว (ส่งให้ Admin อนุมัติเรียบร้อยแล้ว)</span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium">
                          <span>ผู้สร้าง:</span>
                          <strong className="text-slate-900 font-bold">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</strong>
                        </span>
                      </div>
                      {isAdmin && onCancelTask && (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={(e) => onCancelTask(e, t)}
                          className="px-4 py-2 rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-1.5"
                        >
                          {isCancelling ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
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
                    <div className="flex items-center gap-2 flex-wrap text-xs sm:text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 font-medium text-xs">
                        <span>ผู้สร้าง:</span>
                        <strong className="text-slate-900 font-bold">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isAdmin && onCancelTask && (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={(e) => onCancelTask(e, t)}
                          className="px-4 py-2 rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-95 flex items-center gap-1.5"
                        >
                          {isCancelling ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
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
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
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
