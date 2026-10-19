"use client";

import { useEffect, useMemo, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { ProductionJob } from "@/types/production";
import { formatQty } from "./ui";
import { parseQtyInput, roundQty } from "@/features/production/lib/quantity";
import { M3Banner, M3ErrorBanner, M3Field, M3SubmitLabel, m3Cls } from "@/components/ui/m3";
import { SolarClipboardList, SolarClose, SolarDangerCircle, SolarFlag } from "@/components/icons";

// Modal รายงานผลผลิต (APPROVER) — ยอดเฉพาะรอบนี้ ระบบคำนวณยอดสะสมเอง
// ก่อนยืนยันมีสรุปยอดรอบนี้ + สะสมเทียบเป้าเสมอ · มีของเสีย → บังคับสาเหตุ
// จบงานไม่ครบเป้า/เกินเป้า → บังคับเหตุผล
// idempotency key ไม่ได้สร้างที่นี่ — หน้าที่เรียกใช้ผูก key กับ "การส่งที่ตั้งใจ" ต่องาน
// (lib/idempotency.ts: คงอยู่ข้ามการปิด/เปิด modal จนกว่าเซิร์ฟเวอร์ยืนยันสำเร็จ)

export interface ReportPayload {
  good_qty: number;
  defect_qty: number;
  defect_cause: string;
  note: string;
  report_kind: "PARTIAL" | "FINAL";
  close_reason: string;
}

interface ReportModalProps {
  open: boolean;
  job: ProductionJob | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: ReportPayload) => void;
}

