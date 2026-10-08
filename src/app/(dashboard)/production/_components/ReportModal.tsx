"use client";

import { useEffect, useMemo, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { ProductionJob } from "@/types/production";
import { formatQty } from "./ui";

// Modal รายงานผลผลิต (APPROVER) — ยอดเฉพาะรอบนี้ ระบบคำนวณยอดสะสมเอง
// ก่อนยืนยันมีสรุปยอดรอบนี้ + สะสมเทียบเป้าเสมอ · มีของเสีย → บังคับสาเหตุ
// จบงานไม่ครบเป้า/เกินเป้า → บังคับเหตุผล · idempotency key ผูกกับการเปิด modal ครั้งนั้น (กันกดยืนยันซ้ำ)

interface ReportModalProps {
  open: boolean;
  job: ProductionJob | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: {
    good_qty: number;
    defect_qty: number;
    defect_cause: string;
    note: string;
    report_kind: "PARTIAL" | "FINAL";
    close_reason: string;
    idempotency_key: string;
  }) => void;
}

const inputClass =
  "w-full rounded-lg border border-[#E8ECEA] bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:bg-white focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 focus:outline-none";

function parseRoundQty(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

export default function ReportModal({ open, job, submitting, error, onClose, onSubmit }: ReportModalProps) {
  useEscapeKey(open && !submitting, onClose);

  const [goodText, setGoodText] = useState("");
  const [defectText, setDefectText] = useState("");
  const [defectCause, setDefectCause] = useState("");
  const [note, setNote] = useState("");
  const [reportKind, setReportKind] = useState<"PARTIAL" | "FINAL">("PARTIAL");
  const [closeReason, setCloseReason] = useState("");
  // idempotency key ใหม่ทุกครั้งที่เปิด modal = การกดยืนยัน 1 ครั้ง (กดซ้ำหลังสำเร็จจะถูก server ปฏิเสธโดยคืนผลเดิม)
  const [idemKey, setIdemKey] = useState("");

  useEffect(() => {
    if (open) {
      setGoodText("");
      setDefectText("");
      setDefectCause("");
      setNote("");
      setReportKind("PARTIAL");
      setCloseReason("");
      setIdemKey(`rpt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    }
  }, [open]);

  const good = parseRoundQty(goodText);
  const defect = parseRoundQty(defectText);
  const target = job?.target_qty ?? 0;
  const cumGood = (job?.produced_good ?? 0) + good;
  const cumDefect = (job?.defect_total ?? 0) + defect;
  const remainingAfter = Math.max(0, Math.round((target - cumGood) * 100) / 100);
  const overAfter = Math.max(0, Math.round((cumGood - target) * 100) / 100);
  const isFinal = reportKind === "FINAL";

  const inputInvalid = (v: string) => v !== "" && !Number.isFinite(parseFloat(v));

  const formError = useMemo(() => {
    if (inputInvalid(goodText) || inputInvalid(defectText)) return "กรุณากรอกจำนวนเป็นตัวเลขที่ถูกต้อง";
    if (good + defect <= 0) return "กรอกผลิตดีหรือของเสียอย่างน้อย 1 รายการ";
    if (defect > 0 && !defectCause.trim()) return "มีของเสีย — ต้องระบุสาเหตุของเสีย";
    if (isFinal && (remainingAfter > 0 || overAfter > 0) && !closeReason.trim()) {
      return remainingAfter > 0
        ? `จบงานโดยยังขาดจากเป้าหมาย ${formatQty(remainingAfter)} ${job?.unit ?? ""} — ต้องระบุเหตุผล`
        : `ผลิตดีสะสมเกินเป้าหมาย ${formatQty(overAfter)} ${job?.unit ?? ""} — ต้องระบุเหตุผล`;
    }
    return null;
  }, [goodText, defectText, good, defect, defectCause, isFinal, remainingAfter, overAfter, closeReason, job?.unit]);

  if (!open || !job) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-[#101828]/50 backdrop-blur-[2px]" onClick={() => !submitting && onClose()} />
      <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-[#E8ECEA] bg-white shadow-[0_20px_60px_rgba(16,24,40,0.18)] animate-in fade-in zoom-in-95 duration-150 sm:max-w-lg sm:rounded-xl">
        <div className="border-b border-[#EEF1EF] px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">รายงานผลผลิต</h2>
          <p className="mt-0.5 font-mono text-xs font-semibold text-slate-500">
            {job.job_no} · โต๊ะ {job.table_no} · {job.product_name} ({job.sku})
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
              <span className="text-xs font-bold text-[#06402B]">ผลิตดีรอบนี้ ({job.unit})</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={goodText}
                onChange={(e) => setGoodText(e.target.value)}
                placeholder="0"
                disabled={submitting}
                className={`mt-1 w-full rounded-lg border px-3 py-3 text-center font-mono text-xl font-black text-[#06402B] focus:outline-none ${
                  inputInvalid(goodText)
                    ? "border-[#F04438] bg-[#FEF3F2]"
                    : "border-[#E8ECEA] bg-slate-50 focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20"
                }`}
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-rose-600">ของเสียรอบนี้ ({job.unit})</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={defectText}
                onChange={(e) => setDefectText(e.target.value)}
                placeholder="0"
                disabled={submitting}
                className={`mt-1 w-full rounded-lg border px-3 py-3 text-center font-mono text-xl font-black text-rose-700 focus:outline-none ${
                  inputInvalid(defectText)
                    ? "border-[#F04438] bg-[#FEF3F2]"
                    : "border-[#E8ECEA] bg-slate-50 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20"
                }`}
              />
            </label>
          </div>

          {defect > 0 && (
            <label className="block">
              <span className="text-xs font-bold text-rose-600">สาเหตุของเสีย (จำเป็น)</span>
              <input
                type="text"
                value={defectCause}
                onChange={(e) => setDefectCause(e.target.value)}
                placeholder="เช่น วัตถุดิบแตกหัก พิมพ์เพี้ยน"
                className={`mt-1 ${inputClass} border-rose-200 bg-rose-50/50 focus:border-rose-400 focus:ring-rose-400/20`}
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            {(["PARTIAL", "FINAL"] as const).map((k) => (
              <button
                key={k}
                type="button"
                disabled={submitting}
                onClick={() => setReportKind(k)}
                className={`rounded-lg border-2 px-3 py-2.5 text-sm font-bold transition-all active:scale-[0.98] ${
                  reportKind === k
                    ? k === "FINAL"
                      ? "border-[#06402B] bg-[#06402B] text-white"
                      : "border-[#0F5C3F] bg-[#EAF2EE] text-[#053425]"
                    : "border-[#E8ECEA] bg-white text-slate-500 hover:border-[#C8DBD1]"
                }`}
              >
                {k === "PARTIAL" ? "📋 รายงานบางส่วน" : "🏁 จบงาน"}
              </button>
            ))}
          </div>
          <p className="-mt-2 text-xs font-semibold text-slate-400">
            {isFinal ? "จบงานแล้วจะรายงานเพิ่มไม่ได้จนกว่า ADMIN เปิดงานใหม่" : "รายงานบางส่วน — งานยังอยู่ในสถานะกำลังผลิต"}
          </p>

          {isFinal && (remainingAfter > 0 || overAfter > 0) && (
            <label className="block">
              <span className="text-xs font-bold text-rose-600">
                เหตุผล{remainingAfter > 0 ? `จบงานที่ยังขาด ${formatQty(remainingAfter)} ${job.unit}` : `ผลิตเกินเป้า ${formatQty(overAfter)} ${job.unit}`} (จำเป็น)
              </span>
              <textarea
                rows={2}
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder={remainingAfter > 0 ? "เช่น วัตถุดิบไม่พอ ต้องปิดงานก่อน" : "เช่น ทำเกินตามคำขอของ ADMIN"}
                className="mt-1 resize-none rounded-lg border border-rose-200 bg-rose-50/50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 focus:outline-none"
              />
            </label>
          )}

          <label className="block">
            <span className="text-xs font-bold text-slate-500">หมายเหตุ (ถ้ามี)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น เครื่องหยุด 15 นาทีช่วงบ่าย"
              className={`mt-1 ${inputClass}`}
            />
          </label>

          {/* สรุปยอดก่อนยืนยัน — กันกรอกผิด */}
          <div className="rounded-xl border border-[#C9DFD4] bg-[#EAF2EE] p-4">
            <p className="text-xs font-extrabold uppercase tracking-wide text-[#4A7A66]">สรุปยอดรอบนี้ (ตรวจสอบก่อนยืนยัน)</p>
            <div className="mt-2 space-y-1.5 font-mono text-sm font-bold text-[#031B14]">
              <div className="flex justify-between">
                <span>ผลิตดีรอบนี้</span>
                <span>+{formatQty(good)} {job.unit}</span>
              </div>
              <div className="flex justify-between">
                <span>ของเสียรอบนี้</span>
                <span className="text-rose-700">+{formatQty(defect)} {job.unit}</span>
              </div>
              <div className="flex justify-between border-t border-[#C9DFD4] pt-1.5">
                <span>ดีสะสมใหม่ (เดิม {formatQty(job.produced_good)})</span>
                <span className="text-[#06402B]">{formatQty(cumGood)} / {formatQty(target)} {job.unit}</span>
              </div>
              <div className="flex justify-between">
                <span>เสียสะสมใหม่ (เดิม {formatQty(job.defect_total)})</span>
                <span className="text-rose-700">{formatQty(cumDefect)} {job.unit}</span>
              </div>
              <div className="flex justify-between">
                <span>{remainingAfter > 0 ? "ยังขาดจากเป้าหมาย" : "ผลิตเกินเป้าหมาย"}</span>
                <span className={remainingAfter > 0 ? "text-amber-700" : "text-[#06402B]"}>
                  {remainingAfter > 0 ? formatQty(remainingAfter) : formatQty(overAfter)} {job.unit}
                </span>
              </div>
            </div>
            <p className="mt-2 text-[11px] font-semibold text-[#4A7A66]">
              กดยืนยันแล้วระบบเพิ่มสต็อกสินค้าดี {formatQty(good)} {job.unit} เข้าโกดัง 2 ทันที (ครั้งเดียวต่อรายงาน) และแจ้ง ADMIN
            </p>
          </div>
        </div>

        <div className="flex gap-2.5 border-t border-[#EEF1EF] px-5 py-4">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="flex-1 rounded-lg border border-[#E8ECEA] bg-slate-100 py-3.5 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!!formError || submitting}
            onClick={() =>
              onSubmit({
                good_qty: good,
                defect_qty: defect,
                defect_cause: defectCause.trim(),
                note: note.trim(),
                report_kind: reportKind,
                close_reason: closeReason.trim(),
                idempotency_key: idemKey,
              })
            }
            className="flex-[1.4] rounded-lg bg-[#06402B] py-3.5 text-sm font-bold text-white shadow-lg shadow-[#06402B]/20 transition-all hover:bg-[#0A5C4E] active:scale-[0.98] disabled:opacity-40"
          >
            {submitting ? (
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <span>
                {isFinal ? "ยืนยันและจบงาน" : "ยืนยันรายงาน"} (ดี {formatQty(good)} · เสีย {formatQty(defect)})
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
