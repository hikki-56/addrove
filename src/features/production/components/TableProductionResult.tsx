"use client";

import { useEffect, useState } from "react";
import { useProductionJobDetail, emitProductionUpdated } from "@/features/production/hooks/use-production-data";
import { useSubmitGuard } from "@/features/production/hooks/use-submit-guard";
import { productionApi, isConflict, type ProductionApiResult } from "@/features/production/lib/api";
import { sendWithIdempotency } from "@/features/production/lib/idempotency";
import { PRODUCTION_JOB_STATUS_LABELS } from "@/types/production";
import { M3Banner, M3Loading, M3SubmitLabel } from "@/components/ui/m3";
import ReportModal, { type ReportPayload } from "./ReportModal";
import { formatQty } from "./ui";

interface Props { jobNo: string; role?: string; onBusyChange: (busy: boolean) => void }

export default function TableProductionResult({ jobNo, role, onBusyChange }: Props) {
  const { detail, loading, error, reload } = useProductionJobDetail(jobNo);
  const guard = useSubmitGuard();
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [formVersion, setFormVersion] = useState(0);
  useEffect(() => { onBusyChange(guard.pending); return () => onBusyChange(false); }, [guard.pending, onBusyChange]);
  const job = detail?.job;
  const canReport = role === "ADMIN" || role === "APPROVER";
  const runAction = (action: () => Promise<ProductionApiResult<unknown>>, success: string) => guard.run(async () => {
    setActionError(null);
    setMessage("");
    const result = await action();
    if (!result.success) {
      setActionError(result.message);
      if (isConflict(result)) { emitProductionUpdated(); await reload(); }
      return;
    }
    // Clear only after confirmed success. Failed/retried reports keep the same intent.
    setFormVersion(v => v + 1);
    setMessage(success);
    emitProductionUpdated();
    await reload();
  }, jobNo);
  const report = (payload: ReportPayload) => {
    if (!job) return;
    return runAction(() => sendWithIdempotency(
      { action: "report", jobNo, round: job.report_count + 1, payload: { ...payload } },
      idempotency_key => productionApi(`/api/production/jobs/${encodeURIComponent(jobNo)}/report`, "POST", { ...payload, idempotency_key }),
    ), "บันทึกผลผลิตและตำแหน่งจัดเก็บแล้ว");
  };
  if (loading) return <M3Loading label="กำลังโหลดผลผลิต…" />;
  if (error || !job) return <M3Banner tone="error">{error || "ไม่พบงานผลิต"}</M3Banner>;
  return <div className="space-y-5">
    <div>
      <h2 className="text-lg font-bold text-m3-grey-800">{job.product_name}</h2>
      <p className="mt-1 text-xs text-m3-grey-500">{job.sku} · {job.job_no} · {PRODUCTION_JOB_STATUS_LABELS[job.status]}</p>
    </div>
    <div className="grid grid-cols-3 gap-2">
      {[{ label: "เป้าหมาย", value: job.target_qty }, { label: "ผลิตได้จริงสะสม", value: job.produced_good }, { label: "เสียสะสม", value: job.defect_total }].map(stat =>
        <div key={stat.label} className="rounded-xl bg-m3-grey-100 p-3"><p className="text-xs text-m3-grey-600">{stat.label}</p><p className="mt-1 text-xl font-bold tabular-nums">{formatQty(stat.value)} <span className="text-xs font-normal">{job.unit}</span></p></div>)}
    </div>
    {message && <M3Banner tone="success" role="status">{message}</M3Banner>}
    {job.status !== "IN_PROGRESS" && actionError && <M3Banner tone="error" role="alert">{actionError}</M3Banner>}
    {job.status === "DRAFT" && <M3Banner tone="info">
      <p>งานนี้ยังเป็นฉบับร่าง ยืนยันส่งงานก่อนเริ่มผลิตและบันทึกผล</p>
      {role === "ADMIN" && <button disabled={guard.pending} type="button" className="m3-btn m3-btn-dark mt-3" onClick={() => void runAction(() => productionApi("/api/production/jobs/submit", "POST", { job_nos: [jobNo] }), "ส่งงานผลิตนี้แล้ว")}><M3SubmitLabel submitting={guard.pending}>ยืนยันส่งงานนี้</M3SubmitLabel></button>}
    </M3Banner>}
    {job.status === "WAITING" && <M3Banner tone="info"><p>งานนี้รอเริ่มผลิต</p>
      {canReport && <button disabled={guard.pending} type="button" className="m3-btn m3-btn-dark mt-3" onClick={() => void runAction(() => productionApi(`/api/production/jobs/${encodeURIComponent(jobNo)}/start`, "POST"), "เริ่มผลิตแล้ว")}><M3SubmitLabel submitting={guard.pending}>เริ่มผลิต</M3SubmitLabel></button>}
    </M3Banner>}
    {job.status === "IN_PROGRESS" && canReport && <ReportModal key={`${jobNo}:${formVersion}`} inline open job={job} submitting={guard.pending} error={actionError} onClose={() => { setFormVersion(v => v + 1); setActionError(null); }} onSubmit={report} />}
    {job.status === "IN_PROGRESS" && !canReport && <M3Banner tone="info">ผู้ดูแลระบบหรือผู้รับผิดชอบการผลิตสามารถบันทึกผลผลิตได้</M3Banner>}
    <section aria-label="ผลผลิตที่บันทึกแล้ว" className="space-y-3 border-t border-[rgba(145,158,171,0.2)] pt-4">
      <h3 className="text-sm font-bold">ผลผลิตที่บันทึกแล้วและตำแหน่งจัดเก็บ</h3>
      {!detail?.reports.length ? <p className="text-sm text-m3-grey-500">ยังไม่มีผลผลิตที่บันทึก</p> : detail.reports.map(r => <div key={r.report_id} className="rounded-lg border border-[rgba(145,158,171,0.2)] p-3 text-sm">
        <p className="font-semibold">{r.kind === "ADJUSTMENT" ? "ปรับปรุงยอด" : `รอบที่ ${r.report_no}`} · ผลิตดี {formatQty(r.good_qty)} · เสีย {formatQty(r.defect_qty)} {job.unit}</p>
        <p className="mt-1 text-m3-grey-600">ตำแหน่งจัดเก็บ: {r.receipt_location_code || (r.good_qty > 0 ? "ไม่ได้ระบุ" : "ไม่มีสินค้าดีรับเข้า")}</p>
        {r.defect_cause && <p className="mt-1 text-xs text-m3-grey-500">สาเหตุของเสีย: {r.defect_cause}</p>}
      </div>)}
    </section>
  </div>;
}
