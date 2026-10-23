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
import { getAllowedActions, showCancelOnPlanningCard } from "@/features/production/lib/permissions";
import { buildCreateJobInput, buildJobPatch } from "@/features/production/lib/job-form";
import AddJobModal, { type AddJobFormValue } from "@/features/production/components/AddJobModal";
import { ConfirmModal, ReasonModal } from "@/features/production/components/ActionModals";
import {
  PriorityBadge,
  JobSignalBadges,
  formatQty,
  priorityEdgeClass,
  todayYMD,
} from "@/features/production/components/ui";
import {
  M3Banner,
  M3ErrorBanner,
  M3Field,
  M3Loading,
  M3NumberTile,
  isStaleDataMessage,
  m3Cls,
} from "@/components/ui/m3";
import {
  SolarAddLine,
  SolarArrowRight,
  SolarChartBars,
  SolarCheckCircle,
  SolarFlag,
  SolarMagnifier,
} from "@/components/icons";
import type { ProductionJob } from "@/types/production";
import { PRODUCTION_JOB_STATUS_LABELS, PRODUCTION_TABLES } from "@/types/production";

// หน้าวางแผนผลิต (§1–2) — การ์ดโต๊ะ 1–5 + ฉบับร่างแก้/ลบ/ย้ายโต๊ะได้ทันที
// เลือกหลายงานแล้ว "ยืนยันส่งงานผลิต" (DRAFT → WAITING + แจ้ง APPROVER)
// แถบปุ่มบน / ตัวกรอง / แท็บสถานะ ซ่อนเมื่อ role === ADMIN (พนักงานยังเห็นตามเดิม)

const STATUS_OPTIONS = ["ALL", "DRAFT", "WAITING", "IN_PROGRESS", "CANCELLED"] as const;

