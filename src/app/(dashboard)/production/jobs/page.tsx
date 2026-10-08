"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import {
  useProductionJobs,
  productionFetch,
  emitProductionUpdated,
} from "../_lib/use-production-data";
import { StatusBadge, PriorityBadge, JobNumbers, formatQty } from "../_components/ui";
import type { ProductionJob } from "@/types/production";
import { PRODUCTION_JOB_STATUS_LABELS, PRODUCTION_TABLES } from "@/types/production";

// หน้างานผลิตทั้ง 5 โต๊ะ (§3) — workspace ของ APPROVER (เริ่มผลิต / รายงานผล) และ ADMIN ดูได้
// อัปเดตอัตโนมัติทุก 30 วิขณะเปิดอยู่ (เห็นงานใหม่ที่ ADMIN ส่งเข้ามา)

const filterInputClass =
  "w-full rounded-lg border border-[#E8ECEA] bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 focus:outline-none";

type DatePreset = "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "ALL";

export default function ProductionJobsPage() {
  const { user } = useTabAuth();
  const isApprover = user?.role === "APPROVER";
  const isAdmin = user?.role === "ADMIN";
  const { jobs, loading, error, reload } = useProductionJobs();

  usePollingWhenVisible(
    useCallback(
      (initial?: boolean) => {
        if (!initial) reload();
      },
      [reload]
    ),
    30000
  );

  const [preset, setPreset] = useState<DatePreset>("LAST_7_DAYS");
  const [dateBounds, setDateBounds] = useState<{ from: string; to: string }>({ from: "", to: "" });

  useEffect(() => {
    const now = new Date();
    const toYMD = (d: Date) => {
      const bangkok = new Date(d.getTime() + 7 * 60 * 60 * 1000);
      return bangkok.toISOString().slice(0, 10);
    };
    if (preset === "ALL") setDateBounds({ from: "", to: "" });
    else if (preset === "TODAY") setDateBounds({ from: toYMD(now), to: toYMD(now) });
    else if (preset === "YESTERDAY") {
      const y = new Date(now.getTime() - 86400000);
      setDateBounds({ from: toYMD(y), to: toYMD(y) });
    } else setDateBounds({ from: toYMD(new Date(now.getTime() - 6 * 86400000)), to: toYMD(now) });
  }, [preset]);
  const [tableFilter, setTableFilter] = useState<number | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (dateBounds.from && j.production_date < dateBounds.from) return false;
      if (dateBounds.to && j.production_date > dateBounds.to) return false;
      if (tableFilter !== "ALL" && j.table_no !== tableFilter) return false;
      if (statusFilter !== "ALL" && j.status !== statusFilter) return false;
      if (query && !`${j.job_no} ${j.sku} ${j.product_name}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [jobs, dateBounds, tableFilter, statusFilter, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { WAITING: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, DRAFT: 0 };
    for (const j of filtered) c[j.status] = (c[j.status] || 0) + 1;
    return c;
  }, [filtered]);

  const handleStart = async (job: ProductionJob) => {
    if (!window.confirm(`เริ่มผลิต ${job.job_no}?\n${job.product_name} · โต๊ะ ${job.table_no} · เป้า ${formatQty(job.target_qty)} ${job.unit}`)) return;
    setBusyJob(job.job_no);
    const res = await productionFetch(`/api/production/jobs/${encodeURIComponent(job.job_no)}/start`, "POST");
    setBusyJob(null);
    setToast({ tone: res.success ? "ok" : "err", message: res.message });
    if (res.success) emitProductionUpdated();
  };

  return (
    <div className="w-full max-w-full pb-10">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-slate-900">งานผลิต</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">
          {isApprover
            ? "งานทั้ง 5 โต๊ะ — กด “เริ่มผลิต” เมื่อรับงาน แล้วรายงานผลได้หลายรอบจนกว่าจะจบงาน"
            : "ภาพรวมงานผลิตทั้ง 5 โต๊ะ — กดดูรายละเอียดเพื่อติดตามผลและจัดการงาน"}
        </p>
      </div>

      {toast && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 ${
            toast.tone === "ok"
              ? "border-[#C9DFD4] bg-[#EAF2EE] text-[#053425]"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <p className="text-sm font-bold">{toast.message}</p>
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

      {/* สรุปสถานะ */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {(["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DRAFT"] as const).map((s) => (
          <div key={s} className="rounded-xl border border-[#E8ECEA] bg-white px-3.5 py-3 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{PRODUCTION_JOB_STATUS_LABELS[s]}</div>
            <div className="mt-0.5 font-mono text-2xl font-black text-slate-900">{counts[s] || 0}</div>
          </div>
        ))}
      </div>

      {/* ตัวกรอง */}
      <div className="mb-5 rounded-xl border border-[#E8ECEA] bg-white p-4 shadow-xs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="text-xs font-bold text-slate-400">ช่วงวันที่ผลิต</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)} className={`mt-1 ${filterInputClass}`}>
              <option value="TODAY">วันนี้</option>
              <option value="YESTERDAY">เมื่อวาน</option>
              <option value="LAST_7_DAYS">7 วันล่าสุด</option>
              <option value="ALL">ทั้งหมด</option>
            </select>
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
              <option value="ALL">ทุกสถานะ</option>
              {(["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DRAFT"] as const).map((s) => (
                <option key={s} value={s}>{PRODUCTION_JOB_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-400">ค้นหา</span>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="SKU, ชื่อสินค้า, PRD-..."
              className={`mt-1 ${filterInputClass}`}
            />
          </label>
        </div>
        <p className="mt-2.5 text-xs font-semibold text-slate-400">พบ {filtered.length} งาน</p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[#E8ECEA] bg-white p-16 text-center shadow-xs">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0F5C3F] border-t-transparent" />
          <p className="mt-3 text-sm font-semibold text-slate-500">กำลังดึงข้อมูลงานผลิต...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[#E8ECEA] bg-white px-6 py-16 text-center shadow-xs">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#C9DFD4] bg-[#EAF2EE] text-2xl">🏭</div>
          <h2 className="mt-4 text-lg font-extrabold text-slate-900">ไม่พบงานผลิตตามตัวกรอง</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm font-medium text-slate-500">
            {isApprover
              ? "เมื่อ ADMIN ส่งงานผลิตใหม่ งานจะมาปรากฏที่นี่พร้อมแจ้งเตือน"
              : "ลองปรับตัวกรอง หรือไปสร้างงานใหม่ที่หน้าวางแผนผลิต"}
          </p>
          {isAdmin && (
            <Link href="/production" className="mt-5 inline-block rounded-lg bg-[#06402B] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0A5C4E]">
              ไปหน้าวางแผนผลิต
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => (
            <div key={job.job_no} className="rounded-xl border border-[#E8ECEA] bg-white p-4 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#06402B] font-mono text-xs font-black text-white">
                      {job.table_no}
                    </span>
                    <StatusBadge status={job.status} />
                    <PriorityBadge priority={job.priority} />
                    <span className="font-mono text-xs font-semibold text-slate-400">{job.job_no}</span>
                  </div>
                  <div className="mt-1.5 text-base font-extrabold text-slate-900">{job.product_name}</div>
                  <div className="font-mono text-xs font-semibold text-slate-400">
                    {job.sku}
                    {job.note ? ` · ${job.note}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  {isApprover && job.status === "WAITING" && (
                    <button
                      onClick={() => handleStart(job)}
                      disabled={busyJob === job.job_no}
                      className="rounded-lg bg-[#06402B] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#06402B]/20 transition-all hover:bg-[#0A5C4E] active:scale-95 disabled:opacity-50"
                    >
                      {busyJob === job.job_no ? (
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        "▶ เริ่มผลิต"
                      )}
                    </button>
                  )}
                  <Link
                    href={`/production/jobs/${encodeURIComponent(job.job_no)}`}
                    className="rounded-lg border border-[#E8ECEA] bg-white px-4 py-2.5 text-center text-sm font-bold text-slate-700 transition-all hover:border-[#C8DBD1] hover:bg-slate-50"
                  >
                    {isApprover && job.status === "IN_PROGRESS" ? "รายงานผล →" : "รายละเอียด →"}
                  </Link>
                </div>
              </div>
              <div className="mt-3">
                <JobNumbers job={job} />
              </div>
              {job.status === "COMPLETED" && job.remaining_qty > 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  ⚠️ จบงานต่ำกว่าเป้าหมาย — ขาด {formatQty(job.remaining_qty)} {job.unit}
                  {job.close_reason ? ` · เหตุผล: ${job.close_reason}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
