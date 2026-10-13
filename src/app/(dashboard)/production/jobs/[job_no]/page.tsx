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
import AddJobModal, { type AddJobFormValue } from "@/features/production/components/AddJobModal";
import { ReasonModal, AdjustModal, ConfirmModal, StartJobSummary } from "@/features/production/components/ActionModals";
import { StatusBadge, PriorityBadge, formatQty, formatDateTime } from "@/features/production/components/ui";
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
        <div className="rounded-xl border border-[#E8ECEA] bg-white p-16 text-center shadow-xs">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0F5C3F] border-t-transparent" />
          <p className="mt-3 text-sm font-semibold text-slate-500">กำลังดึงข้อมูลงานผลิต...</p>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="w-full max-w-full pb-8">
        <div className="rounded-xl border border-[#E8ECEA] bg-white px-6 py-16 text-center shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-xl">❓</div>
          <h2 className="mt-3.5 text-base font-extrabold text-slate-900">{error || "ไม่พบใบสั่งผลิตนี้"}</h2>
          <Link href="/production/jobs" className="mt-5 inline-block rounded-lg bg-[#06402B] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0A5C4E]">
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
  const canReopen = actions.reopen;
  const canAdjust = actions.adjust;

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

  return (
    <div className="w-full max-w-full pb-28">
      {/* หัวงาน */}
      <div className="mb-5 rounded-xl border border-[#E8ECEA] bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#06402B] font-mono text-sm font-black text-white">
                {job.table_no}
              </span>
              <StatusBadge status={job.status} />
              <PriorityBadge priority={job.priority} />
              <span className="font-mono text-sm font-black text-slate-900">{job.job_no}</span>
            </div>
            <h1 className="mt-2 text-xl font-extrabold text-slate-900">{job.product_name}</h1>
            <p className="mt-0.5 font-mono text-xs font-semibold text-slate-400">
              {job.sku} · วันที่ผลิต {job.production_date}
              {job.location ? ` · ตำแหน่งรับเข้า ${job.location}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
              <span>สร้างโดย {job.created_by_name} · {formatDateTime(job.created_at)}</span>
              {job.submitted_at && <span>ส่งงาน {formatDateTime(job.submitted_at)}</span>}
              {job.started_at && <span>เริ่มผลิตโดย {job.started_by_name || "-"} · {formatDateTime(job.started_at)}</span>}
              {job.completed_at && <span>จบงาน {formatDateTime(job.completed_at)}</span>}
              {job.cancelled_at && <span className="text-rose-600">ยกเลิกโดย {job.cancelled_by_name} · {formatDateTime(job.cancelled_at)}</span>}
            </div>
            {job.note && (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">📝 {job.note}</p>
            )}
            {job.cancel_reason && (
              <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">เหตุผลยกเลิก: {job.cancel_reason}</p>
            )}
            {job.close_reason && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">เหตุผลจบงาน: {job.close_reason}</p>
            )}
          </div>
        </div>

        {/* ตัวเลขหลัก */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          {[
            { label: "เป้าหมาย", value: job.target_qty, cls: "bg-slate-50 text-slate-900" },
            { label: "ผลิตดีสะสม", value: job.produced_good, cls: "bg-[#EAF2EE] text-[#06402B]" },
            { label: "ของเสียสะสม", value: job.defect_total, cls: "bg-rose-50 text-rose-700" },
            { label: "ยังขาด", value: job.remaining_qty, cls: "bg-amber-50 text-amber-800" },
            { label: "ผลิตเกิน", value: job.over_qty, cls: "bg-sky-50 text-sky-800" },
          ].map((s) => (
            <div key={s.label} className={`rounded-lg px-3.5 py-2.5 ${s.cls}`}>
              <div className="text-[11px] font-bold uppercase tracking-wide opacity-70">{s.label}</div>
              <div className="mt-0.5 font-mono text-xl font-black">
                {formatQty(s.value)} <span className="text-[10px] font-bold opacity-60">{job.unit}</span>
              </div>
            </div>
          ))}
        </div>
        {job.status === "COMPLETED" && job.remaining_qty > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            ⚠️ งานนี้จบโดยผลิตได้ต่ำกว่าเป้าหมาย (ขาด {formatQty(job.remaining_qty)} {job.unit})
          </p>
        )}
      </div>

      {toast && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 ${
            toast.tone === "ok" ? "border-[#C9DFD4] bg-[#EAF2EE] text-[#053425]" : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <p className="text-sm font-bold">{toast.message}</p>
        </div>
      )}

      {/* ประวัติรายงาน */}
      <div className="mb-5 overflow-hidden rounded-xl border border-[#E8ECEA] bg-white shadow-xs">
        <div className="border-b border-[#EEF1EF] px-5 py-3.5">
          <h2 className="text-sm font-extrabold text-slate-900">ประวัติรายงานผล ({reports.length} รายการ)</h2>
        </div>
        {reports.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm font-semibold text-slate-300">ยังไม่มีรายงานผล</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="bg-slate-50 font-bold text-slate-500">
                  <th className="px-4 py-2.5">รอบที่</th>
                  <th className="px-4 py-2.5">เมื่อ</th>
                  <th className="px-4 py-2.5">ผู้รายงาน</th>
                  <th className="px-4 py-2.5 text-right">ดีรอบนี้</th>
                  <th className="px-4 py-2.5 text-right">เสียรอบนี้</th>
                  <th className="px-4 py-2.5 text-right">ดีสะสม</th>
                  <th className="px-4 py-2.5">สาเหตุ/เหตุผล</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EF]">
                {reports.map((r) => (
                  <tr key={r.report_id} className={r.kind === "ADJUSTMENT" ? "bg-amber-50/40" : ""}>
                    <td className="px-4 py-2.5 font-mono font-bold text-slate-700">
                      {r.kind === "ADJUSTMENT" ? "ปรับปรุง" : r.report_no}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-slate-500">{formatDateTime(r.reported_at)}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-700">{r.reported_by_name}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-bold tabular-nums ${r.good_qty < 0 ? "text-rose-700" : "text-[#06402B]"}`}>
                      {r.good_qty > 0 ? "+" : ""}{formatQty(r.good_qty)}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono font-bold tabular-nums ${r.defect_qty !== 0 ? "text-rose-700" : "text-slate-400"}`}>
                      {r.defect_qty > 0 ? "+" : ""}{formatQty(r.defect_qty)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-black tabular-nums text-slate-900">{formatQty(r.cumulative_good)}</td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-slate-500">
                      {r.kind === "ADJUSTMENT" ? `⚖️ ${r.reason}` : r.defect_cause || r.reason || r.note || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ประวัติการเปลี่ยนแปลง */}
      <div className="overflow-hidden rounded-xl border border-[#E8ECEA] bg-white shadow-xs">
        <div className="border-b border-[#EEF1EF] px-5 py-3.5">
          <h2 className="text-sm font-extrabold text-slate-900">ประวัติการดำเนินการ</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm font-semibold text-slate-300">ยังไม่มีประวัติ</p>
        ) : (
          <ol className="divide-y divide-[#EEF1EF]">
            {history.map((h) => {
              const detailView = formatHistoryDetail(h.action, h.detail);
              return (
                <li key={h.history_id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-800">{historyActionLabel(h.action)}</span>
                    <span className="text-xs font-semibold text-slate-400">
                      {h.actor_name} · {formatDateTime(h.at)}
                    </span>
                  </div>
                  {h.reason && <p className="mt-0.5 text-xs font-semibold text-slate-500">เหตุผล: {h.reason}</p>}
                  {detailView.lines.length > 0 && (
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                      {detailView.lines.map((line, idx) => (
                        <div key={`${line.label}-${idx}`} className="contents">
                          <dt className="font-semibold text-slate-400">{line.label}</dt>
                          <dd className="font-semibold tabular-nums text-slate-600">{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {detailView.raw && (
                    <p className="mt-0.5 break-all font-mono text-[11px] text-slate-400">{detailView.raw}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ปุ่ม action ตามสิทธิ์และสถานะ (ฝั่งเซิร์ฟเวอร์ตรวจซ้ำเสมอ) */}
      {(canStart || canReport || canEdit || canCancel || canReopen || canAdjust) && (
        <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-2 rounded-xl bg-[#06402B] px-4 py-3 shadow-2xl">
            {canStart && (
              <button
                onClick={() => {
                  setModalError(null);
                  setStartOpen(true);
                }}
                disabled={submitting}
                className="rounded-lg bg-white px-4 py-2.5 text-sm font-extrabold text-[#06402B] transition-all hover:bg-[#EAF2EE] active:scale-95 disabled:opacity-50"
              >
                ▶ เริ่มผลิต
              </button>
            )}
            {canReport && (
              <button
                onClick={() => {
                  setModalError(null);
                  setReportOpen(true);
                }}
                disabled={submitting}
                className="rounded-lg bg-white px-4 py-2.5 text-sm font-extrabold text-[#06402B] transition-all hover:bg-[#EAF2EE] active:scale-95 disabled:opacity-50"
              >
                📊 รายงานผลผลิต
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => {
                  setModalError(null);
                  setModalJob(job);
                  setEditOpen(true);
                }}
                disabled={submitting}
                className="rounded-lg border border-white/30 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-white/10 active:scale-95 disabled:opacity-50"
              >
                ✏️ แก้ไขงาน
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
                className="rounded-lg border border-white/30 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-white/10 active:scale-95 disabled:opacity-50"
              >
                ⚖️ ปรับปรุงยอด
              </button>
            )}
            {canReopen && (
              <button
                onClick={() => {
                  setModalError(null);
                  setReopenOpen(true);
                }}
                disabled={submitting}
                className="rounded-lg border border-white/30 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-white/10 active:scale-95 disabled:opacity-50"
              >
                🔁 เปิดผลิตต่อ
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => {
                  setModalError(null);
                  setCancelOpen(true);
                }}
                disabled={submitting}
                className="rounded-lg bg-[#B42318] px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#912018] active:scale-95 disabled:opacity-50"
              >
                🚫 ยกเลิกงาน
              </button>
            )}
          </div>
        </div>
      )}

      {/* ยืนยันก่อนเริ่มผลิต (เดิมหน้ารายการถาม แต่หน้ารายละเอียดไม่ถาม) */}
      <ConfirmModal
        open={startOpen}
        title="ยืนยันเริ่มผลิต"
        confirmLabel="ยืนยันเริ่มผลิต"
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
        <button onClick={() => reload()} className="text-xs font-bold text-slate-400 hover:text-[#0F5C3F]">
          รีเฟรชข้อมูล
        </button>
      </div>
    </div>
  );
}
