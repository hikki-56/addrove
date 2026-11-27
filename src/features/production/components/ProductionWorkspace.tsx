"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import { useProductionJobs, emitProductionUpdated, PRODUCTION_POLL_MS } from "@/features/production/hooks/use-production-data";
import { useSubmitGuard } from "@/features/production/hooks/use-submit-guard";
import { productionApi, isConflict } from "@/features/production/lib/api";
import { getAllowedActions } from "@/features/production/lib/permissions";
import { productionTableHref } from "@/features/production/lib/table-navigation";
import { buildCreateJobInput, buildJobPatch } from "@/features/production/lib/job-form";
import type { ProductionJob } from "@/types/production";
import { PRODUCTION_TABLES, PRODUCTION_JOB_STATUS_LABELS } from "@/types/production";
import { M3Banner, M3Empty, M3ErrorBanner, M3Loading, M3NumberTile, m3Cls } from "@/components/ui/m3";
import AddJobModal, { type AddJobFormValue } from "./AddJobModal";
import { ConfirmModal, ReasonModal } from "./ActionModals";
import ProductionJobDialog from "./ProductionJobDialog";
import ProductionPrintButton from "./ProductionPrintButton";
import { StatusBadge, formatQty, todayYMD } from "./ui";

type Confirmation = { kind: "start" | "submit" | "delete"; jobs: ProductionJob[] };
const order = { IN_PROGRESS: 0, WAITING: 1, DRAFT: 2, COMPLETED: 3, CANCELLED: 4 };
const isHistory = (job: ProductionJob) => job.status === "COMPLETED" || job.status === "CANCELLED";

