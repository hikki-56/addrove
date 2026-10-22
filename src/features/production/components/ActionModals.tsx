"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { ProductionJob } from "@/types/production";
import { formatQty } from "./ui";
import { parseQtyInput, roundQty } from "@/features/production/lib/quantity";
import { ProductionMaterialSummary } from "./MaterialStockLocations";

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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-[#101828]/50 backdrop-blur-[2px]" onClick={() => !submitting && onClose()} />
      <div className="relative flex max-h-[88dvh] w-full flex-col rounded-t-xl border border-[#E8ECEA] bg-white shadow-[0_20px_60px_rgba(16,24,40,0.18)] animate-in fade-in zoom-in-95 duration-150 sm:max-w-md sm:rounded-xl">
        <div className="border-b border-[#EEF1EF] px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3.5">
              <p className="text-sm font-bold text-rose-800">{error}</p>
            </div>
          )}
          <label className="block">
            <span className={`text-xs font-bold ${isDanger ? "text-rose-600" : "text-slate-500"}`}>{reasonLabel} (จำเป็น)</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              className={`mt-1 w-full resize-none rounded-lg border px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none ${
                isDanger
                  ? "border-rose-200 bg-rose-50/50 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20"
                  : "border-[#E8ECEA] bg-slate-50 focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20"
              }`}
            />
          </label>
        </div>
        <div className="flex gap-2.5 border-t border-[#EEF1EF] px-5 py-4">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="flex-1 rounded-lg border border-[#E8ECEA] bg-slate-100 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!reason.trim() || submitting}
            onClick={() => onSubmit(reason.trim())}
            className={`flex-[1.4] rounded-lg py-3 text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40 ${
              isDanger ? "bg-[#B42318] hover:bg-[#912018]" : "bg-[#06402B] hover:bg-[#0A5C4E]"
            }`}
          >
            {submitting ? (
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- ยืนยันทั่วไป (ไม่ต้องกรอกเหตุผล) — แทน window.confirm ด้วยแพทเทิร์นเดียวกับ ReasonModal ----

interface ConfirmModalProps {
  open: boolean;
  title: string;
  hint?: string;
  /** รายละเอียดที่ต้องตรวจก่อนยืนยัน (เช่น สินค้า เป้าหมาย หมายเหตุ) */
  children?: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
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
  submitting,
  error,
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  useEscapeKey(open && !submitting, onClose);
  if (!open) return null;
  const isDanger = tone === "danger";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-[#101828]/50 backdrop-blur-[2px]" onClick={() => !submitting && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[88dvh] w-full flex-col rounded-t-xl border border-[#E8ECEA] bg-white shadow-[0_20px_60px_rgba(16,24,40,0.18)] animate-in fade-in zoom-in-95 duration-150 sm:max-w-md sm:rounded-xl"
      >
        <div className="border-b border-[#EEF1EF] px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        </div>
        {(error || children) && (
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3.5">
                <p className="text-sm font-bold text-rose-800">{error}</p>
              </div>
            )}
            {children}
          </div>
        )}
        <div className="flex gap-2.5 border-t border-[#EEF1EF] px-5 py-4">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="flex-1 rounded-lg border border-[#E8ECEA] bg-slate-100 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className={`flex-[1.4] rounded-lg py-3 text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40 ${
              isDanger ? "bg-[#B42318] hover:bg-[#912018]" : "bg-[#06402B] hover:bg-[#0A5C4E]"
            }`}
          >
            {submitting ? (
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** สรุปงานในการ์ดยืนยันเริ่มผลิต — สินค้า โต๊ะ เป้าหมาย หมายเหตุ */
export function StartJobSummary({ job }: { job: ProductionJob }) {
  return (
    <div className="space-y-3">
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-[#E8ECEA] bg-slate-50 p-4 text-sm">
      <dt className="font-semibold text-slate-400">เลขใบสั่งผลิต</dt>
      <dd className="font-mono font-bold text-slate-900">{job.job_no}</dd>
      <dt className="font-semibold text-slate-400">สินค้า</dt>
      <dd className="font-bold text-slate-900">
        {job.product_name} <span className="font-mono text-xs font-semibold text-slate-400">({job.sku})</span>
      </dd>
      <dt className="font-semibold text-slate-400">โต๊ะ</dt>
      <dd className="font-bold text-slate-900">โต๊ะ {job.table_no}</dd>
      <dt className="font-semibold text-slate-400">เป้าหมาย</dt>
      <dd className="font-mono font-bold tabular-nums text-[#06402B]">
        {formatQty(job.target_qty)} {job.unit}
      </dd>
      {job.note && (
        <>
          <dt className="font-semibold text-slate-400">หมายเหตุ</dt>
          <dd className="font-semibold text-slate-700">{job.note}</dd>
        </>
      )}
    </dl>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-[#101828]/50 backdrop-blur-[2px]" onClick={() => !submitting && onClose()} />
      <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-[#E8ECEA] bg-white shadow-[0_20px_60px_rgba(16,24,40,0.18)] animate-in fade-in zoom-in-95 duration-150 sm:max-w-lg sm:rounded-xl">
        <div className="border-b border-[#EEF1EF] px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">ปรับปรุงยอดผลผลิต</h2>
          <p className="mt-0.5 font-mono text-xs font-semibold text-slate-500">
            {job.job_no} · {job.product_name} ({job.sku})
          </p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3.5">
              <p className="text-sm font-bold text-rose-800">{error}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold text-[#06402B]">ผลิตดีสะสมใหม่ (เดิม {formatQty(job.produced_good)})</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={goodText}
                disabled={submitting}
                onChange={(e) => setGoodText(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#E8ECEA] bg-slate-50 px-3 py-3 text-center font-mono text-xl font-black text-[#06402B] focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-rose-600">ของเสียสะสมใหม่ (เดิม {formatQty(job.defect_total)})</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={defectText}
                disabled={submitting}
                onChange={(e) => setDefectText(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[#E8ECEA] bg-slate-50 px-3 py-3 text-center font-mono text-xl font-black text-rose-700 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 focus:outline-none"
              />
            </label>
          </div>
          {qtyError && <p className="-mt-2 text-xs font-bold text-rose-700">{qtyError}</p>}
          <label className="block">
            <span className="text-xs font-bold text-rose-600">เหตุผลการปรับปรุง (จำเป็น)</span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              className="mt-1 w-full resize-none rounded-lg border border-rose-200 bg-rose-50/50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 focus:outline-none"
            />
          </label>
          <div className="rounded-xl border border-[#C9DFD4] bg-[#EAF2EE] p-4 font-mono text-sm font-bold text-[#031B14]">
            <div className="flex justify-between">
              <span>ส่วนต่างผลิตดี</span>
              <span className={goodDelta > 0 ? "text-[#06402B]" : goodDelta < 0 ? "text-rose-700" : ""}>
                {goodDelta > 0 ? "+" : ""}{formatQty(goodDelta)} {job.unit}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>ส่วนต่างของเสีย</span>
              <span className={defectDelta !== 0 ? "text-rose-700" : ""}>
                {defectDelta > 0 ? "+" : ""}{formatQty(defectDelta)} {job.unit}
              </span>
            </div>
            {goodDelta !== 0 && (
              <p className="mt-2 text-[11px] font-semibold text-[#4A7A66]">
                สต็อกโกดัง 2: {goodDelta > 0 ? "เพิ่ม" : "ลด"} {formatQty(Math.abs(goodDelta))} {job.unit}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2.5 border-t border-[#EEF1EF] px-5 py-4">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="flex-1 rounded-lg border border-[#E8ECEA] bg-slate-100 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={invalid || submitting}
            onClick={() => onSubmit({ new_good_qty: newGood, new_defect_qty: newDefect, reason: reason.trim() })}
            className="flex-[1.4] rounded-lg bg-[#06402B] py-3 text-sm font-bold text-white shadow-lg shadow-[#06402B]/20 transition-all hover:bg-[#0A5C4E] active:scale-[0.98] disabled:opacity-40"
          >
            {submitting ? (
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              "ยืนยันการปรับปรุง"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
