"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import {
  useProductionJobs,
  emitProductionUpdated,
  PRODUCTION_POLL_MS,
} from "@/features/production/hooks/use-production-data";
import { useSubmitGuard } from "@/features/production/hooks/use-submit-guard";
import { productionApi, isConflict } from "@/features/production/lib/api";
import { sendWithIdempotency } from "@/features/production/lib/idempotency";
import { getAllowedActions } from "@/features/production/lib/permissions";
import { ConfirmModal, StartJobSummary } from "@/features/production/components/ActionModals";
import ReportModal, { type ReportPayload } from "@/features/production/components/ReportModal";
import ProductionPrintButton from "@/features/production/components/ProductionPrintButton";
import {
  StatusBadge,
  PriorityBadge,
  JobNumbers,
  JobSignalBadges,
  formatQty,
  priorityEdgeClass,
} from "@/features/production/components/ui";
import { M3Banner, M3Empty, M3ErrorBanner, M3Field, M3Loading, M3NumberTile, m3Cls } from "@/components/ui/m3";
import { SolarArrowRight, SolarFactory, SolarMagnifier, SolarPlayCircle } from "@/components/icons";
import type { ProductionJob } from "@/types/production";
import { PRODUCTION_JOB_STATUS_LABELS, PRODUCTION_TABLES } from "@/types/production";

// หน้างานผลิตทั้ง 5 โต๊ะ (§3) — workspace ของ APPROVER (เริ่มผลิต / รายงานผล) และ ADMIN ดูได้
// อัปเดตอัตโนมัติทุก 30 วิขณะเปิดอยู่ (เห็นงานใหม่ที่ ADMIN ส่งเข้ามา)

type DatePreset = "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "ALL";

