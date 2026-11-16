"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  useProductionJobs,
  emitProductionUpdated,
} from "@/features/production/hooks/use-production-data";
import { useSubmitGuard } from "@/features/production/hooks/use-submit-guard";
import { productionApi, isConflict } from "@/features/production/lib/api";
import { useTabAuth } from "@/context/TabAuthContext";
import { getAllowedActions } from "@/features/production/lib/permissions";
import { buildCreateJobInput, buildJobPatch } from "@/features/production/lib/job-form";
import AddJobModal, { type AddJobFormValue } from "@/features/production/components/AddJobModal";
import TableProductionResult from "@/features/production/components/TableProductionResult";
import { formatQty, todayYMD } from "@/features/production/components/ui";
import { M3Empty, M3Loading, m3Cls } from "@/components/ui/m3";
import { SolarAddLine, SolarBox, SolarMagnifier } from "@/components/icons";
import { PRODUCTION_JOB_STATUS_LABELS, PRODUCTION_TABLES } from "@/types/production";
import type { ProductionJob } from "@/types/production";

// ผลผลิตต่อโต๊ะ — เลือกสินค้าทางซ้าย บันทึกยอดจริงและตำแหน่งทางขวา
// เพิ่มงานใช้ AddJobModal เดิม (เลือก FG + จำนวน) โดยล็อกบริบทโต๊ะนี้

function matchesFgQuery(
  q: string,
  parts: { name?: string; sku?: string; code?: string; barcode?: string }
) {
  if (!q) return true;
  const hay = `${parts.name || ""} ${parts.sku || ""} ${parts.code || ""} ${parts.barcode || ""}`.toLowerCase();
  return hay.includes(q);
}

