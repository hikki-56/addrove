"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useProductionJobs,
  emitProductionUpdated,
} from "@/features/production/hooks/use-production-data";
import { productionApi } from "@/features/production/lib/api";
import { formatQty, todayYMD } from "@/features/production/components/ui";
import { M3Banner, M3Empty, M3Loading, m3Cls } from "@/components/ui/m3";
import { SolarBox, SolarCheckCircle, SolarMagnifier } from "@/components/icons";
import { PRODUCTION_TABLES } from "@/types/production";
import type { ProductionJob } from "@/types/production";
import type { ProductionCapacity } from "@/types/production-bom";
import type { Product } from "@/types/models";

// ยืนยันวัตถุดิบต่อโต๊ะ — ซ้ายสินค้าสำเร็จรูป / ขวาวัตถุดิบที่ใช้ (เลย์เอาต์แบบ /production/formula)

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
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [capacities, setCapacities] = useState<Record<string, ProductionCapacity>>({});
  const [catalogError, setCatalogError] = useState("");
  const [addingId, setAddingId] = useState("");
  const [addError, setAddError] = useState("");

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

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    setCatalogError("");
    Promise.all([
      fetch("/api/products?active=true&master_only=true", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/production/capacities", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([json, bomJson]) => {
        if (cancelled) return;
        if (!json.success || !bomJson.success) throw new Error("โหลดสินค้าไม่สำเร็จ");
        const list = Array.isArray(json.data)
          ? json.data
          : Array.isArray(json.data?.items)
            ? json.data.items
            : null;
        if (!list || !Array.isArray(bomJson.data)) throw new Error("ข้อมูลสินค้าไม่ถูกต้อง");
        const rows = bomJson.data as ProductionCapacity[];
        const formulaProducts = new Set(rows.map((f) => f.product_id));
        setCapacities(Object.fromEntries(rows.map((c) => [c.product_id, c])));
        setCatalog((list as Product[]).filter((p) => formulaProducts.has(p.product_id)));
      })
      .catch((e) => {
        if (!cancelled) setCatalogError(e instanceof Error ? e.message : "โหลดสินค้าไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [valid]);

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

  const onTableProductIds = useMemo(() => new Set(tableJobs.map((j) => j.product_id)), [tableJobs]);

  const addableProducts = useMemo(() => {
    if (!query) return [];
    return catalog.filter(
      (p) =>
        !onTableProductIds.has(p.product_id) &&
        matchesFgQuery(query, {
          name: p.product_name,
          sku: p.sku,
          code: p.product_id,
          barcode: p.barcode,
        })
    );
  }, [catalog, onTableProductIds, query]);

  useEffect(() => {
    if (!filteredJobs.length) {
      if (!addableProducts.length) setSelectedJobNo("");
      return;
    }
    if (!filteredJobs.some((j) => j.job_no === selectedJobNo)) {
      setSelectedJobNo(filteredJobs[0].job_no);
    }
  }, [filteredJobs, addableProducts.length, selectedJobNo]);

  const selected: ProductionJob | undefined = tableJobs.find((j) => j.job_no === selectedJobNo);
  const materials = selected?.material_plan?.snapshot.items ?? [];

  const addToTable = useCallback(
    async (p: Product) => {
      if (!today || addingId) return;
      setAddingId(p.product_id);
      setAddError("");
      const cap = capacities[p.product_id];
      const target = cap?.quantity != null && cap.quantity > 0 ? cap.quantity : 1;
      const res = await productionApi<ProductionJob[]>("/api/production/jobs", "POST", {
        jobs: [
          {
            production_date: today,
            table_no: tableNo,
            product_id: p.product_id,
            target_qty: target,
            priority: "NORMAL",
            note: "",
            location: "",
            ...(cap?.bom_id ? { bom: { bom_id: cap.bom_id } } : {}),
          },
        ],
      });
      if (res.success) {
        const created = Array.isArray(res.data) ? res.data[0] : undefined;
        emitProductionUpdated();
        await reload();
        if (created?.job_no) setSelectedJobNo(created.job_no);
        setSearch("");
      } else {
        setAddError(res.message || "เพิ่มไม่สำเร็จ");
      }
      setAddingId("");
    },
    [addingId, capacities, reload, tableNo, today]
  );

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
      {addError && (
        <M3Banner tone="error" className="mb-4" role="alert">
          {addError}
        </M3Banner>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="m3-card flex min-h-0 flex-col p-4">
          <p className="mb-2 text-sm font-bold text-m3-grey-800">สินค้าสำเร็จรูป</p>
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
            ) : filteredJobs.length === 0 && addableProducts.length === 0 ? (
              <M3Empty
                title={
                  query
                    ? catalogError || "ไม่พบสินค้า"
                    : "ยังไม่มีสินค้า — ค้นหาเพื่อเพิ่ม"
                }
              />
            ) : (
              <>
                {filteredJobs.map((j) => (
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
                ))}
                {addableProducts.map((p) => (
                  <button
                    key={p.product_id}
                    type="button"
                    disabled={!!addingId}
                    onClick={() => void addToTable(p)}
                    className="mb-1 w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[rgba(145,158,171,0.08)] disabled:opacity-60"
                  >
                    <div className="truncate text-sm font-semibold text-m3-grey-800">{p.product_name}</div>
                    <div className="truncate text-xs text-m3-primary">
                      {p.sku} · {addingId === p.product_id ? "กำลังเพิ่ม…" : "แตะเพื่อเพิ่มเข้าโต๊ะ"}
                    </div>
                  </button>
                ))}
              </>
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
    </div>
  );
}
