"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";

/**
 * Modal ยืนยันแบบอ่านง่ายของบ้าน (แทน window.confirm ตาม UX Spec หัวข้อ 6.4 / W9)
 * - ทวนค่าจริงก่อนบันทึก: เลขเอกสาร (mono) · ชื่อสินค้า · จำนวน (ตัวใหญ่) · เส้นทาง
 * - บอกผลที่จะเกิดล่วงหน้าตามตาราง 6.4 ตรงตัว
 * - ปุ่มยืนยันสีตามการกระทำ: อนุมัติ = emerald · ปฏิเสธ/ยกเลิก/เคลียร์ = rose แบบทำลาย
 * - Esc = ยกเลิก · ปุ่มทำลายแยกฝั่งจากปุ่มรอง · touch target ≥48px
 * - Focus management: โฟกัสปุ่มยกเลิกตอนเปิด, trap Tab ใน dialog, คืนโฟกัส trigger ตอนปิด
 */
export type TransferConfirmAction = "approve" | "reject" | "cancel" | "cleanup";

export interface TransferConfirmDetail {
  action: TransferConfirmAction;
  docNo?: string;
  productName?: string;
  qty?: number;
  /** เส้นทางแบบอ่านง่าย เช่น "โกดัง 1 → โกดัง 2" */
  route?: string;
  /** จำนวนรายการที่จะถูกลบ (ใช้กับ action "cleanup") */
  count?: number;
}

const CONFIRM_TEXT: Record<
  TransferConfirmAction,
  { title: string; confirmLabel: string; resultText: string; destructive: boolean }
> = {
  approve: {
    title: "อนุมัติใบเบิกสินค้า?",
    confirmLabel: "อนุมัติการเบิก",
    resultText: "ระบบจะตัดสต็อกต้นทางและเพิ่มปลายทาง",
    destructive: false,
  },
  reject: {
    title: "ปฏิเสธใบเบิกสินค้า?",
    confirmLabel: "ปฏิเสธ",
    resultText: "ใบงานจะปิดเป็นสถานะปฏิเสธ และไม่มีการตัดสต็อก",
    destructive: true,
  },
  cancel: {
    title: "ยกเลิกใบเบิกสินค้า?",
    confirmLabel: "ยกเลิกใบเบิก",
    resultText: "ใบงานจะถูกยกเลิก พนักงานจะไม่เห็นใบนี้อีก",
    destructive: true,
  },
  cleanup: {
    title: "เคลียร์รายการที่ทำเสร็จแล้ว?",
    confirmLabel: "เคลียร์รายการ",
    resultText: "รายการเหล่านี้ยังอยู่ในหน้าประวัติ",
    destructive: true,
  },
};

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function TransferConfirmDialog({
  detail,
  onConfirm,
  onCancel,
}: {
  detail: TransferConfirmDetail;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const text = CONFIRM_TEXT[detail.action];
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Initial focus ที่ปุ่มยกเลิก (ทางเลือกปลอดภัย) + คืนโฟกัส trigger ตอนปิด
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    return () => {
      previousFocus?.focus?.();
    };
  }, []);

  useEscapeKey(true, onCancel);

  // Trap Tab ให้วนเฉพาะ element ที่โฟกัสได้ภายใน dialog
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 fade-in"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={text.title}
        className="bg-white rounded-2xl shadow-xl border border-[#E8ECEA] w-full max-w-sm p-5 sm:p-6 space-y-3.5 scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-extrabold text-slate-900 leading-snug">{text.title}</h2>

        {detail.docNo ? (
          <p className="font-mono font-bold text-base text-slate-900">{detail.docNo}</p>
        ) : null}

        {detail.productName ? (
          <p className="text-base font-bold text-slate-900 leading-snug">{detail.productName}</p>
        ) : null}

        {typeof detail.qty === "number" ? (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-slate-600">จำนวน</span>
            <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {detail.qty.toLocaleString()}
            </span>
            <span className="text-sm font-bold text-slate-600">ชิ้น</span>
          </div>
        ) : null}

        {typeof detail.count === "number" ? (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-slate-600">รายการที่จะถูกลบ</span>
            <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {detail.count.toLocaleString()}
            </span>
            <span className="text-sm font-bold text-slate-600">รายการ</span>
          </div>
        ) : null}

        {detail.route ? (
          <p className="text-base text-slate-700 font-medium">{detail.route}</p>
        ) : null}

        <p className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed pt-1 border-t border-[#E8ECEA]">
          <svg className="w-4 h-4 shrink-0 mt-0.5 text-[#667085]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{text.resultText}</span>
        </p>

        <div className="flex items-stretch gap-3 pt-1">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[48px] px-4 rounded-xl bg-white border border-black/10 text-slate-700 font-semibold text-sm hover:bg-black/[.04] cursor-pointer transition-colors active:scale-95"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 min-h-[48px] px-4 rounded-xl text-white font-bold text-sm cursor-pointer transition-colors active:scale-95 ${
              text.destructive
                ? "bg-rose-600 hover:bg-rose-700 shadow-lg shadow-rose-600/20"
                : "bg-[#06402B] hover:bg-[#053425] shadow-lg shadow-[#06402B]/20"
            }`}
          >
            {text.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ควบคุม TransferConfirmDialog แบบ promise-based เพื่อแทนที่ window.confirm
 * โดยไม่ต้องเปลี่ยนโครงสร้างตัวจัดการเดิม:
 *
 *   const ok = await confirmTransfer({ action: "approve", docNo: t.doc_no, ... });
 *   if (!ok) return;
 */
export function useTransferConfirm() {
  const [detail, setDetail] = useState<TransferConfirmDetail | null>(null);
  const [mounted, setMounted] = useState(false);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    // Unmount ระหว่างรอ → ปิด promise ค้างเป็น false กันหน่วงค้าง
    return () => {
      const pending = resolverRef.current;
      resolverRef.current = null;
      pending?.(false);
    };
  }, []);

  const settle = useCallback((value: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDetail(null);
    resolve?.(value);
  }, []);

  const confirmTransfer = useCallback((next: TransferConfirmDetail) => {
    return new Promise<boolean>((resolve) => {
      // กันเรียกซ้อน: ถ้ามี dialog รอคำตอบอยู่ ปิดอันเก่าเป็น false ก่อนเปิดใหม่
      if (resolverRef.current) {
        const pending = resolverRef.current;
        resolverRef.current = null;
        pending(false);
      }
      settledRef.current = false;
      resolverRef.current = resolve;
      setDetail(next);
    });
  }, []);

  // ล็อก scroll พื้นหลังขณะ dialog เปิด
  useEffect(() => {
    if (!detail) return;
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, [detail]);

  const dialogElement = mounted && detail ? (
    <TransferConfirmDialog
      detail={detail}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirmTransfer, dialogElement };
}
