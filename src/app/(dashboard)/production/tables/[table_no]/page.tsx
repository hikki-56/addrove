"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useProductionJobs,
  emitProductionUpdated,
} from "@/features/production/hooks/use-production-data";
import { useSubmitGuard } from "@/features/production/hooks/use-submit-guard";
import { productionApi } from "@/features/production/lib/api";
import { buildCreateJobInput } from "@/features/production/lib/job-form";
import AddJobModal, { type AddJobFormValue } from "@/features/production/components/AddJobModal";
import { formatQty, todayYMD } from "@/features/production/components/ui";
import { M3Banner, M3Empty, M3Loading, m3Cls } from "@/components/ui/m3";
import { SolarAddLine, SolarBox, SolarCheckCircle, SolarMagnifier } from "@/components/icons";
import { PRODUCTION_TABLES } from "@/types/production";
import type { ProductionJob } from "@/types/production";

// ยืนยันวัตถุดิบต่อโต๊ะ — ซ้ายสินค้าสำเร็จรูป / ขวาวัตถุดิบที่ใช้ (เลย์เอาต์แบบ /production/formula)
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
  const router = useRouter();
  const raw = String(params.table_no ?? "");
  const tableNo = Number(raw);
  const valid = Number.isInteger(tableNo) && (PRODUCTION_TABLES as readonly number[]).includes(tableNo);

  const [today, setToday] = useState("");
  const [selectedJobNo, setSelectedJobNo] = useState("");
  const [success, setSuccess] = useState(false);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const guard = useSubmitGuard();

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
  const materials = selected?.material_plan?.snapshot.items ?? [];

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

  const handleConfirm = () => {
    if (success) return;
    setSuccess(true);
    window.setTimeout(() => {
      router.push("/production");
    }, 900);
  };

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

      {success && (
        <M3Banner tone="success" className="mb-4" role="status">
          ยืนยันแล้ว
        </M3Banner>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="m3-card flex min-h-0 flex-col p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-m3-grey-800">สินค้าสำเร็จรูป</p>
            <button
              type="button"
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
                <button
                  key={j.job_no}
                  type="button"
                  onClick={() => setSelectedJobNo(j.job_no)}
                  className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                    j.job_no === selectedJobNo
                      ? "bg-[rgba(0,167,111,0.08)] text-m3-primary"
                      : "hover:bg-[rgba(145,158,171,0.08)]"
                  }`}
                >
                  <div className="truncate text-sm font-semibold">{j.product_name}</div>
                  <div className="truncate text-xs text-m3-grey-500">
                    {j.sku} · {formatQty(j.target_qty)} {j.unit}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="m3-card p-4 sm:p-6">
          <p className="mb-3 text-sm font-bold text-m3-grey-800">วัตถุดิบที่ใช้</p>
          {!selected ? (
            <M3Empty title="เลือกสินค้าทางซ้าย" icon={<SolarBox size={28} />} />
          ) : materials.length === 0 ? (
            <M3Empty title="ยังไม่มีวัตถุดิบ" icon={<SolarBox size={28} />} />
          ) : (
            <ul className="space-y-2">
              {materials.map((item) => (
                <li
                  key={item.item_id}
                  className="rounded-lg border border-[rgba(145,158,171,0.2)] px-3 py-2.5"
                >
                  <div className="text-sm font-semibold text-m3-grey-800">{item.name || item.sku}</div>
                  <div className="mt-0.5 text-xs text-m3-grey-500">
                    {item.sku}
                    {item.qty != null ? ` · ${formatQty(item.qty)} ${item.unit || item.stock_unit || ""}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3 sm:px-4">
        <div className="pointer-events-auto w-full max-w-3xl">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={success}
            className="m3-btn m3-btn-dark h-12 w-full disabled:opacity-60"
          >
            <SolarCheckCircle size={20} />
            ยืนยัน
          </button>
        </div>
      </div>

      <AddJobModal
        open={addOpen}
        mode="create"
        defaultTable={tableNo}
        defaultDate={today}
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
    </div>
  );
}
