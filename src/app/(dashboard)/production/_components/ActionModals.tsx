"use client";

import { useEffect, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { ProductionJob } from "@/types/production";
import { formatQty } from "./ui";

// Modal ยืนยันพร้อมเหตุผลบังคับ (ยกเลิกงาน / เปิดงานผลิตต่อ) + Modal ปรับปรุงยอดผลผลิต (ADMIN)

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
  hint,
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
          <p className="mt-1 text-sm font-medium text-slate-500">{hint}</p>
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

// ---- ปรับปรุงยอดผลผลิต (ADMIN) — ห้ามเขียนทับ: สร้างรายการปรับ + ประวัติก่อน–หลัง + ปรับสต็อก ----

interface AdjustModalProps {
  open: boolean;
  job: ProductionJob | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: { new_good_qty: number; new_defect_qty: number; reason: string; idempotency_key: string }) => void;
}

export function AdjustModal({ open, job, submitting, error, onClose, onSubmit }: AdjustModalProps) {
  useEscapeKey(open && !submitting, onClose);
  const [goodText, setGoodText] = useState("");
  const [defectText, setDefectText] = useState("");
  const [reason, setReason] = useState("");
  const [idemKey, setIdemKey] = useState("");

  useEffect(() => {
    if (open && job) {
      setGoodText(String(job.produced_good));
      setDefectText(String(job.defect_total));
      setReason("");
      setIdemKey(`adj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    }
  }, [open, job]);

  if (!open || !job) return null;

  const newGood = Number.isFinite(parseFloat(goodText)) ? Math.max(0, Math.round(parseFloat(goodText) * 100) / 100) : -1;
  const newDefect = Number.isFinite(parseFloat(defectText)) ? Math.max(0, Math.round(parseFloat(defectText) * 100) / 100) : -1;
  const goodDelta = Math.round((newGood - job.produced_good) * 100) / 100;
  const defectDelta = Math.round((newDefect - job.defect_total) * 100) / 100;
  const invalid =
    newGood < 0 ||
    newDefect < 0 ||
    (goodDelta === 0 && defectDelta === 0) ||
    !reason.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-[#101828]/50 backdrop-blur-[2px]" onClick={() => !submitting && onClose()} />
      <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-[#E8ECEA] bg-white shadow-[0_20px_60px_rgba(16,24,40,0.18)] animate-in fade-in zoom-in-95 duration-150 sm:max-w-lg sm:rounded-xl">
        <div className="border-b border-[#EEF1EF] px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">ปรับปรุงยอดผลผลิต</h2>
          <p className="mt-0.5 font-mono text-xs font-semibold text-slate-500">
            {job.job_no} · {job.product_name} ({job.sku})
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-400">
            รายงานเดิมถูกเก็บไว้ทั้งหมด — ระบบสร้าง “รายการปรับปรุง” พร้อมประวัติยอดก่อน–หลังและรายการปรับสต็อก ตรวจสอบย้อนหลังได้
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
          <label className="block">
            <span className="text-xs font-bold text-rose-600">เหตุผลการปรับปรุง (จำเป็น)</span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              placeholder="เช่น นับซ้ำจริง ต้องลดยอดผลิตดี 5 ชิ้น"
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
                ระบบจะปรับสต็อกโกดัง 2 ตามส่วนต่างผลิตดี ({goodDelta > 0 ? "เพิ่ม" : "ลด"} {formatQty(Math.abs(goodDelta))} {job.unit}) ผ่านรายการ ADJUST
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
            onClick={() => onSubmit({ new_good_qty: newGood, new_defect_qty: newDefect, reason: reason.trim(), idempotency_key: idemKey })}
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
