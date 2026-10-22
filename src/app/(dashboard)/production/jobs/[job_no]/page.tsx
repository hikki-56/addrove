"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import {
  useProductionJobDetail,
  emitProductionUpdated,
  PRODUCTION_POLL_MS,
} from "@/features/production/hooks/use-production-data";
import { useSubmitGuard } from "@/features/production/hooks/use-submit-guard";
import { productionApi, isConflict, type ProductionApiResult } from "@/features/production/lib/api";
import { sendWithIdempotency } from "@/features/production/lib/idempotency";
import { getAllowedActions } from "@/features/production/lib/permissions";
import { buildJobPatch } from "@/features/production/lib/job-form";
import { formatHistoryDetail, historyActionLabel } from "@/features/production/lib/history";
import ReportModal from "@/features/production/components/ReportModal";
import ProductionPrintButton from "@/features/production/components/ProductionPrintButton";
import { ProductionMaterialSummary } from "@/features/production/components/MaterialStockLocations";
import AddJobModal, { type AddJobFormValue } from "@/features/production/components/AddJobModal";
import { ReasonModal, AdjustModal, ConfirmModal, StartJobSummary } from "@/features/production/components/ActionModals";
import { StatusBadge, PriorityBadge, JobSignalBadges, formatQty, formatDateTime } from "@/features/production/components/ui";
import {
  M3Banner,
  M3ErrorBanner,
  M3IconCircle,
  M3Loading,
  M3NumberTile,
  M3StatTile,
  type M3StatTone,
} from "@/components/ui/m3";
import {
  SolarArrowRight,
  SolarCloseCircle,
  SolarDangerCircle,
  SolarHistory,
  SolarPen,
  SolarPlayCircle,
  SolarTuning,
} from "@/components/icons";
import type { ProductionJob } from "@/types/production";

// รายละเอียดงานผลิต (§3, §6) — APPROVER: เริ่มผลิต/รายงานผล · ADMIN: แก้ไข/ยกเลิก/เปิดใหม่/ปรับปรุงยอด
// แสดงเป้าหมาย ยอดสะสม ของเสีย ยอดขาด/เกิน + ประวัติรายงานทุกรอบ + ประวัติการเปลี่ยนแปลง