export default function ProductionTableConfirmPage() {
  const params = useParams();
  const raw = String(params.table_no ?? "");
  const tableNo = Number(raw);
  const valid = Number.isInteger(tableNo) && (PRODUCTION_TABLES as readonly number[]).includes(tableNo);

  const [today, setToday] = useState("");
  const [selectedJobNo, setSelectedJobNo] = useState("");
  const [resultBusy, setResultBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const guard = useSubmitGuard();
  const { user } = useTabAuth();
  const [editJob, setEditJob] = useState<ProductionJob | null>(null);

  useEffect(() => {
    setToday(todayYMD());
  }, []);

  const { jobs, loading, error, reload } = useProductionJobs(
    {
      date_from: today || undefined,
      date_to: today || undefined,
      table_no: valid ? tableNo : "ALL",
    },
    { enabled: valid && today !== "" }
  );

  const tableJobs = useMemo(
    () => (valid ? jobs.filter((j) => j.table_no === tableNo && j.status !== "CANCELLED") : []),
    [jobs, tableNo, valid]
  );

  const query = search.trim().toLowerCase();

  const filteredJobs = useMemo(
    () =>
      tableJobs.filter((j) =>
        matchesFgQuery(query, {
          name: j.product_name,
          sku: j.sku,
          code: j.job_no,
          barcode: j.barcode,
        })
      ),
    [tableJobs, query]
  );

  useEffect(() => {
    if (!filteredJobs.length) {
      setSelectedJobNo("");
      return;
    }
    if (!filteredJobs.some((j) => j.job_no === selectedJobNo)) {
      setSelectedJobNo(filteredJobs[0].job_no);
    }
  }, [filteredJobs, selectedJobNo]);

  const selected: ProductionJob | undefined = tableJobs.find((j) => j.job_no === selectedJobNo);

  const handleAdd = (value: AddJobFormValue) =>
    guard.run(async () => {
      setModalError(null);
      const payload = buildCreateJobInput({ ...value, table_no: tableNo });
      const res = await productionApi<ProductionJob[]>("/api/production/jobs", "POST", {
        jobs: [payload],
      });
      if (res.success) {
        setAddOpen(false);
        const created = Array.isArray(res.data) ? res.data[0] : undefined;
        emitProductionUpdated();
        await reload();
        if (created?.job_no) setSelectedJobNo(created.job_no);
      } else {
        setModalError(res.message);
      }
    }, "create");

  // แก้ไขงาน — AddJobModal โหมด edit + PATCH เดิมแบบหน้าวางแผน (/production)
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
        emitProductionUpdated();
        await reload();
      } else {
        setModalError(res.message);
        if (isConflict(res)) emitProductionUpdated();
      }
    }, "edit");

  if (!valid) {
    return (
      <div className="w-full max-w-full pb-10">
        <M3Empty title="ไม่พบโต๊ะนี้" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-full pb-28">
      <h1 className="mb-5 text-2xl font-bold text-m3-grey-800">โต๊ะผลิต {tableNo}</h1>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="m3-card flex min-h-0 flex-col p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-m3-grey-800">สินค้าสำเร็จรูป</p>
            <button
              type="button"
              disabled={resultBusy || guard.pending || user?.role !== "ADMIN"}
              onClick={() => {
                setModalError(null);
                setAddOpen(true);
              }}
              className="m3-btn m3-btn-sm m3-btn-dark"
            >
              <SolarAddLine size={16} />
              เพิ่ม
            </button>
          </div>
          <label className="relative mb-3 block">
            <span className="sr-only">ค้นหาสินค้าสำเร็จรูป</span>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-m3-grey-500">
              <SolarMagnifier size={18} />
            </span>
            <input
              value={search}
              disabled={resultBusy || guard.pending}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ชื่อ / SKU / รหัส"
              className={`${m3Cls.input} pl-9`}
            />
          </label>
          <div className="max-h-[65vh] overflow-y-auto">
            {loading ? (
              <M3Loading label="กำลังโหลด…" />
            ) : error ? (
              <p className="px-2 py-6 text-center text-sm text-m3-error-dark">{error}</p>
            ) : filteredJobs.length === 0 ? (
              <M3Empty title={query ? "ไม่พบสินค้า" : "ยังไม่มีสินค้า"} />
            ) : (
              filteredJobs.map((j) => (
                <div
                  key={j.job_no}
                  className={`mb-1 flex w-full items-center gap-1 rounded-lg transition-colors ${
                    j.job_no === selectedJobNo
                      ? "bg-[rgba(0,167,111,0.08)] text-m3-primary"
                      : "hover:bg-[rgba(145,158,171,0.08)]"
                  }`}
                >
                <button
                  type="button"
                  disabled={resultBusy || guard.pending}
                  aria-pressed={j.job_no === selectedJobNo}
                  onClick={() => setSelectedJobNo(j.job_no)}
                  className="min-w-0 flex-1 px-3 py-2.5 text-left"
                >
                  <div className="truncate text-sm font-semibold">{j.product_name}</div>
                  <div className="truncate text-xs text-m3-grey-500">
                    {j.sku} · {formatQty(j.target_qty)} {j.unit}
                  </div>
                  <div className="mt-1 text-xs text-m3-grey-500">{j.job_no} · {PRODUCTION_JOB_STATUS_LABELS[j.status]} · ดี {formatQty(j.produced_good)} · เสีย {formatQty(j.defect_total)}</div>
                </button>
                {getAllowedActions(j, user?.role).edit && (
                  <button
                    type="button"
                    disabled={resultBusy || guard.pending}
                    onClick={(e) => {
                      e.stopPropagation();
                      setModalError(null);
                      setEditJob(j);
                    }}
                    className="m3-btn m3-btn-sm m3-btn-text mr-1 shrink-0 text-m3-grey-600"
                  >
                    แก้ไข
                  </button>
                )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="m3-card p-4 sm:p-6">
          {!selected ? (
            <M3Empty title="เลือกสินค้าทางซ้าย" icon={<SolarBox size={28} />} />
          ) : (
            <TableProductionResult key={selected.job_no} jobNo={selected.job_no} role={user?.role} onBusyChange={setResultBusy} />
          )}
        </section>
      </div>

      <AddJobModal
        open={addOpen}
        mode="create"
        defaultTable={tableNo}
        defaultDate={today}
        hideTableDate
        submitting={guard.pending}
        error={modalError}
        onClose={() => {
          if (!guard.pending) {
            setAddOpen(false);
            setModalError(null);
          }
        }}
        onSubmit={handleAdd}
      />

      <AddJobModal
        open={!!editJob}
        mode="edit"
        job={editJob || undefined}
        hideTableDate
        submitting={guard.pending}
        error={modalError}
        onClose={() => {
          if (!guard.pending) {
            setEditJob(null);
            setModalError(null);
          }
        }}
        onSubmit={handleEdit}
      />
    </div>
  );
}