export default function ReportModal({ open, job, submitting, error, onClose, onSubmit }: ReportModalProps) {
  useEscapeKey(open && !submitting, onClose);

  const [goodText, setGoodText] = useState("");
  const [defectText, setDefectText] = useState("");
  const [defectCause, setDefectCause] = useState("");
  const [note, setNote] = useState("");
  const [reportKind, setReportKind] = useState<"PARTIAL" | "FINAL">("PARTIAL");
  const [closeReason, setCloseReason] = useState("");

  useEffect(() => {
    if (open) {
      setGoodText("");
      setDefectText("");
      setDefectCause("");
      setNote("");
      setReportKind("PARTIAL");
      setCloseReason("");
    }
  }, [open]);

  // ไม่ปัดเศษเงียบ ๆ อีกต่อไป — ทศนิยมเกิน 2 ตำแหน่ง/ไม่ใช่ตัวเลข → แจ้ง error และห้ามยืนยัน
  const goodParse = parseQtyInput(goodText);
  const defectParse = parseQtyInput(defectText);
  const good = goodParse.ok ? goodParse.value : 0;
  const defect = defectParse.ok ? defectParse.value : 0;
  const target = job?.target_qty ?? 0;
  const cumGood = roundQty((job?.produced_good ?? 0) + good);
  const cumDefect = roundQty((job?.defect_total ?? 0) + defect);
  const remainingAfter = Math.max(0, roundQty(target - cumGood));
  const overAfter = Math.max(0, roundQty(cumGood - target));
  const isFinal = reportKind === "FINAL";
  const qtyError = !goodParse.ok
    ? `ผลิตดีรอบนี้: ${goodParse.error}`
    : !defectParse.ok
      ? `ของเสียรอบนี้: ${defectParse.error}`
      : null;

  const formError = useMemo(() => {
    if (qtyError) return qtyError;
    if (good + defect <= 0) return "กรอกผลิตดีหรือของเสียอย่างน้อย 1 รายการ";
    if (defect > 0 && !defectCause.trim()) return "มีของเสีย — ต้องระบุสาเหตุของเสีย";
    if (isFinal && (remainingAfter > 0 || overAfter > 0) && !closeReason.trim()) {
      return remainingAfter > 0
        ? `จบงานโดยยังขาดจากเป้าหมาย ${formatQty(remainingAfter)} ${job?.unit ?? ""} — ต้องระบุเหตุผล`
        : `ผลิตดีสะสมเกินเป้าหมาย ${formatQty(overAfter)} ${job?.unit ?? ""} — ต้องระบุเหตุผล`;
    }
    return null;
  }, [qtyError, good, defect, defectCause, isFinal, remainingAfter, overAfter, closeReason, job?.unit]);

  if (!open || !job) return null;

  const qtyBox = (invalid: boolean, strong: boolean) =>
    `flex h-14 items-center justify-center gap-1.5 rounded-lg border bg-white px-3 transition-colors focus-within:border-m3-grey-800 focus-within:ring-1 focus-within:ring-m3-grey-800 ${
      invalid ? "border-m3-error" : strong ? "border-m3-grey-800 border-2" : "border-[rgba(145,158,171,0.32)]"
    }`;
  const qtyInput =
    "w-full min-w-0 bg-transparent text-right font-m3-disp text-2xl font-bold tabular-nums text-m3-grey-800 placeholder:text-m3-grey-400 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none";
  const intentText = !isFinal
    ? "งานยังไม่จบ"
    : remainingAfter > 0
      ? `จบงานที่ยังขาด ${formatQty(remainingAfter)} ${job.unit}`
      : overAfter > 0
        ? `จบงาน — ผลิตเกินเป้า ${formatQty(overAfter)} ${job.unit}`
        : "จบงาน — ครบเป้าหมาย";
  const submitText = (
    <span>
      {isFinal ? "ยืนยันและจบงาน" : "ยืนยันรายงาน"} (ดี {formatQty(good)} · เสีย {formatQty(defect)})
    </span>
  );
  const handleSubmit = () =>
    onSubmit({
      good_qty: good,
      defect_qty: defect,
      defect_cause: defectCause.trim(),
      note: note.trim(),
      report_kind: reportKind,
      close_reason: closeReason.trim(),
    });

  // มือถือ = เต็มจอ (M44–46: ปุ่ม X ซ้ายบน + ปุ่มยืนยันใหญ่ด้านล่าง) · ≥sm = dialog 560px (D32–34)
  return (
    <div className="fixed inset-0 z-50 flex justify-center sm:items-center sm:p-6">
      <div className={`${m3Cls.overlay} hidden sm:block`} onClick={() => !submitting && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="รายงานผลผลิต"
        className="relative flex h-dvh w-full flex-col bg-white animate-in fade-in duration-150 sm:h-auto sm:max-h-[92dvh] sm:max-w-[560px] sm:rounded-2xl sm:shadow-m3-dropdown sm:zoom-in-95"
      >
        <div className="flex items-start gap-3 border-b border-[rgba(145,158,171,0.2)] px-4 py-3 sm:border-0 sm:px-7 sm:pt-6 sm:pb-1">
          <button
            type="button"
            aria-label="ปิด"
            disabled={submitting}
            onClick={onClose}
            className="-ml-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-m3-grey-800 hover:bg-[rgba(145,158,171,0.08)] sm:order-last sm:-mr-2 sm:ml-0 sm:size-9 sm:text-m3-grey-600"
          >
            <SolarClose size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-m3-grey-800 sm:text-xl">รายงานผลผลิต</h2>
            <p className="mt-0.5 truncate text-xs font-medium tabular-nums text-m3-grey-500">
              โต๊ะ {job.table_no} · {job.job_no}
              <span className="hidden sm:inline">
                {" "}· {job.product_name} ({job.sku})
              </span>{" "}
              · รอบที่ {formatQty((job.report_count ?? 0) + 1)}
            </p>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pt-4 pb-6 sm:px-7 sm:pb-2">
          {error && <M3ErrorBanner message={error} />}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-4">
            <label className="block">
              <span className="text-sm font-semibold text-m3-grey-800">ผลิตดีรอบนี้</span>
              <div className={`mt-2 ${qtyBox(!goodParse.ok, true)}`}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={goodText}
                  onChange={(e) => setGoodText(e.target.value)}
                  placeholder="0"
                  disabled={submitting}
                  className={qtyInput}
                />
                <span className="w-1/2 shrink-0 text-sm font-semibold text-m3-grey-600">{job.unit}</span>
              </div>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-m3-grey-800">ของเสียรอบนี้</span>
              <div className={`mt-2 ${qtyBox(!defectParse.ok, false)}`}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={defectText}
                  onChange={(e) => setDefectText(e.target.value)}
                  placeholder="0"
                  disabled={submitting}
                  className={qtyInput}
                />
                <span className="w-1/2 shrink-0 text-sm font-semibold text-m3-grey-600">{job.unit}</span>
              </div>
            </label>
          </div>
          {qtyError && <p className="-mt-3 text-xs font-semibold text-m3-error-dark">{qtyError}</p>}

          {defect > 0 && (
            <M3Field label="สาเหตุของเสีย (จำเป็น)" error={!defectCause.trim()}>
              <input
                type="text"
                value={defectCause}
                onChange={(e) => setDefectCause(e.target.value)}
                placeholder="เช่น วัตถุดิบแตกหัก พิมพ์เพี้ยน"
                className={`h-12 ${!defectCause.trim() ? m3Cls.inputError : m3Cls.input}`}
              />
            </M3Field>
          )}

          <M3Field label="หมายเหตุ (ถ้ามี)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น เครื่องหยุด 15 นาทีช่วงบ่าย"
              className={`h-12 ${m3Cls.input}`}
            />
          </M3Field>

          <div className="grid grid-cols-2 gap-2" role="group" aria-label="ประเภทรายงาน">
            {(["PARTIAL", "FINAL"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={reportKind === k}
                disabled={submitting}
                onClick={() => setReportKind(k)}
                className={`m3-btn h-12 ${reportKind === k ? "m3-btn-dark" : "m3-btn-outline"}`}
              >
                {k === "PARTIAL" ? <SolarClipboardList size={18} /> : <SolarFlag size={18} />}
                {k === "PARTIAL" ? "รายงานบางส่วน" : "จบงาน"}
              </button>
            ))}
          </div>

          {/* สรุปยอดก่อนยืนยัน — กันกรอกผิด */}
          <div className="rounded-xl border border-dashed border-[rgba(145,158,171,0.32)] p-4">
            <p className="text-sm font-bold text-m3-grey-800">สรุปรอบนี้</p>
            <div className="mt-2.5 space-y-2 text-sm tabular-nums">
              <div className="flex justify-between gap-3">
                <span className="text-m3-grey-600">ดีรอบนี้ / เสียรอบนี้</span>
                <span className="shrink-0 font-bold whitespace-nowrap text-m3-grey-800">
                  +{formatQty(good)} / +{formatQty(defect)} {job.unit}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-m3-grey-600">ผลิตดีสะสมหลังรอบนี้ <span className="text-m3-grey-500">(เดิม {formatQty(job.produced_good)})</span></span>
                <span className="shrink-0 font-bold whitespace-nowrap text-m3-primary-dark">
                  {formatQty(cumGood)} / {formatQty(target)} {job.unit}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-m3-grey-600">ของเสียสะสม <span className="text-m3-grey-500">(เดิม {formatQty(job.defect_total)})</span></span>
                <span className="shrink-0 font-bold whitespace-nowrap text-m3-error-dark">
                  {formatQty(cumDefect)} {job.unit}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-m3-grey-600">สต็อกเข้าโกดัง 2</span>
                <span className="shrink-0 font-bold whitespace-nowrap text-m3-grey-800">
                  +{formatQty(good)} {job.unit}
                </span>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-m3-grey-600">
              <SolarDangerCircle size={16} className="shrink-0 text-m3-grey-500" />
              <span>
                <b className="font-bold text-m3-grey-800">การส่งที่ตั้งใจ:</b> {intentText}
              </span>
            </p>
            <div className="mt-3 space-y-2">
              {remainingAfter > 0 && (
                <M3Banner tone="warning">
                  {isFinal
                    ? `จบงานโดยยังขาดจากเป้าหมาย ${formatQty(remainingAfter)} ${job.unit} — ต้องระบุเหตุผล`
                    : `ยังขาดจากเป้าหมาย ${formatQty(remainingAfter)} ${job.unit}`}
                </M3Banner>
              )}
              {overAfter > 0 && (
                <M3Banner tone={isFinal ? "warning" : "info"}>
                  {isFinal
                    ? `ผลิตดีสะสมเกินเป้าหมาย ${formatQty(overAfter)} ${job.unit} — ต้องระบุเหตุผล`
                    : `ผลิตเกินเป้าหมาย ${formatQty(overAfter)} ${job.unit}`}
                </M3Banner>
              )}
              {defect > 0 && (
                <M3Banner tone="info">
                  มีของเสีย — ต้องระบุสาเหตุของเสีย{defectCause.trim() ? " (กรอกแล้ว)" : ""}
                </M3Banner>
              )}
              {isFinal && <M3Banner tone="info">จบงานแล้วจะรายงานเพิ่มไม่ได้</M3Banner>}
            </div>
          </div>

          {isFinal && (remainingAfter > 0 || overAfter > 0) && (
            <label className="block">
              <span className={m3Cls.label}>
                เหตุผล{remainingAfter > 0 ? `จบงานที่ยังขาด ${formatQty(remainingAfter)} ${job.unit}` : `ผลิตเกินเป้า ${formatQty(overAfter)} ${job.unit}`}{" "}
                <span className="text-m3-error">(จำเป็น)</span>
              </span>
              <textarea
                rows={2}
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder={remainingAfter > 0 ? "เช่น วัตถุดิบไม่พอ ต้องปิดงานก่อน" : "เช่น ทำเกินตามคำขอของ ADMIN"}
                className={`mt-1.5 resize-none ${!closeReason.trim() ? m3Cls.inputError : m3Cls.input}`}
              />
              {!closeReason.trim() && <p className="mt-1 text-xs font-semibold text-m3-error-dark">ต้องระบุเหตุผลก่อนยืนยัน</p>}
            </label>
          )}
        </div>

        {/* มือถือ: ปุ่มยืนยันใหญ่เต็มความกว้าง (ปิดด้วย X ด้านบน) · ≥sm: ยกเลิก + ยืนยัน ชิดขวา */}
        <div className="border-t border-[rgba(145,158,171,0.2)] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex sm:justify-end sm:gap-3 sm:border-0 sm:px-7 sm:pt-4 sm:pb-7">
          <button type="button" disabled={submitting} onClick={onClose} className={`hidden sm:inline-flex ${m3Cls.btnCancel}`}>
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!!formError || submitting}
            onClick={handleSubmit}
            className="m3-btn m3-btn-primary h-14 w-full text-base shadow-[0_8px_16px_rgba(0,167,111,0.24)] disabled:shadow-none sm:h-11 sm:w-auto sm:px-5 sm:text-sm sm:shadow-none"
          >
            <M3SubmitLabel submitting={submitting}>{submitText}</M3SubmitLabel>
          </button>
        </div>
      </div>
    </div>
  );
}
