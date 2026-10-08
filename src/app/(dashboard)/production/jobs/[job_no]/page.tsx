"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import {
  useProductionJobDetail,
  productionFetch,
  emitProductionUpdated,
} from "../../_lib/use-production-data";
import ReportModal from "../../_components/ReportModal";
import AddJobModal, { type AddJobFormValue } from "../../_components/AddJobModal";
import { ReasonModal, AdjustModal } from "../../_components/ActionModals";
import { StatusBadge, PriorityBadge, formatQty, formatDateTime } from "../../_components/ui";

// รายละเอียดงานผลิต (§3, §6) — APPROVER: เริ่มผลิต/รายงานผล · ADMIN: แก้ไข/ยกเลิก/เปิดใหม่/ปรับปรุงยอด
// แสดงเป้าหมาย ยอดสะสม ของเสีย ยอดขาด/เกิน + ประวัติรายงานทุกรอบ + ประวัติการเปลี่ยนแปลง

const HISTORY_ACTION_LABELS: Record<string, string> = {
  CREATE: "สร้างงาน",
  EDIT: "แก้ไขงาน",
  DELETE: "ลบฉบับร่าง",
  SUBMIT: "ส่งงานผลิต",
  START: "เริ่มผลิต",
  REPORT_PARTIAL: "รายงานบางส่วน",
  REPORT_FINAL: "รายงานและจบงาน",
  CANCEL: "ยกเลิกงาน",
  REOPEN: "เปิดงานผลิตต่อ",
  ADJUST: "ปรับปรุงยอดผลผลิต",
};

export default function ProductionJobDetailPage() {
  const params = useParams<{ job_no: string }>();
  const jobNo = params?.job_no ? decodeURIComponent(params.job_no) : undefined;
  const { user } = useTabAuth();
  const isApprover = user?.role === "APPROVER";
  const isAdmin = user?.role === "ADMIN";
  const { detail, loading, error, reload } = useProductionJobDetail(jobNo);

  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; message: string } | null>(null);

  const setToastOnce = (tone: "ok" | "err", message: string) => setToast({ tone, message });
  const clearModal = () => {
    setReportOpen(false);
    setEditOpen(false);
    setCancelOpen(false);
    setReopenOpen(false);
    setAdjustOpen(false);
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
  const canStart = isApprover && job.status === "WAITING";
  const canReport = isApprover && job.status === "IN_PROGRESS";
  const canEdit = isAdmin && ["DRAFT", "WAITING", "IN_PROGRESS"].includes(job.status);
  const canCancel = isAdmin && ["DRAFT", "WAITING", "IN_PROGRESS"].includes(job.status);
  const canReopen = isAdmin && job.status === "COMPLETED";
  const canAdjust = isAdmin && ["IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(job.status);

  const runAction = async (fn: () => Promise<{ success: boolean; message: string }>, closeOnSuccess = true) => {
    setSubmitting(true);
    setModalError(null);
    const res = await fn();
    setSubmitting(false);
    if (res.success) {
      if (closeOnSuccess) clearModal();
      setToastOnce("ok", res.message);
      emitProductionUpdated();
    } else {
      setModalError(res.message);
    }
  };

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
            {history.map((h) => (
              <li key={h.history_id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-800">{HISTORY_ACTION_LABELS[h.action] || h.action}</span>
                  <span className="text-xs font-semibold text-slate-400">
                    {h.actor_name} · {formatDateTime(h.at)}
                  </span>
                </div>
                {h.reason && <p className="mt-0.5 text-xs font-semibold text-slate-500">เหตุผล: {h.reason}</p>}
                {h.detail && h.detail !== "{}" && (
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">{h.detail}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ปุ่ม action ตามสิทธิ์และสถานะ (ฝั่งเซิร์ฟเวอร์ตรวจซ้ำเสมอ) */}
      {(canStart || canReport || canEdit || canCancel || canReopen || canAdjust) && (
        <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center justify-center gap-2 rounded-xl bg-[#06402B] px-4 py-3 shadow-2xl">
            {canStart && (
              <button
                onClick={() => runAction(() => productionFetch(`/api/production/jobs/${encodeURIComponent(job.job_no)}/start`, "POST"))}
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
                className="rounded-lg bg-white px-4 py-2.5 text-sm font-extrabold text-[#06402B] transition-all hover:bg-[#EAF2EE] active:scale-95"
              >
                📊 รายงานผลผลิต
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => {
                  setModalError(null);
                  setEditOpen(true);
                }}
                className="rounded-lg border border-white/30 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-white/10 active:scale-95"
              >
                ✏️ แก้ไขงาน
              </button>
            )}
            {canAdjust && (
              <button
                onClick={() => {
                  setModalError(null);
                  setAdjustOpen(true);
                }}
                className="rounded-lg border border-white/30 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-white/10 active:scale-95"
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
                className="rounded-lg border border-white/30 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-white/10 active:scale-95"
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
                className="rounded-lg bg-[#B42318] px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#912018] active:scale-95"
              >
                🚫 ยกเลิกงาน
              </button>
            )}
          </div>
        </div>
      )}

      <ReportModal
        open={reportOpen}
        job={job}
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onSubmit={(payload) =>
          runAction(() =>
            productionFetch(`/api/production/jobs/${encodeURIComponent(job.job_no)}/report`, "POST", payload)
          )
        }
      />

      <AddJobModal
        open={editOpen}
        mode="edit"
        job={job}
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onSubmit={(value: AddJobFormValue) =>
          runAction(() =>
            productionFetch(`/api/production/jobs/${encodeURIComponent(job.job_no)}`, "PATCH", {
              updated_at: job.updated_at,
              production_date: value.production_date,
              table_no: value.table_no,
              product_id: value.product_id,
              target_qty: parseFloat(value.target_qty),
              priority: value.priority,
              note: value.note,
              location: value.location,
              reason: value.reason,
            })
          )
        }
      />

      <ReasonModal
        open={cancelOpen}
        title={`ยกเลิกงาน ${job.job_no}`}
        hint="ผลผลิตที่ยืนยันแล้วทั้งหมดยังเก็บไว้ — ระบบจะแจ้งผู้ผลิต"
        reasonLabel="เหตุผลการยกเลิก"
        confirmLabel="ยืนยันยกเลิก"
        tone="danger"
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onSubmit={(reason) =>
          runAction(() =>
            productionFetch(`/api/production/jobs/${encodeURIComponent(job.job_no)}/cancel`, "POST", { reason })
          )
        }
      />

      <ReasonModal
        open={reopenOpen}
        title={`เปิดงาน ${job.job_no} กลับมาผลิตต่อ`}
        hint="สถานะจะกลับเป็น “กำลังผลิต” — ผลิตดีสะสมเดิมยังอยู่ และรายงานต่อได้ทันที"
        reasonLabel="เหตุผลการเปิดผลิตต่อ"
        confirmLabel="เปิดงานผลิตต่อ"
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onSubmit={(reason) =>
          runAction(() =>
            productionFetch(`/api/production/jobs/${encodeURIComponent(job.job_no)}/reopen`, "POST", { reason })
          )
        }
      />

      <AdjustModal
        open={adjustOpen}
        job={job}
        submitting={submitting}
        error={modalError}
        onClose={clearModal}
        onSubmit={(payload) =>
          runAction(() =>
            productionFetch(`/api/production/jobs/${encodeURIComponent(job.job_no)}/adjust`, "POST", payload)
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
