"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { M3IconCircle, m3Cls } from "@/components/ui/m3";
import { SolarCheckCircle, SolarDangerTriangle } from "@/components/icons";

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
    resultText: "ลดสต็อกต้นทาง เพิ่มปลายทาง",
    destructive: false,
  },
  reject: {
    title: "ปฏิเสธใบเบิกสินค้า?",
    confirmLabel: "ปฏิเสธ",
    resultText: "ปฏิเสธใบงาน โดยไม่ตัดสต็อก",
    destructive: true,
  },
  cancel: {
    title: "ยกเลิกใบเบิกสินค้า?",
    confirmLabel: "ยกเลิกใบเบิก",
    resultText: "ยกเลิกใบงานและนำออกจากคิว",
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

  const subtitle = [detail.docNo, detail.productName].filter(Boolean).join(" · ");

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-end justify-center bg-m3-grey-800/48 fade-in sm:items-center sm:p-6"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={text.title}
        className={`${m3Cls.sheet} sm:max-w-[400px]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-4 px-5 pt-7 pb-2 text-center sm:px-7">
          <div className="flex justify-center">
            <M3IconCircle tone={text.destructive ? "error" : "primary"}>
              {text.destructive ? <SolarDangerTriangle size={26} /> : <SolarCheckCircle size={26} />}
            </M3IconCircle>
          </div>
          <div>
            <h2 className="text-xl font-bold leading-snug text-m3-grey-800">{text.title}</h2>
            {subtitle ? <p className="mt-1 text-sm tabular-nums text-m3-grey-600">{subtitle}</p> : null}
            {detail.route ? <p className="mt-0.5 text-sm text-m3-grey-600">{detail.route}</p> : null}
          </div>

          {typeof detail.qty === "number" ? (
            <div className="flex items-baseline justify-center gap-2 rounded-xl bg-m3-grey-100 px-4 py-4">
              <span className="text-sm text-m3-grey-600">จำนวน</span>
              <span className="font-m3-disp text-[28px] font-bold leading-none tabular-nums text-m3-grey-800">{detail.qty.toLocaleString()}</span>
              <span className="text-sm text-m3-grey-600">ชิ้น</span>
            </div>
          ) : null}

          {typeof detail.count === "number" ? (
            <div className="flex items-baseline justify-center gap-2 rounded-xl bg-m3-grey-100 px-4 py-4">
              <span className="text-sm text-m3-grey-600">รายการที่จะถูกลบ</span>
              <span className="font-m3-disp text-[28px] font-bold leading-none tabular-nums text-m3-grey-800">{detail.count.toLocaleString()}</span>
              <span className="text-sm text-m3-grey-600">รายการ</span>
            </div>
          ) : null}

          <p className="text-sm text-m3-grey-600">{text.resultText}</p>
        </div>

        <div className="flex items-stretch gap-3 px-5 pt-4 pb-5 sm:px-7 sm:pb-7">
          <button ref={cancelButtonRef} type="button" onClick={onCancel} className={`${m3Cls.btnCancel} h-12 flex-1`}>
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`${text.destructive ? m3Cls.btnDanger : m3Cls.btnPrimary} h-12 flex-1`}
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
