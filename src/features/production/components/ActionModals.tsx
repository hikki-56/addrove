"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { ProductionJob } from "@/types/production";
import { formatQty, PriorityBadge } from "./ui";
import { ProductionMaterialSummary } from "./MaterialStockLocations";
import { M3Dialog, M3ErrorBanner, M3NumberTile, M3SubmitLabel, m3Cls, type M3IconTone } from "@/components/ui/m3";
import { SolarCheckCircle, SolarDangerTriangle, SolarPen } from "@/components/icons";
import { parseQtyInput, roundQty } from "@/features/production/lib/quantity";

// Modal ยืนยันพร้อมเหตุผลบังคับ (ยกเลิกงาน / เปิดงานผลิตต่อ) + Modal ยืนยันทั่วไป (เช่น เริ่มผลิต)
// + Modal ปรับปรุงยอดผลผลิต (ADMIN)

interface ReasonModalProps {
  open: boolean;
  title: string;
  hint: string;
  reasonLabel: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

export function ReasonModal({
  open,
  title,
  reasonLabel,
  confirmLabel,
  tone = "primary",
  submitting,
  error,
  onClose,
  onSubmit,
}: ReasonModalProps) {
  useEscapeKey(open && !submitting, onClose);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;
  const isDanger = tone === "danger";

  return (
    <M3Dialog
      title={title}
      icon={isDanger ? <SolarDangerTriangle size={26} /> : <SolarPen size={26} />}
      iconTone={isDanger ? "error" : "primary"}
      onBackdrop={() => !submitting && onClose()}
      footer={
        <>
          <button type="button" disabled={submitting} onClick={onClose} className={m3Cls.btnCancel}>
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!reason.trim() || submitting}
            onClick={() => onSubmit(reason.trim())}
            className={isDanger ? m3Cls.btnDanger : m3Cls.btnPrimary}
          >
            <M3SubmitLabel submitting={submitting}>{confirmLabel}</M3SubmitLabel>
          </button>
        </>
      }
    >
      {error && <M3ErrorBanner message={error} />}
      <label className="block">
        <span className={m3Cls.label}>
          {reasonLabel} <span className="text-m3-error">*</span>
        </span>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={submitting}
          className={`mt-1.5 resize-none ${m3Cls.input}`}
        />
      </label>
    </M3Dialog>
  );
}

// ---- ยืนยันทั่วไป (ไม่ต้องกรอกเหตุผล) — แทน window.confirm ด้วยแพทเทิร์นเดียวกับ ReasonModal ----

interface ConfirmModalProps {
  open: boolean;
  title: string;
  hint?: string;
  /** รายละเอียดที่ต้องตรวจก่อนยืนยัน (เช่น สินค้า เป้าหมาย หมายเหตุ) */
  children?: ReactNode;
  confirmLabel: ReactNode;
  tone?: "danger" | "primary";
  /** ไอคอนหัว dialog (D29/D31) — ไม่ระบุ = ตาม tone */
  icon?: ReactNode;
  iconTone?: M3IconTone;
  /** ความกว้าง dialog บนจอ ≥sm (D29 = 560px) */
  widthClass?: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  tone = "primary",
  icon,
  iconTone,
  widthClass,
  submitting,
  error,
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  useEscapeKey(open && !submitting, onClose);
  if (!open) return null;
  const isDanger = tone === "danger";

  return (
    <M3Dialog
      title={title}
      icon={icon ?? (isDanger ? <SolarDangerTriangle size={26} /> : <SolarCheckCircle size={26} />)}
      iconTone={iconTone ?? (isDanger ? "error" : "primary")}
      widthClass={widthClass}
      onBackdrop={() => !submitting && onClose()}
      footer={
        <>
          <button type="button" disabled={submitting} onClick={onClose} className={m3Cls.btnCancel}>
            ยกเลิก
          </button>
          <button type="button" disabled={submitting} onClick={onConfirm} className={isDanger ? m3Cls.btnDanger : m3Cls.btnPrimary}>
            <M3SubmitLabel submitting={submitting}>{confirmLabel}</M3SubmitLabel>
          </button>
        </>
      }
    >
      {(error || children) && (
        <>
          {error && <M3ErrorBanner message={error} />}
          {children}
        </>
      )}
    </M3Dialog>
  );
}

/** สรุปงานในการ์ดยืนยันเริ่มผลิต — สินค้า โต๊ะ เป้าหมาย หมายเหตุ */
export function StartJobSummary({ job }: { job: ProductionJob }) {
  return (
    <div className="space-y-3">
    <div className="rounded-xl bg-m3-grey-100 p-4">
      <div className="flex items-start gap-3">
        <M3NumberTile className="size-9 text-lg">{job.table_no}</M3NumberTile>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-m3-grey-800">{job.product_name}</p>
            <PriorityBadge priority={job.priority} />
          </div>
          <p className="mt-0.5 text-xs tabular-nums text-m3-grey-600">
            {job.job_no} · {job.sku} · โต๊ะ {job.table_no}
          </p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-dashed border-[rgba(145,158,171,0.32)] pt-3 text-sm">
        <dt className="text-m3-grey-600">เป้าหมาย</dt>
        <dd className="text-right font-m3-disp text-base font-bold tabular-nums text-m3-grey-800">
          {formatQty(job.target_qty)} <span className="font-m3 text-xs font-semibold text-m3-grey-600">{job.unit}</span>
        </dd>
        {job.note && (
          <>
            <dt className="text-m3-grey-600">หมายเหตุ</dt>
            <dd className="text-right font-medium text-m3-grey-800">{job.note}</dd>
          </>
        )}
      </dl>
    </div>
    {job.material_plan && <ProductionMaterialSummary plan={job.material_plan} />}
    </div>
  );
}