export default function ProductionJobDetailPage() {
  const params = useParams<{ job_no: string }>();
  const jobNo = params?.job_no ? decodeURIComponent(params.job_no) : undefined;
  const { user } = useTabAuth();
  const { detail, loading, error, reload } = useProductionJobDetail(jobNo);

  // อัปเดตอัตโนมัติทุก 30 วิขณะแท็บมองเห็น (หยุดเมื่อซ่อนแท็บ · กลับมาแล้วโหลดทันที)
  usePollingWhenVisible(
    useCallback(
      (initial?: boolean) => {
        if (!initial && jobNo) reload();
      },
      [jobNo, reload]
    ),
    PRODUCTION_POLL_MS
  );

  // ภาพนิ่งของงานตอนเปิด modal แก้ไข/ปรับยอด — polling ไม่รีเซ็ตฟอร์มกลางคัน และ
  // PATCH ส่ง updated_at ของข้อมูลที่ผู้ใช้เห็นตอนเริ่มแก้ (optimistic lock ยังจับการแก้ซ้อนได้)
  const [modalJob, setModalJob] = useState<ProductionJob | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const guard = useSubmitGuard();
  const submitting = guard.pending;
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; message: string } | null>(null);

  const setToastOnce = (tone: "ok" | "err", message: string) => setToast({ tone, message });
  const clearModal = () => {
    setReportOpen(false);
    setEditOpen(false);
    setCancelOpen(false);
    setReopenOpen(false);
    setAdjustOpen(false);
    setStartOpen(false);
    setModalJob(null);
    setModalError(null);
  };

  if (loading) {
    return (
      <div className="w-full max-w-full pb-8">
        <M3Loading label="กำลังดึงข้อมูลงานผลิต..." />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="w-full max-w-full pb-8">
        <div className="m3-card flex flex-col items-center px-6 py-16 text-center">
          <M3IconCircle tone="error">
            <SolarDangerCircle size={26} />
          </M3IconCircle>
          <h2 className="mt-4 text-base font-bold text-m3-grey-800">{error || "ไม่พบใบสั่งผลิตนี้"}</h2>
          <Link href="/production/jobs" className="m3-btn m3-btn-primary mt-5 h-11 px-5">
            กลับหน้างานผลิต
          </Link>
        </div>
      </div>
    );
  }

  const { job, reports, history } = detail;
  const actions = getAllowedActions(job, user?.role);
  const canStart = actions.start;
  const canReport = actions.report;
  const canEdit = actions.edit;
  const canCancel = actions.cancel;
  const canReopen = actions.reopen && !job.material_plan?.backorder_job_no;
  const canAdjust = actions.adjust && !job.material_plan;

  // ทุก action ที่เปลี่ยนข้อมูลผ่าน guard เดียว — กันกดซ้ำ/กดหลาย action พร้อมกัน
  const runAction = (key: string, fn: () => Promise<ProductionApiResult>, closeOnSuccess = true) =>
    guard.run(async () => {
      setModalError(null);
      const res = await fn();
      if (res.success) {
        if (closeOnSuccess) clearModal();
        setToastOnce("ok", res.message);
        emitProductionUpdated();
      } else {
        setModalError(res.message);
        // 409 = ข้อมูลบนจอเก่า → โหลดใหม่ให้เห็นสถานะล่าสุด (ข้อความแนะนำให้รีเฟรชอยู่ใน message แล้ว)
        if (isConflict(res)) emitProductionUpdated();
      }
    }, key);

  const hasActions = canStart || canReport || canEdit || canCancel || canReopen || canAdjust;

  // ปุ่ม action ตามสิทธิ์และสถานะ (ฝั่งเซิร์ฟเวอร์ตรวจซ้ำเสมอ)
  // ≥md: อยู่ในการ์ดหัวงาน (D31/D32) · มือถือ: แถบล่าง ปุ่มหลักเต็มความกว้าง (M42)
  const primaryActions = (
    <>
      {canStart && (
        <button
          onClick={() => {
            setModalError(null);
            setStartOpen(true);
          }}
          disabled={submitting}
          className="m3-btn m3-btn-primary h-11 w-full px-5 md:h-9 md:w-auto md:px-4"
        >
          <SolarPlayCircle size={18} />
          เริ่มผลิต
        </button>
      )}
      {canReport && (
        <button
          onClick={() => {
            setModalError(null);
            setReportOpen(true);
          }}
          disabled={submitting}
          className="m3-btn m3-btn-primary h-11 w-full px-5 md:h-9 md:w-auto md:px-4"
        >
          รายงานผลผลิต
          <SolarArrowRight size={18} />
        </button>
      )}
    </>
  );
  const secondaryActions = (
    <>
      {canEdit && (
        <button
          onClick={() => {
            setModalError(null);
            setModalJob(job);
            setEditOpen(true);
          }}
          disabled={submitting}
          className="m3-btn m3-btn-outline m3-btn-sm md:h-9 md:px-3.5 md:text-sm"
        >
          <SolarPen size={16} />
          แก้ไขงาน
        </button>
      )}
      {canAdjust && (
        <button
          onClick={() => {
            setModalError(null);
            setModalJob(job);
            setAdjustOpen(true);
          }}
          disabled={submitting}
          className="m3-btn m3-btn-outline m3-btn-sm md:h-9 md:px-3.5 md:text-sm"
        >
          <SolarTuning size={16} />
          ปรับปรุงยอด
        </button>
      )}
      {canReopen && (
        <button
          onClick={() => {
            setModalError(null);
            setReopenOpen(true);
          }}
          disabled={submitting}
          className="m3-btn m3-btn-outline m3-btn-sm md:h-9 md:px-3.5 md:text-sm"
        >
          <SolarHistory size={16} />
          เปิดผลิตต่อ
        </button>
      )}
      {canCancel && (
        <button
          onClick={() => {
            setModalError(null);
            setCancelOpen(true);
          }}
          disabled={submitting}
          className="m3-btn m3-btn-sm border border-[rgba(255,86,48,0.48)] bg-white text-m3-error-dark hover:bg-[rgba(255,86,48,0.08)] md:h-9 md:px-3.5 md:text-sm"
        >
          <SolarCloseCircle size={16} />
          ยกเลิกงาน
        </button>
      )}
    </>
  );

  const stats: { label: string; value: number; tone: M3StatTone }[] = [
    { label: "เป้าหมาย", value: job.target_qty, tone: "grey" },
    { label: "ผลิตดีสะสม", value: job.produced_good, tone: "primary" },
    { label: "ของเสียสะสม", value: job.defect_total, tone: "error" },
    { label: "ยังขาด", value: job.remaining_qty, tone: "warning" },
    { label: "ผลิตเกิน", value: job.over_qty, tone: "info" },
  ];

  return (
    <div className={`w-full max-w-full ${hasActions ? "pb-40 md:pb-10" : "pb-10"}`}>
      {/* breadcrumb (D31) */}
      <nav aria-label="breadcrumb" className="mb-4 flex items-center gap-2 text-sm">
        <Link href="/production/jobs" className="text-m3-grey-600 hover:underline">
          งานผลิต
        </Link>
        <span className="text-m3-grey-400">/</span>
        <span className="font-semibold tabular-nums text-m3-grey-800">{job.job_no}</span>
      </nav>

      {/* หัวงาน */}
      <div className="m3-card mb-5 p-5 sm:p-6">
        {(user?.role === "ADMIN" || user?.role === "APPROVER") && <div className="mb-3 flex justify-end"><ProductionPrintButton jobs={[job]} disabled={submitting} /></div>}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <M3NumberTile>{job.table_no}</M3NumberTile>
              <span className="text-sm font-bold text-m3-grey-800">โต๊ะ {job.table_no}</span>
              <StatusBadge status={job.status} />
              <PriorityBadge priority={job.priority} />
              <JobSignalBadges job={job} />
              <span className="hidden text-xs tabular-nums text-m3-grey-500 sm:inline">{job.job_no}</span>
            </div>
            <p className="mt-2 text-xs tabular-nums text-m3-grey-500 sm:hidden">{job.job_no}</p>
            <h1 className="mt-1 text-xl font-bold text-m3-grey-800 sm:mt-3 sm:text-2xl">{job.product_name}</h1>
            <p className="mt-1 text-sm tabular-nums text-m3-grey-600">
              {job.sku} · หน่วย {job.unit} · วันที่ผลิต {job.production_date}
              {job.location ? ` · ตำแหน่งรับเข้า ${job.location}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-m3-grey-500">
              <span>สร้างโดย {job.created_by_name} · {formatDateTime(job.created_at)}</span>
              {job.submitted_at && <span>ส่งงาน {formatDateTime(job.submitted_at)}</span>}
              {job.started_at && <span>เริ่มผลิตโดย {job.started_by_name || "-"} · {formatDateTime(job.started_at)}</span>}
              {job.completed_at && <span>จบงาน {formatDateTime(job.completed_at)}</span>}
              {job.cancelled_at && <span className="text-m3-error-dark">ยกเลิกโดย {job.cancelled_by_name} · {formatDateTime(job.cancelled_at)}</span>}
            </div>
          </div>
          {hasActions && (
            <div className="hidden flex-wrap items-center justify-end gap-2 md:flex">
              {secondaryActions}
              {primaryActions}
            </div>
          )}
        </div>

        {job.material_plan && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-m3-grey-600">
            <span className="m3-label m3-label-primary">สูตร {job.material_plan.snapshot.bom_id} · {job.material_plan.snapshot.label}</span>
            {job.material_plan.parent_job_no && <span>งานค้างจาก <Link className="font-bold text-m3-primary-dark underline underline-offset-2" href={`/production/jobs/${encodeURIComponent(job.material_plan.parent_job_no)}`}>{job.material_plan.parent_job_no}</Link></span>}
            {job.material_plan.backorder_job_no && <span>สร้างงานค้างแล้ว: {user?.role === "ADMIN" ? <Link className="font-bold text-m3-primary-dark underline underline-offset-2" href={`/production/jobs/${encodeURIComponent(job.material_plan.backorder_job_no)}`}>{job.material_plan.backorder_job_no}</Link> : <b className="text-m3-grey-800">{job.material_plan.backorder_job_no}</b>}</span>}
          </div>
        )}

        {(job.note || job.cancel_reason || job.close_reason) && (
          <div className="mt-4 space-y-2">
            {job.note && (
              <p className="rounded-lg bg-m3-grey-100 px-4 py-2.5 text-sm text-m3-grey-600">
                หมายเหตุ: <span className="font-semibold text-m3-grey-800">{job.note}</span>
              </p>
            )}
            {job.cancel_reason && (
              <M3Banner tone="error">เหตุผลยกเลิก: {job.cancel_reason}</M3Banner>
            )}
            {job.close_reason && (
              <M3Banner tone="warning">เหตุผลจบงาน: {job.close_reason}</M3Banner>
            )}
          </div>
        )}

        {/* ตัวเลขหลัก */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {stats.map((st) => (
            // มือถือ: ซ่อนช่อง "ผลิตเกิน" เมื่อเป็น 0 (M42 แสดง 4 ช่อง)
            <div key={st.label} className={st.tone === "info" && !(st.value > 0) ? "hidden lg:block" : undefined}>
              <M3StatTile size="lg" tone={st.tone} label={st.label} value={formatQty(st.value)} unit={job.unit} />
            </div>
          ))}
        </div>
        {job.status === "COMPLETED" && job.remaining_qty > 0 && (
          <M3Banner tone="warning" className="mt-3">
            งานนี้จบโดยผลิตได้ต่ำกว่าเป้าหมาย (ขาด {formatQty(job.remaining_qty)} {job.unit})
          </M3Banner>
        )}
      </div>

      {toast && (
        <div className="mb-4">
          {toast.tone === "ok" ? (
            <M3Banner tone="success" role="status">
              {toast.message}
            </M3Banner>
          ) : (
            <M3ErrorBanner
              message={toast.message}
              action={
                <button type="button" onClick={() => reload()} className="m3-btn m3-btn-sm m3-btn-text">
                  รีเฟรช
                </button>
              }
            />
          )}
        </div>
      )}

      {job.material_plan && <div className="mb-5"><ProductionMaterialSummary plan={job.material_plan} /></div>}

      {/* ประวัติรายงาน */}
      <div className="m3-card mb-5 overflow-hidden">
        <div className="px-5 pt-5 pb-3 sm:px-6">
          <h2 className="text-lg font-bold text-m3-grey-800">ประวัติรายงาน ({reports.length})</h2>
        </div>
        {reports.length === 0 ? (
          <p className="px-5 pt-4 pb-10 text-center text-sm text-m3-grey-500">ยังไม่มีรายงานผล</p>
        ) : (
          <>
            {/* มือถือ: การ์ดต่อรอบ (M42) */}
            <ul className="divide-y divide-dashed divide-[rgba(145,158,171,0.32)] px-5 pb-3 md:hidden">
              {reports.map((r) => (
                <li key={r.report_id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-bold text-m3-grey-800">
                      {r.kind === "ADJUSTMENT" ? "ปรับปรุงยอด" : `รอบที่ ${r.report_no}`}
                    </span>
                    <span className="text-xs text-m3-grey-500">{formatDateTime(r.reported_at)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-m3-grey-500">
                    {r.reported_by_name}
                    {r.kind === "ADJUSTMENT" ? ` · ${r.reason}` : r.defect_cause || r.reason || r.note ? ` · ${r.defect_cause || r.reason || r.note}` : ""}
                  </p>
                  {r.material_details && (
                    <details className="mt-1.5 text-xs text-m3-grey-600">
                      <summary className="cursor-pointer font-semibold text-m3-primary-dark">วัตถุดิบใช้จริง / ของเสีย</summary>
                      {r.receipt_location_code && <p className="mt-1">รับสินค้าดี: โกดัง 2 · {r.receipt_location_code}</p>}
                      {r.material_details.map((m, i) => <p key={`${m.sku}-${i}`} className="mt-1 tabular-nums">{m.sku}: ใช้ผลิต {m.used_qty} · เสียเพิ่ม {m.scrap_qty} · รวมตัด {m.total_qty} {m.stock_unit}{m.scrap_cause && ` (${m.scrap_cause})`}</p>)}
                      {r.material_reason && <p className="mt-1">เหตุผลยอดใช้จริง: {r.material_reason}</p>}
                    </details>
                  )}
                  <p className="mt-1.5 flex flex-wrap gap-x-4 text-sm tabular-nums text-m3-grey-600">
                    <span>
                      ดีรอบนี้{" "}
                      <b className={r.good_qty < 0 ? "text-m3-error-dark" : "text-m3-primary-dark"}>
                        {r.good_qty > 0 ? "+" : ""}{formatQty(r.good_qty)}
                      </b>
                    </span>
                    <span>
                      เสียรอบนี้{" "}
                      <b className={r.defect_qty !== 0 ? "text-m3-error-dark" : "text-m3-grey-500"}>
                        {r.defect_qty > 0 ? "+" : ""}{formatQty(r.defect_qty)}
                      </b>
                    </span>
                    <span>
                      สะสม {formatQty(r.cumulative_good)}/{formatQty(r.cumulative_defect)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            {/* ≥md: ตาราง (D32) */}
            <div className="hidden overflow-x-auto md:block">
              <table className="m3-table w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr>
                    <th>รอบที่</th>
                    <th>เมื่อ</th>
                    <th>ผู้รายงาน</th>
                    <th className="m3-num">ดีรอบนี้</th>
                    <th className="m3-num">เสียรอบนี้</th>
                    <th className="m3-num">ดีสะสม</th>
                    <th>สาเหตุ/เหตุผล</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.report_id} className={r.kind === "ADJUSTMENT" ? "bg-[rgba(255,171,0,0.08)]" : ""}>
                      <td className="font-semibold tabular-nums">
                        {r.kind === "ADJUSTMENT" ? <span className="m3-label m3-label-warning">ปรับปรุง</span> : r.report_no}
                      </td>
                      <td className="text-xs">{formatDateTime(r.reported_at)}</td>
                      <td>{r.reported_by_name}</td>
                      <td className="m3-num font-semibold tabular-nums">
                        <span className={r.good_qty < 0 ? "text-m3-error-dark" : "text-m3-primary-dark"}>
                          {r.good_qty > 0 ? "+" : ""}{formatQty(r.good_qty)}
                        </span>
                      </td>
                      <td className="m3-num font-semibold tabular-nums">
                        <span className={r.defect_qty !== 0 ? "text-m3-error-dark" : "text-m3-grey-500"}>
                          {r.defect_qty > 0 ? "+" : ""}{formatQty(r.defect_qty)}
                        </span>
                      </td>
                      <td className="m3-num font-bold tabular-nums">{formatQty(r.cumulative_good)}</td>
                      <td className="text-xs">
                        {r.kind === "ADJUSTMENT" ? r.reason : r.defect_cause || r.reason || r.note || "-"}
                        {r.material_details && (
                        <details className="mt-2 min-w-56 text-xs text-m3-grey-600">
                          <summary className="cursor-pointer font-semibold text-m3-primary-dark">วัตถุดิบใช้จริง / ของเสีย</summary>
                          {r.receipt_location_code && <p className="mt-1">รับสินค้าดี: โกดัง 2 · {r.receipt_location_code}</p>}
                          {r.material_details.map((m, i) => <p key={`${m.sku}-${i}`} className="mt-1 tabular-nums">{m.sku}: ใช้ผลิต {m.used_qty} · เสียเพิ่ม {m.scrap_qty} · รวมตัด {m.total_qty} {m.stock_unit}{m.scrap_cause && ` (${m.scrap_cause})`}</p>)}
                          {r.material_reason && <p className="mt-1">เหตุผลยอดใช้จริง: {r.material_reason}</p>}
                        </details>
                      )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ประวัติการเปลี่ยนแปลง */}
      <div className="m3-card overflow-hidden">
        <div className="px-5 pt-5 pb-2 sm:px-6">
          <h2 className="text-lg font-bold text-m3-grey-800">ประวัติการดำเนินการ</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-5 pt-4 pb-8 text-center text-sm text-m3-grey-500">ยังไม่มีประวัติ</p>
        ) : (
          <ol className="divide-y divide-dashed divide-[rgba(145,158,171,0.32)] px-5 pb-2 sm:px-6">
            {history.map((h) => {
              const detailView = formatHistoryDetail(h.action, h.detail);
              return (
                <li key={h.history_id} className="py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-m3-grey-800">{historyActionLabel(h.action)}</span>
                    <span className="text-xs text-m3-grey-500">
                      {h.actor_name} · {formatDateTime(h.at)}
                    </span>
                  </div>
                  {h.reason && <p className="mt-0.5 text-xs text-m3-grey-600">เหตุผล: {h.reason}</p>}
                  {detailView.lines.length > 0 && (
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                      {detailView.lines.map((line, idx) => (
                        <div key={`${line.label}-${idx}`} className="contents">
                          <dt className="text-m3-grey-500">{line.label}</dt>
                          <dd className="font-medium tabular-nums text-m3-grey-600">{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {detailView.raw && (
                    <p className="mt-0.5 break-all tabular-nums text-[11px] text-m3-grey-500">{detailView.raw}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* มือถือ: แถบ action ด้านล่าง (M42) */}
      {hasActions && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[rgba(145,158,171,0.2)] bg-white/96 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          {(canEdit || canAdjust || canReopen || canCancel) && <div className="mb-2.5 flex flex-wrap gap-2">{secondaryActions}</div>}
          {(canStart || canReport) && <div className="flex flex-col gap-2">{primaryActions}</div>}
        </div>
      )}

      {/* ยืนยันก่อนเริ่มผลิต (เดิมหน้ารายการถาม แต่หน้ารายละเอียดไม่ถาม) */}
      <ConfirmModal
        open={startOpen}
        title="ยืนยันเริ่มผลิต"
        hint="เมื่อเริ่มแล้ว ระบบจะแจ้ง Admin ว่างานนี้เริ่มผลิตแล้ว"
        icon={<SolarPlayCircle size={28} />}
        iconTone="info"
        confirmLabel={
          <>
            <SolarPlayCircle size={18} />
            ยืนยันเริ่มผลิต
          </>
        }
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onConfirm={() =>
          runAction("start", () => productionApi(`/api/production/jobs/${encodeURIComponent(job.job_no)}/start`, "POST"))
        }
      >
        <StartJobSummary job={job} />
      </ConfirmModal>

      <ReportModal
        open={reportOpen}
        job={job}
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onSubmit={(payload) =>
          runAction("report", () =>
            sendWithIdempotency(
              { action: "report", jobNo: job.job_no, round: job.report_count + 1, payload: { ...payload } },
              (idempotency_key) =>
                productionApi(`/api/production/jobs/${encodeURIComponent(job.job_no)}/report`, "POST", {
                  ...payload,
                  idempotency_key,
                })
            )
          )
        }
      />

      <AddJobModal
        open={editOpen && !!modalJob}
        mode="edit"
        job={modalJob || undefined}
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onSubmit={(value: AddJobFormValue) =>
          runAction("edit", () =>
            productionApi(
              `/api/production/jobs/${encodeURIComponent(job.job_no)}`,
              "PATCH",
              buildJobPatch(modalJob ?? job, value)
            )
          )
        }
      />

      <ReasonModal
        open={cancelOpen}
        title={`ยกเลิกงาน ${job.job_no}`}
        hint="เก็บผลผลิตเดิมไว้"
        reasonLabel="เหตุผลการยกเลิก"
        confirmLabel="ยืนยันยกเลิก"
        tone="danger"
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onSubmit={(reason) =>
          runAction("cancel", () =>
            productionApi(`/api/production/jobs/${encodeURIComponent(job.job_no)}/cancel`, "POST", { reason })
          )
        }
      />

      <ReasonModal
        open={reopenOpen}
        title={`เปิดงาน ${job.job_no} กลับมาผลิตต่อ`}
        hint="ผลิตต่อจากยอดเดิม"
        reasonLabel="เหตุผลการเปิดผลิตต่อ"
        confirmLabel="เปิดงานผลิตต่อ"
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onSubmit={(reason) =>
          runAction("reopen", () =>
            productionApi(`/api/production/jobs/${encodeURIComponent(job.job_no)}/reopen`, "POST", { reason })
          )
        }
      />

      <AdjustModal
        open={adjustOpen && !!modalJob}
        job={modalJob}
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onSubmit={(payload) =>
          runAction("adjust", () =>
            sendWithIdempotency(
              { action: "adjust", jobNo: job.job_no, round: (modalJob ?? job).report_count + 1, payload: { ...payload } },
              (idempotency_key) =>
                productionApi(`/api/production/jobs/${encodeURIComponent(job.job_no)}/adjust`, "POST", {
                  ...payload,
                  idempotency_key,
                })
            )
          )
        }
      />

      <div className="mt-5 text-center">
        <button onClick={() => reload()} className="m3-btn m3-btn-sm m3-btn-text text-m3-grey-600">
          รีเฟรชข้อมูล
        </button>
      </div>
    </div>
  );
}