export default function ProductionJobsPage() {
  const { user } = useTabAuth();
  const isApprover = user?.role === "APPROVER";
  const isAdmin = user?.role === "ADMIN";

  const [preset, setPreset] = useState<DatePreset>("LAST_7_DAYS");
  // null = ยังไม่ได้คำนวณ (คำนวณใน effect ตามเวลาไทยฝั่ง client)
  const [dateBounds, setDateBounds] = useState<{ from: string; to: string } | null>(null);

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
  const [statusFilter, setStatusFilter] = useState<string>("WAITING");
  const [q, setQ] = useState("");
  // ส่งช่วงวันที่/โต๊ะ/สถานะให้เซิร์ฟเวอร์กรอง (รอคำนวณช่วงวันที่จาก preset ก่อน)
  const { jobs, loading, error, reload } = useProductionJobs(
    {
      date_from: dateBounds?.from || undefined,
      date_to: dateBounds?.to || undefined,
      table_no: tableFilter,
      status: statusFilter,
    },
    { enabled: dateBounds !== null }
  );

  usePollingWhenVisible(
    useCallback(
      (initial?: boolean) => {
        if (!initial) reload();
      },
      [reload]
    ),
    PRODUCTION_POLL_MS
  );
  const guard = useSubmitGuard();
  const [startJob, setStartJob] = useState<ProductionJob | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [reportJob, setReportJob] = useState<ProductionJob | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (dateBounds?.from && j.production_date < dateBounds.from) return false;
      if (dateBounds?.to && j.production_date > dateBounds.to) return false;
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

  // รวมงานที่โต๊ะเดียวกัน (และวันเดียวกัน) ไว้ในการ์ดเดียว — คงลำดับเดิม
  const groupedByTable = useMemo(() => {
    const map = new Map<string, { key: string; table_no: number; jobs: typeof filtered }>();
    for (const j of filtered) {
      const key = `${j.production_date}|${j.table_no}`;
      const g = map.get(key);
      if (g) g.jobs.push(j);
      else map.set(key, { key, table_no: j.table_no, jobs: [j] });
    }
    return Array.from(map.values());
  }, [filtered]);

  const handleStart = (job: ProductionJob) =>
    guard.run(async () => {
      setStartError(null);
      const res = await productionApi(`/api/production/jobs/${encodeURIComponent(job.job_no)}/start`, "POST");
      if (res.success) {
        setStartJob(null);
        setToast({ tone: "ok", message: res.message });
        emitProductionUpdated();
      } else {
        setStartError(res.message);
        if (isConflict(res)) emitProductionUpdated();
      }
    }, `start:${job.job_no}`);

  const handleReport = (job: ProductionJob, payload: ReportPayload) =>
    guard.run(async () => {
      setReportError(null);
      const res = await sendWithIdempotency(
        { action: "report", jobNo: job.job_no, round: job.report_count + 1, payload: { ...payload } },
        (idempotency_key) =>
          productionApi(`/api/production/jobs/${encodeURIComponent(job.job_no)}/report`, "POST", {
            ...payload,
            idempotency_key,
          })
      );
      if (res.success) {
        setReportJob(null);
        setToast({ tone: "ok", message: res.message });
        emitProductionUpdated();
      } else {
        setReportError(res.message);
        if (isConflict(res)) emitProductionUpdated();
      }
    }, `report:${job.job_no}`);

  const STATUS_TABS = ["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DRAFT"] as const;
  const STATUS_COUNT_TONE: Record<(typeof STATUS_TABS)[number], string> = {
    WAITING: "m3-label-warning",
    IN_PROGRESS: "m3-label-info",
    COMPLETED: "m3-label-success",
    CANCELLED: "m3-label-default",
    DRAFT: "m3-label-default",
  };

  return (
    <div className="w-full max-w-full pb-10">
      <h1 className="sr-only">งานผลิต</h1>
      {(isAdmin || isApprover) && <div className="mb-4 flex justify-end"><ProductionPrintButton jobs={filtered} disabled={loading} /></div>}

      {toast && (
        <div className="mb-4">
          {toast.tone === "ok" ? (
            <M3Banner tone="success" role="status">
              {toast.message}
            </M3Banner>
          ) : (
            <M3ErrorBanner message={toast.message} />
          )}
        </div>
      )}
      {error && !loading && (
        <div className="mb-4">
          <M3ErrorBanner
            message={error}
            action={
              <button type="button" onClick={() => reload()} className="m3-btn m3-btn-sm m3-btn-text">
                ลองใหม่
              </button>
            }
          />
        </div>
      )}

      {/* ตัวกรอง */}
      <div className="m3-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-[150px_150px_150px_minmax(0,1fr)]">
          <M3Field label="ช่วงวันที่ผลิต">
            <select value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)} className={`h-12 ${m3Cls.input}`}>
              <option value="TODAY">วันนี้</option>
              <option value="YESTERDAY">เมื่อวาน</option>
              <option value="LAST_7_DAYS">7 วันล่าสุด</option>
              <option value="ALL">ทั้งหมด</option>
            </select>
          </M3Field>
          <M3Field label="โต๊ะผลิต">
            <select
              value={String(tableFilter)}
              onChange={(e) => setTableFilter(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
              className={`h-12 ${m3Cls.input}`}
            >
              <option value="ALL">ทุกโต๊ะ</option>
              {PRODUCTION_TABLES.map((t) => (
                <option key={t} value={t}>โต๊ะ {t}</option>
              ))}
            </select>
          </M3Field>
          <M3Field label="สถานะ">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`h-12 ${m3Cls.input}`}>
              <option value="ALL">ทุกสถานะ</option>
              {STATUS_TABS.map((s) => (
                <option key={s} value={s}>{PRODUCTION_JOB_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </M3Field>
          <label className="relative block sm:col-span-3 lg:col-span-1">
            <span className="sr-only">ค้นหา</span>
            <SolarMagnifier size={20} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-m3-grey-500" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="SKU, ชื่อสินค้า, PRD-..."
              className={`h-12 pl-11 ${m3Cls.input}`}
            />
          </label>
        </div>
      </div>

      {/* สรุปสถานะ (แสดงผลอย่างเดียว — นับจากรายการที่กรองแล้ว) */}
      <div className="m3-card mt-4 flex items-center gap-x-6 gap-y-2 overflow-x-auto px-4 sm:px-5">
        <span className="flex h-12 shrink-0 items-center gap-2 border-b-2 border-m3-grey-800 text-sm font-bold text-m3-grey-800">
          ทั้งหมด
          <span className="m3-label h-5 bg-m3-grey-800 px-1.5 text-[11px] text-white">{filtered.length}</span>
        </span>
        {STATUS_TABS.filter((s) => (counts[s] || 0) > 0 || s === "WAITING" || s === "IN_PROGRESS").map((s) => (
          <span key={s} className="flex h-12 shrink-0 items-center gap-2 text-sm font-semibold text-m3-grey-600">
            {PRODUCTION_JOB_STATUS_LABELS[s]}
            <span className={`m3-label h-5 px-1.5 text-[11px] ${STATUS_COUNT_TONE[s]}`}>{counts[s] || 0}</span>
          </span>
        ))}
      </div>

      {loading ? (
        <div className="mt-5">
          <M3Loading label="กำลังดึงข้อมูลงานผลิต..." />
        </div>
      ) : filtered.length === 0 ? (
        <div className="m3-card mt-5 p-6">
          <M3Empty title="ไม่พบงานผลิตตามตัวกรอง" icon={<SolarFactory size={40} />}>
            {isAdmin && (
              <Link href="/production" className="m3-btn m3-btn-primary mt-3 h-11 px-5">
                ไปหน้าวางแผนผลิต
              </Link>
            )}
          </M3Empty>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
          {groupedByTable.map((group) => (
            <div
              key={group.key}
              className={`m3-card relative flex flex-col overflow-hidden p-4 before:absolute before:inset-y-0 before:left-0 before:w-1 sm:p-5 ${priorityEdgeClass(group.jobs[0].priority)}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <M3NumberTile>{group.table_no}</M3NumberTile>
                <span className="mr-1 text-sm font-bold text-m3-grey-800">โต๊ะ {group.table_no}</span>
              </div>
              <div className="divide-y divide-dashed divide-[rgba(145,158,171,0.32)]">
          {group.jobs.map((job) => {
            const actions = getAllowedActions(job, user?.role);
            return (
              <div key={job.job_no} className="flex flex-col py-4 last:pb-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={job.status} />
                  <PriorityBadge priority={job.priority} />
                  <JobSignalBadges job={job} />
                </div>
                <div className="mt-2 text-base leading-snug font-semibold text-m3-grey-800">{job.product_name}</div>
                <div className="mt-0.5 truncate text-xs tabular-nums text-m3-grey-500">
                  {job.job_no} · {job.sku}
                  {job.note ? ` · ${job.note}` : ""}
                </div>
                <div className="mt-3">
                  <JobNumbers job={job} compact />
                </div>
                {job.status === "COMPLETED" && job.remaining_qty > 0 && (
                  <M3Banner tone="warning" className="mt-3 px-3 py-2">
                    <span className="text-xs">
                      จบงานต่ำกว่าเป้าหมาย — ขาด {formatQty(job.remaining_qty)} {job.unit}
                      {job.close_reason ? ` · เหตุผล: ${job.close_reason}` : ""}
                    </span>
                  </M3Banner>
                )}
                <div className="mt-4 flex flex-col gap-2">
                  {actions.start && (
                    <button
                      onClick={() => {
                        setStartError(null);
                        setStartJob(job);
                      }}
                      disabled={guard.pending}
                      className="m3-btn m3-btn-primary h-11 w-full"
                    >
                      {guard.isPending(`start:${job.job_no}`) ? (
                        <span className={m3Cls.spinner} />
                      ) : (
                        <>
                          <SolarPlayCircle size={18} />
                          เริ่มผลิต
                        </>
                      )}
                    </button>
                  )}
                  {actions.report ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReportError(null);
                        setReportJob(job);
                      }}
                      disabled={guard.pending}
                      className={`m3-btn h-11 w-full ${!actions.start ? "m3-btn-primary" : "m3-btn-outline"}`}
                    >
                      {guard.isPending(`report:${job.job_no}`) ? (
                        <span className={m3Cls.spinner} />
                      ) : (
                        <>
                          รายงานผล
                          <SolarArrowRight size={18} />
                        </>
                      )}
                    </button>
                  ) : null}
                  <Link
                    href={`/production/jobs/${encodeURIComponent(job.job_no)}`}
                    className={`m3-btn h-11 w-full ${actions.report ? "m3-btn-text" : actions.start ? "m3-btn-outline" : "m3-btn-primary"}`}
                  >
                    รายละเอียด
                    {!actions.report ? <SolarArrowRight size={18} /> : null}
                  </Link>
                </div>
              </div>
            );
          })}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!startJob}
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
        submitting={guard.pending}
        error={startError}
        onClose={() => {
          setStartJob(null);
          setStartError(null);
        }}
        onConfirm={() => startJob && handleStart(startJob)}
      >
        {startJob && <StartJobSummary job={startJob} />}
      </ConfirmModal>

      <ReportModal
        open={!!reportJob}
        job={reportJob}
        submitting={guard.pending}
        error={reportError}
        onClose={() => {
          setReportJob(null);
          setReportError(null);
        }}
        onSubmit={(payload) => reportJob && handleReport(reportJob, payload)}
      />
    </div>
  );
}