// ---- ปรับปรุงยอดผลผลิต (ADMIN) — ห้ามเขียนทับ: สร้างรายการปรับ + ประวัติก่อน–หลัง + ปรับสต็อก ----

interface AdjustModalProps {
  open: boolean;
  job: ProductionJob | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: AdjustPayload) => void;
}

/** idempotency key แนบโดยหน้าที่เรียกใช้ (lib/idempotency.ts) — ไม่สร้างใหม่ทุกครั้งที่เปิด modal */
export interface AdjustPayload {
  new_good_qty: number;
  new_defect_qty: number;
  reason: string;
}

export function AdjustModal({ open, job, submitting, error, onClose, onSubmit }: AdjustModalProps) {
  useEscapeKey(open && !submitting, onClose);
  const [goodText, setGoodText] = useState("");
  const [defectText, setDefectText] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open && job) {
      setGoodText(String(job.produced_good));
      setDefectText(String(job.defect_total));
      setReason("");
    }
  }, [open, job]);

  if (!open || !job) return null;

  // ยอดใหม่ต้องกรอก (≥ 0) ทศนิยมไม่เกิน 2 ตำแหน่ง — ไม่ปัดเศษเงียบ ๆ
  const goodParse = parseQtyInput(goodText, { allowEmpty: false });
  const defectParse = parseQtyInput(defectText, { allowEmpty: false });
  const newGood = goodParse.ok ? goodParse.value : -1;
  const newDefect = defectParse.ok ? defectParse.value : -1;
  const goodDelta = goodParse.ok ? roundQty(newGood - job.produced_good) : 0;
  const defectDelta = defectParse.ok ? roundQty(newDefect - job.defect_total) : 0;
  const qtyError = !goodParse.ok
    ? `ผลิตดีสะสมใหม่: ${goodParse.error}`
    : !defectParse.ok
      ? `ของเสียสะสมใหม่: ${defectParse.error}`
      : null;
  const invalid = !!qtyError || (goodDelta === 0 && defectDelta === 0) || !reason.trim();

  return (
    <M3Dialog
      title="ปรับปรุงยอดผลผลิต"
      subtitle={`${job.job_no} · ${job.product_name} (${job.sku})`}
      hint="ไม่เขียนทับยอดเดิม — ระบบสร้างรายการปรับ บันทึกประวัติก่อน–หลัง และปรับสต็อกตามส่วนต่าง"
      icon={<SolarPen size={26} />}
      iconTone="warning"
      widthClass="sm:max-w-[560px]"
      onBackdrop={() => !submitting && onClose()}
      footer={
        <>
          <button type="button" disabled={submitting} onClick={onClose} className={m3Cls.btnCancel}>
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={invalid || submitting}
            onClick={() => onSubmit({ new_good_qty: newGood, new_defect_qty: newDefect, reason: reason.trim() })}
            className={m3Cls.btnPrimary}
          >
            <M3SubmitLabel submitting={submitting}>ยืนยันการปรับปรุง</M3SubmitLabel>
          </button>
        </>
      }
    >
      {error && <M3ErrorBanner message={error} />}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={m3Cls.label}>ผลิตดีสะสมใหม่ (เดิม {formatQty(job.produced_good)})</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={goodText}
            disabled={submitting}
            onChange={(e) => setGoodText(e.target.value)}
            className={`mt-1.5 text-center font-m3-disp text-xl font-bold tabular-nums ${m3Cls.input}`}
          />
        </label>
        <label className="block">
          <span className={m3Cls.label}>ของเสียสะสมใหม่ (เดิม {formatQty(job.defect_total)})</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={defectText}
            disabled={submitting}
            onChange={(e) => setDefectText(e.target.value)}
            className={`mt-1.5 text-center font-m3-disp text-xl font-bold tabular-nums ${m3Cls.input}`}
          />
        </label>
      </div>
      {qtyError && <p className="-mt-2 text-xs font-semibold text-m3-error-dark">{qtyError}</p>}
      <label className="block">
        <span className={m3Cls.label}>
          เหตุผลการปรับปรุง <span className="text-m3-error">*</span>
        </span>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={submitting}
          className={`mt-1.5 resize-none ${m3Cls.input}`}
        />
      </label>
      <div className="rounded-xl border border-dashed border-[rgba(145,158,171,0.32)] p-4 text-sm tabular-nums">
        <div className="flex justify-between">
          <span className="text-m3-grey-600">ส่วนต่างผลิตดี</span>
          <span className={`font-bold ${goodDelta > 0 ? "text-m3-primary-dark" : goodDelta < 0 ? "text-m3-error-dark" : "text-m3-grey-800"}`}>
            {goodDelta > 0 ? "+" : ""}{formatQty(goodDelta)} {job.unit}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between">
          <span className="text-m3-grey-600">ส่วนต่างของเสีย</span>
          <span className={`font-bold ${defectDelta !== 0 ? "text-m3-error-dark" : "text-m3-grey-800"}`}>
            {defectDelta > 0 ? "+" : ""}{formatQty(defectDelta)} {job.unit}
          </span>
        </div>
        {goodDelta !== 0 && (
          <p className="mt-2.5 border-t border-dashed border-[rgba(145,158,171,0.32)] pt-2.5 text-xs font-semibold text-m3-primary-dark">
            สต็อกโกดัง 2: {goodDelta > 0 ? "เพิ่ม" : "ลด"} {formatQty(Math.abs(goodDelta))} {job.unit}
          </p>
        )}
      </div>
    </M3Dialog>
  );
}
