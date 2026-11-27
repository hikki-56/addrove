"use client";

import { useEffect, useMemo, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { ProductionJob } from "@/types/production";
import type { ProductionMaterialActual } from "@/types/production-bom";
import { parseQtyInput, roundQty } from "@/features/production/lib/quantity";
import { useProductionReportLocations } from "@/features/production/hooks/use-production-report-locations";
import { M3ErrorBanner, M3SubmitLabel, m3Cls } from "@/components/ui/m3";
import { SolarClose } from "@/components/icons";
import MaterialReportFields, { type MaterialReportValue } from "./MaterialReportFields";
import ReasonSelect from "./ReasonSelect";

export interface ReportPayload {
  daily_close?: boolean;
  materials?: ProductionMaterialActual[];
  receipt_location_id?: string;
  material_reason?: string;
  create_backorder?: boolean;
  good_qty: number;
  defect_qty: number;
  defect_cause: string;
  note: string;
  report_kind: "PARTIAL" | "FINAL";
  close_reason: string;
  carton_over_qty: number;
  carton_short_qty: number;
  carton_over_item_id: string;
  leftover_location_id: string;
}

interface Props {
  open: boolean; job: ProductionJob | null; submitting: boolean; error: string | null;
  onClose: () => void; onSubmit: (payload: ReportPayload) => void; inline?: boolean;
}

export default function ReportModal({ open, job, submitting, error, onClose, onSubmit, inline = false }: Props) {
  useEscapeKey(open && !submitting && !inline, onClose);
  const { receipt, leftover, error: locationError } = useProductionReportLocations();
  const [goodText, setGoodText] = useState("");
  const [defectText, setDefectText] = useState("");
  const [overText, setOverText] = useState("");
  const [shortText, setShortText] = useState("");
  const [overItem, setOverItem] = useState("");
  const [leftoverLocation, setLeftoverLocation] = useState("");
  const [defectCause, setDefectCause] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [materialValue, setMaterialValue] = useState<MaterialReportValue | null>(null);
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    if (open) { setGoodText(""); setDefectText(""); setOverText(""); setShortText(""); setOverItem(""); setLeftoverLocation(""); setDefectCause(""); setCloseReason(""); setAttempted(false); }
    else setMaterialValue(null);
  }, [open, job?.job_no]);

  const goodParse = parseQtyInput(goodText), defectParse = parseQtyInput(defectText);
  const overParse = parseQtyInput(overText), shortParse = parseQtyInput(shortText);
  const good = goodParse.ok ? goodParse.value : 0, defect = defectParse.ok ? defectParse.value : 0;
  const cartonOver = overParse.ok ? overParse.value : 0, cartonShort = shortParse.ok ? shortParse.value : 0;
  const cumGood = roundQty((job?.produced_good || 0) + good), cumDefect = roundQty((job?.defect_total || 0) + defect);
  const remaining = Math.max(0, roundQty((job?.target_qty || 0) - cumGood));
  const over = Math.max(0, roundQty(cumGood - (job?.target_qty || 0)));
  const materialCauses = [...new Set(materialValue?.payload.materials.filter(m => m.scrap_qty > 0).map(m => m.scrap_cause).filter(Boolean) || [])].join(" / ");
  const selectedCause = defectCause.trim() || materialCauses.slice(0, 500);
  const accountedFor = remaining > 0 && defect > 0 && cumGood + cumDefect >= (job?.target_qty || 0);
  const closingReason = closeReason.trim() || (accountedFor && selectedCause ? `ผลิตดี ${cumGood} เสีย ${cumDefect} · ${selectedCause}` : "");
  const hasQuantity = good + defect > 0 || !!materialValue?.payload.materials.some(m => m.used_qty + m.scrap_qty > 0);
  const overItems = useMemo(() => {
    if (!job) return [];
    const items = [{ id: "fg", label: job.product_name, hint: job.sku }];
    for (const material of job.material_plan?.snapshot.items || []) {
      items.push({ id: `rm:${material.item_id}`, label: material.name || material.sku, hint: material.sku });
    }
    return items;
  }, [job]);
  const formError = !goodParse.ok ? `ผลิตดี: ${goodParse.error}` : !defectParse.ok ? `เสีย: ${defectParse.error}`
    : !overParse.ok ? `เกินจากลัง: ${overParse.error}` : !shortParse.ok ? `ขาดจากลัง: ${shortParse.error}`
    : !hasQuantity && !job?.report_count ? "กรอกจำนวนผลิต"
    : job?.material_plan && (!materialValue || materialValue.error) ? materialValue?.error || "ตรวจวัตถุดิบ"
    : defect > 0 && !selectedCause ? "เลือกสาเหตุของเสีย"
    : cartonOver > 0 && !overItem ? "เลือกตัวไหนเกินจากลัง"
    : cartonOver > 0 && !leftoverLocation ? "เลือกที่เก็บของเกิน"
    : cartonOver > 0 && locationError ? locationError
    : (remaining > 0 || over > 0) && !closingReason ? "เลือกเหตุผลปิดงาน" : null;
  if (!open || !job) return null;
  const submit = () => {
    setAttempted(true);
    if (formError) return;
    onSubmit({
      good_qty: good, defect_qty: defect, defect_cause: defect > 0 ? selectedCause : "", note: "", report_kind: "FINAL", daily_close: true,
      close_reason: closingReason, carton_over_qty: cartonOver, carton_short_qty: cartonShort,
      carton_over_item_id: cartonOver > 0 ? overItem : "", leftover_location_id: cartonOver > 0 ? leftoverLocation : "",
      ...(job.material_plan ? { ...materialValue?.payload, create_backorder: false } : {}),
    });
  };
  const qtyField = (label: string, value: string, change: (v: string) => void, unit?: string) => (
    <label className="block text-sm font-semibold">{label}{unit ? ` (${unit})` : ""}
      <input type="number" inputMode="decimal" min="0" step="any" disabled={submitting} placeholder="0" value={value} onChange={e => change(e.target.value)}
        className={`mt-1.5 h-14 text-right text-2xl font-bold tabular-nums ${m3Cls.input}`} />
    </label>
  );
  return <div className={inline ? "" : "fixed inset-0 z-50 flex justify-center sm:items-center sm:p-6"}>
    {!inline && <div className={`${m3Cls.overlay} hidden sm:block`} onClick={() => !submitting && onClose()} />}
    <div role={inline ? "region" : "dialog"} aria-modal={inline ? undefined : true} aria-label="รายงานผลผลิต"
      className={inline ? "w-full" : "relative flex h-dvh w-full flex-col bg-white sm:h-auto sm:max-h-[92dvh] sm:max-w-[560px] sm:rounded-2xl sm:shadow-m3-dropdown"}>
      {!inline && <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-7">
        <div><h2 className="text-lg font-bold">บันทึกผลผลิต</h2><p className="text-sm text-m3-grey-600">{job.product_name}</p></div>
        <button type="button" aria-label="ปิด" disabled={submitting} onClick={onClose} className="m3-btn m3-btn-sm m3-btn-text"><SolarClose size={22} /></button>
      </div>}
      <div className={inline ? "space-y-4" : "flex-1 space-y-4 overflow-y-auto px-4 pb-4 sm:px-7"}>
        {error && <M3ErrorBanner message={error} />}
        <div className="grid grid-cols-2 gap-3">
          {qtyField(job.report_count > 0 ? "ผลิตดีเพิ่ม" : "ผลิตดี", goodText, setGoodText, job.unit)}
          {qtyField(job.report_count > 0 ? "เสียเพิ่ม" : "เสีย", defectText, setDefectText, job.unit)}
          {qtyField("เกินจากลัง", overText, setOverText, "ชิ้น")}
          {qtyField("ขาดจากลัง", shortText, setShortText, "ชิ้น")}
        </div>
        {cartonOver > 0 && <label className="block text-sm font-semibold">ตัวไหนเกินจากลัง
          <select disabled={submitting} value={overItem} onChange={e => setOverItem(e.target.value)} className={`mt-1.5 h-11 w-full ${m3Cls.input}`}>
            <option value="">เลือกสินค้า</option>
            {overItems.map(item => <option key={item.id} value={item.id}>{item.label}{item.hint && item.hint !== item.label ? ` · ${item.hint}` : ""}</option>)}
          </select>
        </label>}
        {cartonOver > 0 && <label className="block text-sm font-semibold">ที่เก็บของเกิน
          <select disabled={submitting} value={leftoverLocation} onChange={e => setLeftoverLocation(e.target.value)} className={`mt-1.5 h-11 w-full ${m3Cls.input}`}>
            <option value="">เลือกที่เก็บ</option>
            {leftover.map(l => <option key={l.location_id} value={l.location_id}>{l.label || l.location_code}</option>)}
          </select>
        </label>}
        {defect > 0 && !job.material_plan && <ReasonSelect label="สาเหตุของเสีย" value={defectCause} options={["ชำรุด", "แตก", "ประกอบเสีย"]} disabled={submitting} onChange={setDefectCause} />}
        {job.material_plan && <MaterialReportFields key={job.job_no} compact dailyClose showErrors={false} plan={job.material_plan} good={good} defect={defect} disabled={submitting} onChange={setMaterialValue} locations={receipt} locationError={locationError} />}
        {hasQuantity && (remaining > 0 || over > 0) && !accountedFor && <ReasonSelect label="เหตุผลปิดงาน" value={closeReason}
          options={["ผลิตไม่ครบ", "วัตถุดิบไม่พอ", "หยุดงาน", "ผลิตเกินเป้า"]} disabled={submitting} onChange={setCloseReason} />}
        {attempted && formError && <p role="alert" className="text-sm font-semibold text-m3-error-dark">{formError}</p>}
      </div>
      <div className={inline ? "mt-4" : "border-t border-[rgba(145,158,171,0.2)] p-4 sm:px-7"}>
        <button type="button" disabled={submitting} onClick={submit} className="m3-btn m3-btn-primary h-12 w-full"><M3SubmitLabel submitting={submitting}>บันทึก</M3SubmitLabel></button>
      </div>
    </div>
  </div>;
}
