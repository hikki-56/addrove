"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import {
  useProductionJobs,
  productionFetch,
  emitProductionUpdated,
} from "./_lib/use-production-data";
import AddJobModal, { type AddJobFormValue } from "./_components/AddJobModal";
import { ReasonModal } from "./_components/ActionModals";
import { StatusBadge, PriorityBadge, JobNumbers, formatQty, todayYMD } from "./_components/ui";
import type { ProductionJob } from "@/types/production";
import { PRODUCTION_JOB_STATUS_LABELS, PRODUCTION_TABLES } from "@/types/production";

// หน้าวางแผนผลิตของ ADMIN (§1–2) — การ์ดโต๊ะ 1–5 + ฉบับร่างแก้/ลบ/ย้ายโต๊ะได้ทันที
// เลือกหลายงานแล้ว "ยืนยันส่งงานผลิต" (DRAFT → WAITING + แจ้ง APPROVER)

const STATUS_OPTIONS = ["ALL", "DRAFT", "WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

const filterInputClass =
  "w-full rounded-lg border border-[#E8ECEA] bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 focus:outline-none";

export default function ProductionPlanningPage() {
  const { user } = useTabAuth();
  const isAdmin = user?.role === "ADMIN";
  const { jobs, loading, error, reload } = useProductionJobs();

  const [dateFilter, setDateFilter] = useState("");
  const [today, setToday] = useState("");
  const [tableFilter, setTableFilter] = useState<number | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = todayYMD();
    setToday(t);
    setDateFilter(t);
  }, []);

  // modals
  const [addOpen, setAddOpen] = useState(false);
  const [addTable, setAddTable] = useState(1);
  const [editJob, setEditJob] = useState<ProductionJob | null>(null);
  const [cancelJob, setCancelJob] = useState<ProductionJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [submittingJobs, setSubmittingJobs] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (dateFilter && j.production_date !== dateFilter) return false;
      if (tableFilter !== "ALL" && j.table_no !== tableFilter) return false;
      if (statusFilter !== "ALL" && j.status !== statusFilter) return false;
      if (query && !`${j.job_no} ${j.sku} ${j.product_name}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [jobs, dateFilter, tableFilter, statusFilter, q]);

  const drafts = useMemo(() => jobs.filter((j) => j.status === "DRAFT"), [jobs]);
  const selectedJobs = useMemo(() => drafts.filter((j) => selected.has(j.job_no)), [drafts, selected]);

  const toggleSelect = (jobNo: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobNo)) next.delete(jobNo);
      else next.add(jobNo);
      return next;
    });
  };

  const handleAdd = async (value: AddJobFormValue) => {
    setSubmitting(true);
    setModalError(null);
    const res = await productionFetch("/api/production/jobs", "POST", {
      jobs: [
        {
          production_date: value.production_date,
          table_no: value.table_no,
          product_id: value.product_id,
          target_qty: parseFloat(value.target_qty),
          priority: value.priority,
          note: value.note,
          location: value.location,
        },
      ],
    });
    setSubmitting(false);
    if (res.success) {
      setAddOpen(false);
      setDateFilter(value.production_date);
      setTableFilter(value.table_no);
      setToast(`เพิ่มงานฉบับร่างเรียบร้อย — แก้ไข/ย้ายโต๊ะได้ทันทีก่อนส่งงาน`);
      emitProductionUpdated();
    } else {
      setModalError(res.message);
    }
  };

  const handleEdit = async (value: AddJobFormValue) => {
    if (!editJob) return;
    setSubmitting(true);
    setModalError(null);
    const res = await productionFetch(`/api/production/jobs/${encodeURIComponent(editJob.job_no)}`, "PATCH", {
      updated_at: editJob.updated_at,
      production_date: value.production_date,
      table_no: value.table_no,
      product_id: value.product_id,
      target_qty: parseFloat(value.target_qty),
      priority: value.priority,
      note: value.note,
      location: value.location,
      reason: value.reason,
    });
    setSubmitting(false);
    if (res.success) {
      setEditJob(null);
      setToast("แก้ไขงานเรียบร้อย" + (editJob.status !== "DRAFT" ? " — แจ้งผู้ผลิตแล้ว" : ""));
      emitProductionUpdated();
    } else {
      setModalError(res.message);
    }
  };

  const handleDeleteDraft = async (job: ProductionJob) => {
    if (!window.confirm(`ลบงานฉบับร่าง ${job.job_no} (${job.product_name}) ?`)) return;
    const res = await productionFetch(`/api/production/jobs/${encodeURIComponent(job.job_no)}`, "DELETE");
    if (res.success) {
      setToast("ลบฉบับร่างเรียบร้อย");
      emitProductionUpdated();
    } else {
      setToast(res.message);
    }
  };

  const handleCancelJob = async (reason: string) => {
    if (!cancelJob) return;
    setSubmitting(true);
    setModalError(null);
    const res = await productionFetch(
      `/api/production/jobs/${encodeURIComponent(cancelJob.job_no)}/cancel`,
      "POST",
      { reason }
    );
    setSubmitting(false);
    if (res.success) {
      setCancelJob(null);
      setToast("ยกเลิกงานเรียบร้อย — ผลผลิตที่ยืนยันแล้วยังเก็บไว้ครบ");
      emitProductionUpdated();
    } else {
      setModalError(res.message);
    }
  };

  const handleSubmitJobs = async () => {
    if (selectedJobs.length === 0) return;
    const names = selectedJobs.map((j) => j.job_no).join(", ");
    if (!window.confirm(`ยืนยันส่งงานผลิต ${selectedJobs.length} งาน?\n${names}\n\nเมื่อส่งแล้วระบบจะแจ้งเตือนไปยังผู้ผลิต (APPROVER) ทันที`)) return;
    setSubmittingJobs(true);
    const res = await productionFetch("/api/production/jobs/submit", "POST", {
      job_nos: selectedJobs.map((j) => j.job_no),
    });
    setSubmittingJobs(false);
    if (res.success) {
      setSelected(new Set());
      setToast(res.message);
      emitProductionUpdated();
    } else {
      setToast(res.message);
    }
  };

  if (!isAdmin) {
    return (
      <div className="w-full max-w-full pb-8">
        <h1 className="text-2xl font-extrabold text-slate-900">วางแผนผลิต</h1>
        <div className="mt-6 rounded-xl border border-[#E8ECEA] bg-white px-6 py-16 text-center shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-xl">🔒</div>
          <h2 className="mt-3.5 text-base font-extrabold text-slate-900">เฉพาะผู้ดูแลระบบ (Admin)</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            หน้านี้สำหรับวางแผนการผลิต — ผู้ผลิตใช้งานที่เมนู “งานผลิต” แทน
          </p>
          <Link
            href="/production/jobs"
            className="mt-5 inline-block rounded-lg bg-[#06402B] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0A5C4E]"
          >
            ไปหน้างานผลิต
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full pb-28">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">วางแผนผลิต</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            สร้างงานเป็นฉบับร่างก่อน — แก้ไข ลบ ย้ายโต๊ะได้ทันที แล้วเลือกส่งหลายงานพร้อมกันในคลิกเดียว
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/production/summary"
            className="rounded-lg border border-[#E8ECEA] bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-all hover:border-[#C8DBD1] hover:bg-slate-50"
          >
            สรุปผลผลิต
          </Link>
          <button
            type="button"
            onClick={() => {
              setAddTable(typeof tableFilter === "number" ? tableFilter : 1);
              setAddOpen(true);
            }}
            className="rounded-lg bg-[#06402B] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#06402B]/20 transition-all hover:bg-[#0A5C4E] active:scale-95"
          >
            + เพิ่มงานผลิต
          </button>
        </div>
      </div>

      {toast && (
        <div className="mb-4 rounded-lg border border-[#C9DFD4] bg-[#EAF2EE] px-4 py-3">
          <p className="text-sm font-bold text-[#053425]">{toast}</p>
        </div>
      )}
      {error && !loading && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-bold text-rose-800">{error}</p>
          <button onClick={() => reload()} className="rounded-lg px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100">
            ลองใหม่
          </button>
        </div>
      )}

      {/* ตัวกรอง */}
      <div className="mb-5 rounded-xl border border-[#E8ECEA] bg-white p-4 shadow-xs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="text-xs font-bold text-slate-400">วันที่ผลิต</span>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className={`mt-1 ${filterInputClass}`}
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-400">โต๊ะผลิต</span>
            <select
              value={String(tableFilter)}
              onChange={(e) => setTableFilter(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
              className={`mt-1 ${filterInputClass}`}
            >
              <option value="ALL">ทุกโต๊ะ</option>
              {PRODUCTION_TABLES.map((t) => (
                <option key={t} value={t}>โต๊ะ {t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-400">สถานะ</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`mt-1 ${filterInputClass}`}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "ALL" ? "ทุกสถานะ" : PRODUCTION_JOB_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-400">ค้นหาสินค้า / เลขใบ</span>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="SKU, ชื่อสินค้า, PRD-..."
              className={`mt-1 ${filterInputClass}`}
            />
          </label>
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-400">
            พบ {filtered.length} งาน · ฉบับร่าง {drafts.length} งาน (ส่งได้ทีละหลายงาน)
          </p>
          {(dateFilter !== today || tableFilter !== "ALL" || statusFilter !== "ALL" || q) && (
            <button
              onClick={() => {
                setDateFilter(today);
                setTableFilter("ALL");
                setStatusFilter("ALL");
                setQ("");
              }}
              className="text-xs font-bold text-[#0F5C3F] hover:underline"
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[#E8ECEA] bg-white p-16 text-center shadow-xs">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0F5C3F] border-t-transparent" />
          <p className="mt-3 text-sm font-semibold text-slate-500">กำลังดึงข้อมูลงานผลิต...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PRODUCTION_TABLES.map((tableNo) => {
            const tableJobs = filtered.filter((j) => j.table_no === tableNo);
            const tableDrafts = tableJobs.filter((j) => j.status === "DRAFT").length;
            const allSelected = tableDrafts > 0 && tableJobs.every((j) => j.status !== "DRAFT" || selected.has(j.job_no));
            return (
              <div key={tableNo} className="rounded-xl border border-[#E8ECEA] bg-white p-4 shadow-xs">
                <div className="mb-3 flex items-center justify-between gap-2 border-b border-[#EEF1EF] pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#06402B] font-mono text-base font-black text-white">
                      {tableNo}
                    </span>
                    <div>
                      <div className="text-sm font-extrabold text-slate-900">โต๊ะผลิต {tableNo}</div>
                      <div className="text-[11px] font-semibold text-slate-400">
                        {tableJobs.length} งาน{tableDrafts > 0 ? ` · ฉบับร่าง ${tableDrafts}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {tableDrafts > 0 && (
                      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              const tJobs = tableJobs.filter((j) => j.status === "DRAFT");
                              if (allSelected) tJobs.forEach((j) => next.delete(j.job_no));
                              else tJobs.forEach((j) => next.add(j.job_no));
                              return next;
                            })
                          }
                          className="h-4 w-4 accent-[#06402B]"
                        />
                        เลือกทั้งโต๊ะ
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setAddTable(tableNo);
                        setAddOpen(true);
                      }}
                      className="rounded-lg border border-[#C9DFD4] bg-[#EAF2EE] px-2.5 py-1.5 text-xs font-bold text-[#053425] transition-all hover:bg-[#D9EAE1] active:scale-95"
                    >
                      + งาน
                    </button>
                  </div>
                </div>

                {tableJobs.length === 0 ? (
                  <p className="py-8 text-center text-sm font-semibold text-slate-300">ยังไม่มีงานในโต๊ะนี้</p>
                ) : (
                  <div className="space-y-2.5">
                    {tableJobs.map((job) => (
                      <div key={job.job_no} className="rounded-lg border border-[#EEF1EF] bg-[#F7FAF8] p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-2.5">
                            {job.status === "DRAFT" && (
                              <input
                                type="checkbox"
                                checked={selected.has(job.job_no)}
                                onChange={() => toggleSelect(job.job_no)}
                                className="mt-1 h-4.5 w-4.5 shrink-0 accent-[#06402B]"
                              />
                            )}
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <StatusBadge status={job.status} />
                                <PriorityBadge priority={job.priority} />
                              </div>
                              <div className="mt-1 truncate text-sm font-bold text-slate-900">{job.product_name}</div>
                              <div className="font-mono text-[11px] font-semibold text-slate-400">
                                {job.job_no} · {job.sku}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Link
                              href={`/production/jobs/${encodeURIComponent(job.job_no)}`}
                              className="rounded-lg px-2 py-1 text-[11px] font-bold text-[#0F5C3F] hover:bg-[#EAF2EE]"
                            >
                              รายละเอียด →
                            </Link>
                            {job.status === "DRAFT" || job.status === "WAITING" || job.status === "IN_PROGRESS" ? (
                              <button
                                onClick={() => setEditJob(job)}
                                className="rounded-lg px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100"
                              >
                                แก้ไข
                              </button>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-2.5">
                          <JobNumbers job={job} compact />
                        </div>

                        {job.status === "DRAFT" && (
                          <div className="mt-2 flex justify-end gap-1.5 border-t border-[#EEF1EF] pt-2">
                            <button
                              onClick={() => handleDeleteDraft(job)}
                              className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50"
                            >
                              ลบฉบับร่าง
                            </button>
                          </div>
                        )}
                        {job.status !== "DRAFT" && job.status !== "CANCELLED" && (
                          <div className="mt-2 flex justify-end gap-1.5 border-t border-[#EEF1EF] pt-2">
                            <button
                              onClick={() => setCancelJob(job)}
                              className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50"
                            >
                              ยกเลิกงาน
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* แถบล่าง: ยืนยันส่งงานผลิตหลายงานพร้อมกัน */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex w-full max-w-2xl items-center justify-between gap-3 rounded-xl bg-[#06402B] px-5 py-3.5 shadow-2xl">
            <div className="text-sm font-bold text-white">
              เลือก {selected.size} งานฉบับร่าง
              <span className="ml-2 font-mono text-xs font-semibold text-[#9CC7B4]">
                เป้ารวม {formatQty(selectedJobs.reduce((s, j) => s + j.target_qty, 0))} ชิ้น
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelected(new Set())}
                className="rounded-lg px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/10"
              >
                ล้าง
              </button>
              <button
                onClick={handleSubmitJobs}
                disabled={submittingJobs}
                className="rounded-lg bg-white px-4 py-2.5 text-sm font-extrabold text-[#06402B] transition-all hover:bg-[#EAF2EE] active:scale-95 disabled:opacity-50"
              >
                {submittingJobs ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#06402B] border-t-transparent" />
                ) : (
                  "ยืนยันส่งงานผลิต"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <AddJobModal
        open={addOpen}
        mode="create"
        defaultTable={addTable}
        defaultDate={dateFilter || undefined}
        submitting={submitting}
        error={modalError}
        onClose={() => {
          setAddOpen(false);
          setModalError(null);
        }}
        onSubmit={handleAdd}
      />

      <AddJobModal
        open={!!editJob}
        mode="edit"
        job={editJob || undefined}
        submitting={submitting}
        error={modalError}
        onClose={() => {
          setEditJob(null);
          setModalError(null);
        }}
        onSubmit={handleEdit}
      />

      <ReasonModal
        open={!!cancelJob}
        title={`ยกเลิกงาน ${cancelJob?.job_no || ""}`}
        hint="งานที่ยกเลิกจะไม่ถูกลบ — ผลผลิตที่ยืนยันแล้วทั้งหมดยังเก็บไว้ และระบบจะแจ้งผู้ผลิต"
        reasonLabel="เหตุผลการยกเลิก"
        confirmLabel="ยืนยันยกเลิก"
        tone="danger"
        submitting={submitting}
        error={modalError}
        onClose={() => {
          setCancelJob(null);
          setModalError(null);
        }}
        onSubmit={handleCancelJob}
      />
    </div>
  );
}