export default function ProductionWorkspace() {
  const { user } = useTabAuth();
  const admin = user?.role === "ADMIN";
  const operator = admin || user?.role === "APPROVER";
  const { jobs, loading, error, reload } = useProductionJobs();
  usePollingWhenVisible(useCallback((initial?: boolean) => { if (!initial) reload(); }, [reload]), PRODUCTION_POLL_MS);
  const [view, setView] = useState<"WORK" | "HISTORY">("WORK");
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [table, setTable] = useState<number | "ALL">("ALL");
  const [status, setStatus] = useState("ALL");
  const [add, setAdd] = useState<{ table: number; date: string } | null>(null);
  const [edit, setEdit] = useState<ProductionJob | null>(null);
  const [cancel, setCancel] = useState<ProductionJob | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [dialogJob, setDialogJob] = useState<string | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const guard = useSubmitGuard();
  const busy = guard.pending || dialogBusy;
  const counts = { WORK: jobs.filter(j => !isHistory(j)).length, HISTORY: jobs.filter(isHistory).length };
  const visible = useMemo(() => jobs.filter(j =>
    (view === "HISTORY" ? isHistory(j) : !isHistory(j)) && (!date || j.production_date === date)
    && (table === "ALL" || j.table_no === table) && (status === "ALL" || j.status === status)
    && `${j.product_name} ${j.sku} ${j.job_no} ${j.barcode}`.toLowerCase().includes(query.trim().toLowerCase())
  ).sort((a, b) => order[a.status] - order[b.status] || b.production_date.localeCompare(a.production_date)), [jobs, view, date, table, status, query]);
  const groups = useMemo(() => {
    const rows = new Map<string, { table: number; date: string; jobs: ProductionJob[] }>();
    for (const job of visible) {
      const key = `${job.table_no}:${job.production_date}`;
      if (!rows.has(key)) rows.set(key, { table: job.table_no, date: job.production_date, jobs: [] });
      rows.get(key)!.jobs.push(job);
    }
    if (view === "WORK" && !query && status === "ALL") for (const t of PRODUCTION_TABLES) {
      if ((table === "ALL" || t === table) && ![...rows.values()].some(row => row.table === t)) rows.set(`${t}:empty`, { table: t, date: date || todayYMD(), jobs: [] });
    }
    return [...rows.values()];
  }, [visible, view, query, status, table, date]);
  const selectedDrafts = visible.filter(j => j.status === "DRAFT" && selected.has(j.job_no));
  const refresh = async (text: string) => { setMessage(text); emitProductionUpdated(); await reload(); };
  const openConfirmation = (kind: Confirmation["kind"], items: ProductionJob[]) => { setActionError(null); setConfirmation({ kind, jobs: items }); };
  const confirm = () => guard.run(async () => {
    if (!confirmation) return;
    setActionError(null);
    const pending = confirmation.jobs;
    if (confirmation.kind === "start") {
      for (const [index, job] of pending.entries()) {
        const endpoint = `/api/production/jobs/${encodeURIComponent(job.job_no)}`;
        const response = await productionApi(`${endpoint}/start`, "POST");
        let started = response.success;
        if (!started && (response.status === 0 || isConflict(response) || response.status >= 500)) {
          const current = await productionApi<{ job: ProductionJob }>(endpoint);
          started = current.success && current.data?.job.status === "IN_PROGRESS";
        }
        if (!started) { setConfirmation({ kind: "start", jobs: pending.slice(index) }); setActionError(response.message); emitProductionUpdated(); await reload(); return; }
      }
      setConfirmation(null); await refresh("เริ่มผลิตแล้ว");
    } else {
      const response = confirmation.kind === "submit"
        ? await productionApi("/api/production/jobs/submit", "POST", { job_nos: pending.map(j => j.job_no) })
        : await productionApi(`/api/production/jobs/${encodeURIComponent(pending[0].job_no)}`, "DELETE");
      if (!response.success) { setActionError(response.message); if (isConflict(response)) { emitProductionUpdated(); await reload(); } return; }
      setSelected(new Set()); setConfirmation(null); await refresh(confirmation.kind === "submit" ? "ส่งผลิตแล้ว" : "ลบงานแล้ว");
    }
  }, "confirm");
  const saveJob = (value: AddJobFormValue) => guard.run(async () => {
    setActionError(null);
    const response = edit ? await productionApi(`/api/production/jobs/${encodeURIComponent(edit.job_no)}`, "PATCH", buildJobPatch(edit, value))
      : await productionApi("/api/production/jobs", "POST", { jobs: [buildCreateJobInput(value)] });
    if (!response.success) { setActionError(response.message); if (isConflict(response)) emitProductionUpdated(); return; }
    setAdd(null); setEdit(null); setView("WORK"); setDate(""); setStatus("ALL"); setQuery(""); setTable("ALL");
    await refresh(edit ? "แก้ไขแล้ว" : "เพิ่มงานแล้ว");
  }, "save-job");
  const cancelJob = (reason: string) => guard.run(async () => {
    if (!cancel) return;
    setActionError(null);
    const response = await productionApi(`/api/production/jobs/${encodeURIComponent(cancel.job_no)}/cancel`, "POST", { reason });
    if (!response.success) { setActionError(response.message); if (isConflict(response)) emitProductionUpdated(); return; }
    setCancel(null); await refresh("ยกเลิกงานแล้ว");
  }, "cancel");
  return <div className="space-y-4 pb-24">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-2" aria-label="รายการงานผลิต">
        {([{ id: "WORK", label: "งานที่ต้องทำ" }, { id: "HISTORY", label: "ประวัติ" }] as const).map(tab => <button key={tab.id} type="button" disabled={busy} aria-pressed={view === tab.id}
          onClick={() => { setView(tab.id); setStatus("ALL"); setDate(""); setSelected(new Set()); }} className={`m3-btn h-11 ${view === tab.id ? "m3-btn-dark" : "m3-btn-outline"}`}>{tab.label} <span className="text-xs opacity-70">{counts[tab.id]}</span></button>)}
      </div>
      {admin && <button type="button" disabled={busy} onClick={() => { setActionError(null); setAdd({ table: typeof table === "number" ? table : 1, date: date || todayYMD() }); }} className="m3-btn m3-btn-primary h-11">+ เพิ่มงานผลิต</button>}
    </div>
    <input aria-label="ค้นหางานผลิต" placeholder="ค้นหาสินค้า / SKU / เลขงาน" value={query} disabled={busy} onChange={e => setQuery(e.target.value)} className={`h-11 ${m3Cls.input}`} />
    <details className="text-sm text-m3-grey-600"><summary className="w-fit cursor-pointer">ตัวเลือกเพิ่มเติม{date || table !== "ALL" || status !== "ALL" ? " · มีตัวกรอง" : ""}</summary>
      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl bg-white p-3">
        <label className="text-xs">วันที่<input aria-label="กรองวันที่ผลิต" type="date" value={date} disabled={busy} onChange={e => setDate(e.target.value)} className={`mt-1 block ${m3Cls.input}`} /></label>
        <label className="text-xs">โต๊ะ<select aria-label="กรองโต๊ะผลิต" value={table} disabled={busy} onChange={e => setTable(e.target.value === "ALL" ? "ALL" : Number(e.target.value))} className={`mt-1 block ${m3Cls.input}`}><option value="ALL">ทุกโต๊ะ</option>{PRODUCTION_TABLES.map(t => <option key={t} value={t}>โต๊ะ {t}</option>)}</select></label>
        <label className="text-xs">สถานะ<select aria-label="กรองสถานะงานผลิต" value={status} disabled={busy} onChange={e => setStatus(e.target.value)} className={`mt-1 block ${m3Cls.input}`}><option value="ALL">ทั้งหมด</option>{Object.entries(PRODUCTION_JOB_STATUS_LABELS).filter(([s]) => view === "HISTORY" ? ["COMPLETED", "CANCELLED"].includes(s) : !["COMPLETED", "CANCELLED"].includes(s)).map(([s, label]) => <option key={s} value={s}>{label}</option>)}</select></label>
        <button type="button" disabled={busy} onClick={() => { setDate(""); setTable("ALL"); setStatus("ALL"); setQuery(""); }} className="m3-btn m3-btn-text">ล้างตัวกรอง</button>
        {admin && view === "WORK" && <button type="button" disabled={busy} aria-pressed={selecting} onClick={() => { setSelecting(v => !v); setSelected(new Set()); }} className="m3-btn m3-btn-outline">เลือกหลายงาน</button>}
        {operator && <ProductionPrintButton jobs={visible} disabled={loading || busy} />}<Link href="/production/summary" className="m3-btn m3-btn-text">สรุปผลผลิต</Link>
      </div>
    </details>
    {message && <M3Banner tone="success" role="status">{message}</M3Banner>}
    {error && <M3ErrorBanner message={error} action={<button type="button" onClick={() => reload()} className="m3-btn m3-btn-text">ลองใหม่</button>} />}
    {loading ? <M3Loading label="กำลังโหลดงาน…" /> : !groups.length ? <M3Empty title={view === "HISTORY" ? "ยังไม่มีประวัติ" : "ไม่พบงานผลิต"} /> : <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map(group => {
        const waiting = group.jobs.filter(j => j.status === "WAITING"), drafts = group.jobs.filter(j => j.status === "DRAFT");
        return <section key={`${group.table}:${group.date}`} aria-label={`โต๊ะ ${group.table} วันที่ ${group.date}`} className="m3-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-4">
            <M3NumberTile>{group.table}</M3NumberTile><div className="flex-1"><h2 className="font-bold">โต๊ะ {group.table}</h2><p className="text-xs text-m3-grey-500">{group.date}</p></div>
            {operator && !!waiting.length && <button type="button" aria-label={`เริ่มผลิตโต๊ะ ${group.table} วันที่ ${group.date}`} disabled={busy} onClick={() => openConfirmation("start", waiting)} className="m3-btn m3-btn-sm m3-btn-dark">เริ่มผลิต</button>}
            {admin && view === "WORK" && <button type="button" aria-label={`เพิ่มงานโต๊ะ ${group.table} วันที่ ${group.date}`} disabled={busy} onClick={() => { setActionError(null); setAdd({ table: group.table, date: group.date }); }} className="m3-btn m3-btn-sm m3-btn-outline">+ เพิ่ม</button>}
          </div>
          {!group.jobs.length ? <p className="px-4 pb-5 text-sm text-m3-grey-500">ยังไม่มีงาน</p> : <div className="divide-y divide-[rgba(145,158,171,0.16)] border-t border-[rgba(145,158,171,0.16)]">
            {group.jobs.map(job => {
              const actions = getAllowedActions(job, user?.role);
              return <article key={job.job_no} aria-label={`${job.sku} ${job.job_no}`} className="space-y-3 p-4">
                <div className="flex items-start gap-2">
                  {selecting && actions.submit && <input type="checkbox" aria-label={`เลือก ${job.job_no}`} checked={selected.has(job.job_no)} disabled={busy} onChange={() => setSelected(previous => { const next = new Set(previous); if (next.has(job.job_no)) next.delete(job.job_no); else next.add(job.job_no); return next; })} className="mt-1 size-4 accent-m3-primary" />}
                  <button type="button" disabled={busy} onClick={() => setDialogJob(job.job_no)} className="min-w-0 flex-1 text-left"><p className="text-sm font-semibold">{job.product_name}</p><p className="mt-1 text-xs text-m3-grey-500">{job.sku} · เป้า {formatQty(job.target_qty)} {job.unit}</p></button><StatusBadge status={job.status} />
                </div>
                {job.priority !== "NORMAL" && <p className="text-xs font-semibold text-m3-error-dark">{job.priority === "CRITICAL" ? "ด่วนมาก" : "ด่วน"}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  {actions.submit ? <button type="button" disabled={busy} onClick={() => openConfirmation("submit", [job])} className="m3-btn m3-btn-sm m3-btn-primary">ส่งผลิต</button>
                    : job.status === "WAITING" && operator ? <button type="button" disabled={busy} onClick={() => openConfirmation("start", [job])} className="m3-btn m3-btn-sm m3-btn-primary">เริ่มผลิต</button>
                    : <button type="button" disabled={busy} onClick={() => setDialogJob(job.job_no)} className={`m3-btn m3-btn-sm ${job.status === "IN_PROGRESS" && operator ? "m3-btn-primary" : "m3-btn-outline"}`}>{job.status === "IN_PROGRESS" && operator ? "บันทึกผล" : "ดูรายละเอียด"}</button>}
                  {actions.edit && <button type="button" disabled={busy} onClick={() => { setActionError(null); setEdit(job); }} className="m3-btn m3-btn-sm m3-btn-outline">แก้ไข</button>}
                  <details className="relative ml-auto text-xs text-m3-grey-500"><summary className="cursor-pointer px-2 py-2" aria-label={`เมนูเพิ่มเติม ${job.job_no}`}>เพิ่มเติม</summary><div className="mt-1 flex flex-wrap gap-2">
                    <Link href={`/production/jobs/${encodeURIComponent(job.job_no)}`} className="m3-btn m3-btn-sm m3-btn-text">ประวัติ / จัดการ</Link>
                    {actions.deleteDraft && <button type="button" disabled={busy} onClick={() => openConfirmation("delete", [job])} className="m3-btn m3-btn-sm m3-btn-text text-m3-error-dark">ลบงาน</button>}
                    {actions.cancel && !actions.deleteDraft && <button type="button" disabled={busy} onClick={() => { setActionError(null); setCancel(job); }} className="m3-btn m3-btn-sm m3-btn-text text-m3-error-dark">ยกเลิกงาน</button>}
                  </div></details>
                </div>
              </article>;
            })}
          </div>}
          {!!group.jobs.length && <div className="flex flex-wrap gap-2 border-t border-[rgba(145,158,171,0.16)] p-3"><Link href={productionTableHref(group.table, group.jobs, group.date)} className="m3-btn m3-btn-sm m3-btn-text">เปิดโต๊ะ</Link>
            {admin && drafts.length > 1 && <button type="button" disabled={busy} onClick={() => openConfirmation("submit", drafts)} className="m3-btn m3-btn-sm m3-btn-outline ml-auto">ส่งผลิตทั้งโต๊ะ</button>}
          </div>}
        </section>;
      })}
    </div>}
    {!!selectedDrafts.length && <div className="sticky bottom-3 z-30 flex items-center justify-between gap-3 rounded-xl bg-m3-grey-800 p-3 text-white"><span className="text-sm">เลือก {selectedDrafts.length} งาน</span><button type="button" disabled={busy} onClick={() => openConfirmation("submit", selectedDrafts)} className="m3-btn bg-white text-m3-grey-800">ส่งผลิต</button></div>}
    <ConfirmModal open={!!confirmation} title={confirmation?.kind === "start" ? "เริ่มผลิต?" : confirmation?.kind === "submit" ? "ส่งผลิต?" : "ลบงาน?"} confirmLabel={confirmation?.kind === "start" ? "เริ่มผลิต" : confirmation?.kind === "submit" ? "ส่งผลิต" : "ลบงาน"} tone={confirmation?.kind === "delete" ? "danger" : "primary"} submitting={guard.pending} error={actionError} onClose={() => setConfirmation(null)} onConfirm={confirm}>
      <ul className="space-y-2">{confirmation?.jobs.map(job => <li key={job.job_no} className="rounded-lg bg-m3-grey-100 p-3"><p className="text-sm font-semibold">{job.product_name} · {formatQty(job.target_qty)} {job.unit}</p><p className="mt-1 text-xs text-m3-grey-500">โต๊ะ {job.table_no} · {job.production_date}</p></li>)}</ul>
    </ConfirmModal>
    <AddJobModal open={!!add || !!edit} mode={edit ? "edit" : "create"} job={edit || undefined} defaultTable={add?.table || 1} defaultDate={add?.date || todayYMD()} submitting={guard.pending} error={actionError} onClose={() => { setAdd(null); setEdit(null); setActionError(null); }} onSubmit={saveJob} />
    <ReasonModal open={!!cancel} title="ยกเลิกงาน" hint={cancel?.product_name || ""} reasonLabel="เหตุผล" confirmLabel="ยกเลิกงาน" tone="danger" submitting={guard.pending} error={actionError} onClose={() => setCancel(null)} onSubmit={cancelJob} />
    {dialogJob && <ProductionJobDialog key={dialogJob} jobNo={dialogJob} role={user?.role} onClose={() => { setDialogJob(null); setDialogBusy(false); }} onBusyChange={setDialogBusy} />}
  </div>;
}