export default function ProductionPlanningPage() {
  const { user } = useTabAuth();
  const isAdmin = user?.role === "ADMIN";

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

  // ส่งตัวกรองวันที่/โต๊ะ/สถานะให้เซิร์ฟเวอร์กรอง (รอค่า "วันนี้" ก่อนจึงเริ่มดึง — ไม่ดึงทุกงานรอบแรกทิ้ง)
  const { jobs, loading, error, reload } = useProductionJobs(
    {
      date_from: dateFilter || undefined,
      date_to: dateFilter || undefined,
      table_no: tableFilter,
      status: statusFilter,
    },
    { enabled: today !== "" }
  );

  // อัปเดตอัตโนมัติทุก 30 วิขณะแท็บมองเห็น (หยุดเมื่อซ่อนแท็บ · กลับมาแล้วโหลดทันที)
  usePollingWhenVisible(
    useCallback(
      (initial?: boolean) => {
        if (!initial) reload();
      },
      [reload]
    ),
    PRODUCTION_POLL_MS
  );

  // modals
  const [addOpen, setAddOpen] = useState(false);
  const [addTable, setAddTable] = useState(1);
  const [editJob, setEditJob] = useState<ProductionJob | null>(null);
  const [cancelJob, setCancelJob] = useState<ProductionJob | null>(null);
  const guard = useSubmitGuard();
  const submitting = guard.pending;
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (j.status === "COMPLETED") return false;
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

  const handleAdd = (value: AddJobFormValue) =>
    guard.run(async () => {
      setModalError(null);
      const res = await productionApi("/api/production/jobs", "POST", {
        jobs: [buildCreateJobInput(value)],
      });
      if (res.success) {
        setAddOpen(false);
        setDateFilter(value.production_date);
        setTableFilter(value.table_no);
        setToast("เพิ่มงานฉบับร่างแล้ว");
        emitProductionUpdated();
      } else {
        setModalError(res.message);
      }
    }, "create");

  const handleEdit = (value: AddJobFormValue) =>
    guard.run(async () => {
      if (!editJob) return;
      setModalError(null);
      const res = await productionApi(
        `/api/production/jobs/${encodeURIComponent(editJob.job_no)}`,
        "PATCH",
        buildJobPatch(editJob, value)
      );
      if (res.success) {
        setEditJob(null);
        setSubmitError(null);
        setToast("แก้ไขงานแล้ว");
        emitProductionUpdated();
      } else {
        setModalError(res.message);
        if (isConflict(res)) emitProductionUpdated();
      }
    }, "edit");

  // ยืนยันลบฉบับร่าง/ส่งงานผลิตด้วย ConfirmModal แทน window.confirm (D29) — ขั้นตอนเรียก API เหมือนเดิม
  const [deleteDraftJob, setDeleteDraftJob] = useState<ProductionJob | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);

  const handleDeleteDraft = (job: ProductionJob) => {
    if (guard.pending) return;
    setDeleteDraftJob(job);
  };

  const confirmDeleteDraft = () => {
    const job = deleteDraftJob;
    if (!job) return;
    return guard.run(async () => {
      const res = await productionApi(`/api/production/jobs/${encodeURIComponent(job.job_no)}`, "DELETE");
      setDeleteDraftJob(null);
      if (res.success) {
        setToast("ลบฉบับร่างเรียบร้อย");
        emitProductionUpdated();
      } else {
        setToast(res.message);
        if (isConflict(res)) emitProductionUpdated();
      }
    }, `delete:${job.job_no}`);
  };

  const handleCancelJob = (reason: string) =>
    guard.run(async () => {
      if (!cancelJob) return;
      setModalError(null);
      const res = await productionApi(
        `/api/production/jobs/${encodeURIComponent(cancelJob.job_no)}/cancel`,
        "POST",
        { reason }
      );
      if (res.success) {
        setCancelJob(null);
        setToast("ยกเลิกงานแล้ว");
        emitProductionUpdated();
      } else {
        setModalError(res.message);
        if (isConflict(res)) emitProductionUpdated();
      }
    }, "cancel");

  const handleSubmitJobs = () => {
    if (selectedJobs.length === 0 || guard.pending) return;
    setSubmitConfirmOpen(true);
  };

  const confirmSubmitJobs = () => {
    if (selectedJobs.length === 0) return;
    return guard.run(async () => {
      setSubmitError(null);
      const res = await productionApi("/api/production/jobs/submit", "POST", {
        job_nos: selectedJobs.map((j) => j.job_no),
      });
      setSubmitConfirmOpen(false);
      if (res.success) {
        setSelected(new Set());
        setToast(res.message);
        emitProductionUpdated();
      } else {
        setSubmitError(res.message);
        if (isConflict(res)) emitProductionUpdated();
      }
    }, "submit");
  };

  // ตัวนับสถานะ (D26 — แสดงผลอย่างเดียว คำนวณจากรายการที่กรองแล้ว)
  const statusCounts = useMemo(() => {
    const c = { DRAFT: 0, WAITING: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, under: 0, urgent: 0 };
    for (const j of filtered) {
      c[j.status] += 1;
      if (j.status === "COMPLETED" && j.remaining_qty > 0) c.under += 1;
      if (j.priority !== "NORMAL" && j.status !== "CANCELLED" && j.status !== "COMPLETED") c.urgent += 1;
    }
    return c;
  }, [filtered]);
  const selectedTables = useMemo(
    () => Array.from(new Set(selectedJobs.map((j) => j.table_no))).sort((x, y) => x - y),
    [selectedJobs]
  );
  const selectedTargetTotal = selectedJobs.reduce((s, j) => s + j.target_qty, 0);

  const chip = "m3-label h-7 px-2.5 text-[13px]";

  return (
    <div className="w-full max-w-full pb-32">
      <h1 className="sr-only">วางแผนผลิต</h1>
      {/* แถบปุ่ม / ตัวกรอง / แท็บสถานะ — โชว์เฉพาะพนักงาน (ไม่ใช่ Admin) */}
      {!isAdmin && (
      <div className="mb-5 flex flex-wrap items-center justify-end gap-3 sm:mb-6">
        <Link href="/production/jobs" className="m3-btn m3-btn-outline">
          ประวัติงานผลิต
        </Link>
        <Link href="/production/summary" className="m3-btn m3-btn-outline">
          <SolarChartBars size={18} />
          สรุปผลผลิต
        </Link>
        <button
          type="button"
          onClick={() => {
            setAddTable(typeof tableFilter === "number" ? tableFilter : 1);
            setAddOpen(true);
          }}
          className="m3-btn m3-btn-dark"
        >
          <SolarAddLine size={18} />
          เพิ่มงานผลิต
        </button>
      </div>
      )}

      {toast && (
        <div className="mb-4">
          {isStaleDataMessage(toast) ? (
            <M3ErrorBanner
              message={toast}
              action={
                <button type="button" onClick={() => reload()} className="m3-btn m3-btn-sm m3-btn-text">
                  รีเฟรช
                </button>
              }
            />
          ) : (
            <M3Banner tone="success" role="status">
              {toast}
            </M3Banner>
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

      {!isAdmin && (
      <>
      {/* ตัวกรอง */}
      <div className="m3-card p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[200px_170px_minmax(0,1fr)_190px]">
          <M3Field label="วันที่ผลิต">
            <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={`h-12 ${m3Cls.input}`} />
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
          <label className="relative col-span-2 block lg:col-span-1">
            <span className="sr-only">ค้นหาสินค้า / เลขใบ</span>
            <SolarMagnifier size={20} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-m3-grey-500" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="SKU, ชื่อสินค้า, PRD-..."
              className={`h-12 pl-11 ${m3Cls.input}`}
            />
          </label>
          <M3Field label="สถานะ" className="col-span-2 lg:col-span-1">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`h-12 ${m3Cls.input}`}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "ALL" ? "ทุกสถานะ" : PRODUCTION_JOB_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </M3Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-m3-grey-600">
            พบ {filtered.length} งาน · ฉบับร่าง {drafts.length} งาน
          </p>
          {(dateFilter !== today || tableFilter !== "ALL" || statusFilter !== "ALL" || q) && (
            <button
              onClick={() => {
                setDateFilter(today);
                setTableFilter("ALL");
                setStatusFilter("ALL");
                setQ("");
              }}
              className="m3-btn m3-btn-sm m3-btn-text"
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" aria-label="จำนวนงานตามสถานะ">
        <span className={`${chip} m3-label-default`}>ฉบับร่าง {statusCounts.DRAFT}</span>
        <span className={`${chip} m3-label-warning`}>รอผลิต {statusCounts.WAITING}</span>
        <span className={`${chip} m3-label-info`}>กำลังผลิต {statusCounts.IN_PROGRESS}</span>
        <span className={`${chip} m3-label-success`}>จบงาน {statusCounts.COMPLETED}</span>
        <span className={`${chip} m3-label-default`}>ยกเลิก {statusCounts.CANCELLED}</span>
        {statusCounts.under > 0 && <span className={`${chip} m3-label-error`}>จบต่ำกว่าเป้า {statusCounts.under}</span>}
        {statusCounts.urgent > 0 && <span className={`${chip} m3-label-warning`}>ด่วน {statusCounts.urgent}</span>}
      </div>
      </>
      )}

      {loading ? (
        <div className="mt-5">
          <M3Loading label="กำลังดึงข้อมูลงานผลิต..." />
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
          {PRODUCTION_TABLES.map((tableNo) => {
            const tableJobs = filtered.filter((j) => j.table_no === tableNo);
            const tableDrafts = tableJobs.filter((j) => j.status === "DRAFT").length;
            const allSelected = tableDrafts > 0 && tableJobs.every((j) => j.status !== "DRAFT" || selected.has(j.job_no));
            const tableUrgent = tableJobs.filter((j) => j.priority !== "NORMAL" && j.status !== "CANCELLED" && j.status !== "COMPLETED").length;
            return (
              <div key={tableNo} className="m3-card overflow-hidden">
                <div className="px-4 pt-4 pb-3 sm:px-[18px]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <M3NumberTile>{tableNo}</M3NumberTile>
                      <span className="text-base font-bold whitespace-nowrap text-m3-grey-800">โต๊ะผลิต {tableNo}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      {tableDrafts > 0 && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-m3-grey-600">
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
                            className="size-4 accent-m3-primary"
                          />
                          เลือกร่าง
                        </label>
                      )}
                      <button
                        type="button"
                        aria-label={`เพิ่มงานในโต๊ะ ${tableNo}`}
                        title="เพิ่มงาน"
                        onClick={() => {
                          setAddTable(tableNo);
                          setAddOpen(true);
                        }}
                        className="inline-flex size-8 items-center justify-center rounded-lg border border-[rgba(145,158,171,0.32)] text-m3-grey-800 transition-colors hover:bg-[rgba(145,158,171,0.08)]"
                      >
                        <SolarAddLine size={18} />
                      </button>
                    </div>
                  </div>
                  {(tableDrafts > 0 || tableUrgent > 0) && (
                    <div className="mt-2 ml-[38px] flex flex-wrap gap-1.5">
                      {tableDrafts > 0 && <span className="m3-label m3-label-default h-[22px]">ฉบับร่าง {tableDrafts}</span>}
                      {tableUrgent > 0 && (
                        <span className="m3-label m3-label-error h-[22px] gap-1">
                          <SolarFlag size={12} />
                          ด่วน {tableUrgent}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {tableJobs.length === 0 ? (
                  <p className="border-t border-dashed border-[rgba(145,158,171,0.2)] px-4 py-8 text-center text-sm text-m3-grey-500">
                    ยังไม่มีงานในโต๊ะนี้
                  </p>
                ) : (
                  <div>
                    {tableJobs.map((job) => {
                      const actions = getAllowedActions(job, user?.role);
                      const isSelected = selected.has(job.job_no);
                      return (
                        <div
                          key={job.job_no}
                          className={`relative px-4 py-4 before:absolute before:inset-y-0 before:left-0 before:w-1 sm:px-[18px] ${priorityEdgeClass(job.priority)} border-t border-dashed border-[rgba(145,158,171,0.2)] ${
                            isSelected ? "bg-[rgba(0,167,111,0.04)]" : ""
                          } ${job.status === "CANCELLED" ? "opacity-56" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              {actions.submit && (
                                <input
                                  type="checkbox"
                                  aria-label={`เลือก ${job.job_no}`}
                                  checked={selected.has(job.job_no)}
                                  onChange={() => toggleSelect(job.job_no)}
                                  className="mr-2 size-4.5 shrink-0 accent-m3-primary"
                                />
                              )}
                              <JobSignalBadges job={job} />
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              {actions.edit ? (
                                <button onClick={() => setEditJob(job)} className="m3-btn m3-btn-sm m3-btn-text text-m3-grey-600">
                                  แก้ไข
                                </button>
                              ) : null}
                              <Link
                                href={`/production/jobs/${encodeURIComponent(job.job_no)}`}
                                className="m3-btn m3-btn-sm m3-btn-text"
                              >
                                รายละเอียด
                              </Link>
                            </div>
                          </div>

                          <div className="mt-2.5 wrap-anywhere text-[15px] leading-snug font-semibold text-m3-grey-800">{job.product_name}</div>
                          <div className="mt-0.5 wrap-anywhere text-xs tabular-nums text-m3-grey-500">
                            บาร์โค้ด: {job.barcode || "—"}
                          </div>

                          <div className="mt-2.5 flex items-baseline justify-between rounded-lg bg-m3-grey-100 px-3 py-2">
                            <span className="text-[13px] text-m3-grey-600">จำนวนสั่งผลิต</span>
                            <span>
                              <b className="font-m3-disp text-[22px] font-bold tabular-nums text-m3-grey-800">{formatQty(job.target_qty)}</b>{" "}
                              <span className="text-[13px] text-m3-grey-600">{job.unit}</span>
                            </span>
                          </div>

                          {(actions.deleteDraft || showCancelOnPlanningCard(actions)) && (
                            <div className="mt-2.5 flex justify-end gap-1.5">
                              {actions.deleteDraft && (
                                <button
                                  onClick={() => handleDeleteDraft(job)}
                                  disabled={submitting}
                                  className="m3-btn m3-btn-sm m3-btn-text text-m3-error-dark"
                                >
                                  ลบฉบับร่าง
                                </button>
                              )}
                              {/* เดิมแสดงบนงาน "จบงาน" ด้วย — ตอนนี้ใช้กติกาเดียวกับหน้ารายละเอียด */}
                              {showCancelOnPlanningCard(actions) && (
                                <button onClick={() => setCancelJob(job)} className="m3-btn m3-btn-sm m3-btn-text text-m3-error-dark">
                                  ยกเลิกงาน
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* แถบล่าง: ยืนยันส่งงานผลิตหลายงานพร้อมกัน (D26/M38 — แถบเข้ม) */}
      {selectedJobs.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3 sm:px-4">
          <div className="pointer-events-auto w-full max-w-3xl overflow-hidden rounded-2xl bg-m3-grey-800 shadow-m3-dropdown">
            {submitError && (
              <div role="alert" className="bg-[#FFE9D5] px-4 py-3 text-sm text-m3-error-dark sm:px-5">
                <p className="font-bold">ส่งงานผลิตไม่สำเร็จ</p>
                <p className="mt-1">{submitError}</p>
                {selectedJobs.filter(j => !j.material_plan).slice(0, 1).map(j => (
                  <button key={j.job_no} type="button" disabled={submitting} onClick={() => { setModalError(null); setEditJob(j); }} className="m3-btn m3-btn-sm mt-2 border border-[rgba(255,86,48,0.32)] bg-white text-m3-error-dark hover:bg-[rgba(255,86,48,0.08)] disabled:opacity-48">
                    ตรวจวัตถุดิบของ {j.sku} · {j.job_no}
                  </button>
                ))}
              </div>
            )}
          <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5 text-white">
              <SolarCheckCircle size={20} className="hidden shrink-0 text-m3-primary sm:block" />
              <span className="text-sm font-bold whitespace-nowrap">เลือกฉบับร่าง {selectedJobs.length} งาน</span>
              <span className="truncate text-xs tabular-nums text-white/64">
                โต๊ะ {selectedTables.join(", ")} · เป้ารวม {formatQty(selectedTargetTotal)} ชิ้น
              </span>
              <button
                onClick={() => { setSelected(new Set()); setSubmitError(null); }}
                className="ml-auto rounded-lg px-2 py-1 text-xs font-bold text-white/80 hover:bg-white/10 sm:hidden"
              >
                ล้าง
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setSelected(new Set()); setSubmitError(null); }}
                className="hidden rounded-lg px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/10 sm:block"
              >
                ล้าง
              </button>
              <button
                onClick={handleSubmitJobs}
                disabled={submitting}
                className="m3-btn h-11 w-full bg-white px-4 text-m3-grey-800 hover:bg-m3-grey-100 sm:w-auto"
              >
                {guard.isPending("submit") ? (
                  <span className={`${m3Cls.spinner} text-m3-primary`} />
                ) : (
                  <>
                    <SolarArrowRight size={18} />
                    ยืนยันส่งงานผลิต ({selectedJobs.length})
                  </>
                )}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={submitConfirmOpen && selectedJobs.length > 0}
        title={`ยืนยันส่งงานผลิต ${selectedJobs.length} งาน?`}
        hint="แจ้งผู้ผลิต (APPROVER) ให้เริ่มงาน"
        icon={<SolarArrowRight size={26} />}
        widthClass="sm:max-w-[560px]"
        confirmLabel="ยืนยันส่งงานผลิต"
        submitting={guard.isPending("submit")}
        error={null}
        onClose={() => setSubmitConfirmOpen(false)}
        onConfirm={confirmSubmitJobs}
      >
        <ul className="divide-y divide-dashed divide-[rgba(145,158,171,0.32)] rounded-xl border border-[rgba(145,158,171,0.2)]">
          {selectedJobs.map((j) => (
            <li key={j.job_no} className="flex items-center gap-3 px-4 py-3">
              <M3NumberTile>{j.table_no}</M3NumberTile>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-m3-grey-800">{j.product_name}</p>
                <p className="text-xs tabular-nums text-m3-grey-500">
                  {j.job_no} · {j.sku}
                </p>
              </div>
              <PriorityBadge priority={j.priority} />
              <span className="shrink-0 text-right">
                <b className="font-m3-disp text-base font-bold tabular-nums text-m3-grey-800">{formatQty(j.target_qty)}</b>{" "}
                <span className="text-xs text-m3-grey-600">{j.unit}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between px-1 text-sm">
          <span className="text-m3-grey-600">รวมเป้าหมาย</span>
          <span>
            <b className="font-m3-disp text-lg font-bold tabular-nums text-m3-grey-800">{formatQty(selectedTargetTotal)}</b>{" "}
            <span className="text-xs text-m3-grey-600">ชิ้น</span>
          </span>
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={!!deleteDraftJob}
        title="ลบงานฉบับร่าง?"
        hint={deleteDraftJob ? `${deleteDraftJob.job_no} (${deleteDraftJob.product_name})` : undefined}
        tone="danger"
        confirmLabel="ลบฉบับร่าง"
        submitting={!!deleteDraftJob && guard.isPending(`delete:${deleteDraftJob.job_no}`)}
        error={null}
        onClose={() => setDeleteDraftJob(null)}
        onConfirm={confirmDeleteDraft}
      />

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
        hint="เก็บผลผลิตเดิมไว้"
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
