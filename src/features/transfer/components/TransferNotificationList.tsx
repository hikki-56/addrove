"use client";

import React from "react";
import type { TransferNotification } from "@/lib/transfer-notification-utils";
import { getInStockSourceLocations, isUsableLocationCode, parseTransferMetadata } from "@/lib/transfer-notification-utils";
import type { Product } from "@/types/models";
import { M3Banner, M3Empty } from "@/components/ui/m3";
import { SolarAltArrowRight, SolarArrowRight, SolarBox, SolarCheckCircle, SolarClose } from "@/components/icons";

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
      <div className="m3-card p-6">
        <M3Empty title="ไม่มีรายการงานที่กำลังดำเนินการในขณะนี้" icon={<SolarCheckCircle size={36} />} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error Banner — ผลลัพธ์ action ที่ล้มเหลว (แทน alert ของเบราว์เซอร์) */}
      {errorBanner && (
        <M3Banner
          tone="error"
          role="alert"
          className="fade-in whitespace-pre-line"
          action={
            onDismissError ? (
              <button
                type="button"
                onClick={onDismissError}
                aria-label="ปิดข้อความแจ้งเตือน"
                className="-m-1.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full opacity-64 transition-opacity hover:opacity-100"
              >
                <SolarClose size={18} />
              </button>
            ) : undefined
          }
        >
          {errorBanner}
        </M3Banner>
      )}

      {/* Task Cards List */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-5">
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
              badge: "m3-label-success",
              dot: "",
            }
            : step === 1
              ? {
                title: "กำลังสแกนสินค้า",
                detail: "พนักงานกำลังสแกนบาร์โค้ดสินค้าบนตัวสินค้า",
                badge: "m3-label-info",
                dot: "",
              }
              : step === 2
                ? {
                  title: "กำลังหยิบสินค้าต้นทาง",
                  detail: `พนักงานกำลังสแกนตำแหน่งและหยิบของใน ${t.from_warehouse_name}`,
                  badge: "m3-label-warning",
                  dot: "",
                }
                  : step === 3
                    ? {
                      title: "กำลังสแกนตำแหน่งปลายทาง",
                      detail: `พนักงานกำลังนำสินค้าเข้าตำแหน่งปลายทางใน ${t.to_warehouse_name}`,
                      badge: "bg-[rgba(142,51,255,0.16)] text-[#5119B7]",
                      dot: "",
                    }
                    : step >= 4
                      ? {
                        title: "เบิกสินค้าสำเร็จ",
                        detail: "ตัดสต็อกต้นทางและนำส่งปลายทางแล้ว",
                        badge: "m3-label-success",
                        dot: "",
                      }
                      : {
                        title: "รอดำเนินการ (ยังไม่เริ่ม)",
                        detail: "สร้างใบงานแล้ว รอพนักงานกดเริ่มงาน",
                        badge: "m3-label-default",
                        dot: "",
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
              className={`m3-card group relative min-w-0 max-w-full space-y-4 overflow-hidden p-5 transition-shadow duration-200 sm:p-6 ${!isAdmin && !isWaitingApproval
                ? "cursor-pointer hover:shadow-m3-dropdown focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3-grey-800"
                : "cursor-default"
              }`}
            >
              {/* Header: เลขเอกสาร + สร้างเมื่อ + Status Pill */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-base font-bold tabular-nums text-m3-grey-800">
                      {t.doc_no}
                    </div>
                    <div className="text-xs text-m3-grey-500 mt-0.5">
                      สร้างเมื่อ: {formatThaiDateTime(t.created_at)}
                    </div>
                  </div>
                </div>

                {/* Status Pill */}
                <div className={`m3-label shrink-0 gap-1 ${stepConfig.badge}`}>
                  <span>{stepConfig.title}</span>
                  {step > 0 && step < 3 && (
                    <span className="tabular-nums opacity-72">({step}/3)</span>
                  )}
                </div>
              </div>

              {/* Product Info & Quantity Row */}
              <div className="flex items-start justify-between gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-m3-grey-200 text-m3-grey-500">
                  <SolarBox size={24} />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  {/* Product Title */}
                  <div className="line-clamp-3 text-[15px] font-bold leading-snug text-m3-grey-800">{t.product_name}</div>

                  {/* Barcode · SKU */}
                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-m3-grey-500">
                    <span>บาร์โค้ด</span>
                    <span className="truncate tabular-nums">{displayBarcode || displaySku}</span>
                    {displaySku && displaySku !== (displayBarcode || displaySku) ? <span className="tabular-nums">· SKU {displaySku}</span> : null}
                  </div>

                  {/* Current Location (แสดงเฉพาะในรายการที่ต้องไปเบิก ไม่แสดงในแท็บรออนุมัติ) */}
                  {!isWaitingApproval ? (
                    <div className="flex items-center gap-1.5 pt-1 text-sm">
                      <span className="shrink-0 text-xs text-m3-grey-500">ตำแหน่ง</span>
                      <span className={`truncate font-bold tabular-nums ${resolveProductLocation(t) ? "text-m3-grey-800" : "text-m3-grey-500"}`}>
                        {resolveProductLocation(t) || "ไม่ระบุ"}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Quantity Chip */}
                <div className="shrink-0 text-right">
                  <div className="text-right tabular-nums text-m3-grey-800">
                    <span className="font-m3-disp text-2xl leading-none font-bold">{t.qty.toLocaleString()}</span>
                    <span className="ml-1 text-xs text-m3-grey-500">ชิ้น</span>
                  </div>
                </div>
              </div>

              {/* แถบเตือนเมื่อสินค้าไม่มีตัวระบุ (SKU/บาร์โค้ด) — ตำแหน่งจะหาไม่ได้และสแกนยืนยันไม่ได้ */}
              {!hasIdentifier && (
                <M3Banner tone="warning" role="status">สินค้าไม่มี SKU และบาร์โค้ด — แก้ข้อมูลก่อนสแกน</M3Banner>
              )}

              {/* Warehouse Route Card (D18) */}
              <div className="space-y-2">
                <div className="flex items-stretch gap-3">
                  <div className="min-w-0 flex-1 rounded-xl bg-m3-grey-100 px-4 py-3">
                    <div className="text-[11px] text-m3-grey-500">ต้นทาง</div>
                    <div className="truncate text-sm font-bold text-m3-grey-800">{t.from_warehouse_name}</div>
                  </div>
                  <SolarArrowRight size={20} className="shrink-0 self-center text-m3-primary" />
                  <div className="min-w-0 flex-1 rounded-xl bg-[rgba(0,167,111,0.08)] px-4 py-3">
                    <div className="text-[11px] text-m3-grey-500">ปลายทาง</div>
                    <div className="truncate text-sm font-bold text-m3-primary-dark">{t.to_warehouse_name}</div>
                  </div>
                </div>
                {stepConfig.detail && <p className="text-sm text-m3-grey-600">{stepConfig.detail}</p>}
              </div>

              {/* Scanned Locations info if available (แสดงเฉพาะเมื่อพนักงานสแกนจริงแล้วเท่านั้น ไม่ใช่ค่าตำแหน่งจากตอนสร้างใบ) */}
              {(t.to_location_id || (t.source_allocations && t.source_allocations.length > 0) || (t.status === "WAITING_APPROVAL" && t.from_location_id)) && (
                <div className="border-t border-dashed border-[rgba(145,158,171,0.32)] pt-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-full text-xs text-m3-grey-500">ตำแหน่งที่สแกนจริง</span>
                    {t.source_allocations && t.source_allocations.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {t.source_allocations.map((a, idx) => (
                          <span key={idx} className="m3-label m3-label-default tabular-nums">
                            ต้นทาง: {a.location_name || a.location_id} ({a.qty.toLocaleString()} ชิ้น)
                          </span>
                        ))}
                      </div>
                    ) : t.from_location_id ? (
                      <span className="m3-label m3-label-default tabular-nums">
                        ต้นทาง: {t.from_location_id}
                      </span>
                    ) : null}
                    {t.to_location_id && <SolarArrowRight size={14} className="shrink-0 text-m3-grey-500" />}
                    {t.to_location_id && (
                      <span className="m3-label m3-label-primary tabular-nums">
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
                        <p className="text-sm text-m3-grey-600">ตัดสต็อกต้นทางและนำส่งปลายทางแล้ว — รออนุมัติ</p>
                        {/* Creator & Performer info */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-m3-grey-600">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-xs font-medium text-m3-grey-500">ผู้สร้างใบเบิก:</span>
                            <span className="font-semibold text-m3-grey-800">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</span>
                          </span>
                          {(t.moved_by || t.assigned_to_name) && (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs font-medium text-m3-grey-500">ผู้เบิกสินค้า:</span>
                              <span className="font-semibold text-m3-primary-dark">{t.moved_by || t.assigned_to_name}</span>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1.5 tabular-nums text-xs">
                            เวลาเบิก: {formatThaiDateTime(t.last_active_at || t.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="flex w-full items-center gap-2.5">
                        <button
                          type="button"
                          disabled={isCancelling || isApproving}
                          onClick={(e) => (onRejectTask ? onRejectTask(e, t) : onCancelTask?.(e, t))}
                          className="m3-btn h-11 bg-[rgba(255,86,48,0.16)] px-4 text-m3-error-dark hover:bg-[rgba(255,86,48,0.24)] disabled:opacity-48"
                        >
                          {isCancelling ? "กำลังปฏิเสธ..." : "ปฏิเสธ"}
                        </button>
                        <button
                          type="button"
                          disabled={isApproving || isCancelling}
                          onClick={() => onApproveTask?.(t)}
                          className="m3-btn m3-btn-primary h-11 flex-1 gap-2 px-5 disabled:opacity-48"
                        >
                          {isApproving ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                              <span>กำลังบันทึก...</span>
                            </>
                          ) : (
                            <>
                              <span>อนุมัติการเบิก</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <div className="m3-label m3-label-warning">
                          <span>เบิกแล้ว — รออนุมัติ</span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-m3-grey-600">
                          <span className="text-xs font-medium text-m3-grey-500">ผู้สร้าง:</span>
                          <span className="font-semibold text-m3-grey-800">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</span>
                        </span>
                      </div>
                      {isAdmin && onCancelTask && (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={(e) => onCancelTask(e, t)}
                          className="m3-btn m3-btn-outline h-11 gap-1.5 px-4 text-m3-error-dark disabled:opacity-48"
                        >
                          {isCancelling ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-m3-error border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                              <span>กำลังยกเลิก...</span>
                            </>
                          ) : (
                            <>
                              <span>ยกเลิกรายการ</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <div className="w-full flex items-center justify-between gap-3 flex-wrap pt-1">
                    <div className="flex items-center gap-1.5 text-[13px] text-m3-grey-600 min-w-0">
                      <span className="truncate">
                        สร้างโดย <span className="font-semibold text-m3-grey-800">{t.created_by_name || t.created_by || "ผู้ดูแลระบบ (Admin)"}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 ml-auto">
                      {isAdmin && onCancelTask && (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={(e) => onCancelTask(e, t)}
                          className="m3-btn m3-btn-outline h-11 gap-1.5 px-4 text-m3-error-dark disabled:opacity-48"
                        >
                          {isCancelling ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-m3-error border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
                              <span>กำลังยกเลิก...</span>
                            </>
                          ) : (
                            <>
                              <span>ยกเลิก</span>
                            </>
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onSelectTask(t)}
                        className="m3-btn m3-btn-dark h-11 gap-1.5 px-5 active:scale-[0.98]"
                      >
                        <span>{step === 0 ? "เริ่มเบิกสินค้า / สแกน" : "สแกนต่อ"}</span>
                        <SolarAltArrowRight size={16} />
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
