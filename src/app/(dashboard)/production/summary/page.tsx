"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import { useProductionJobs, PRODUCTION_POLL_MS } from "@/features/production/hooks/use-production-data";
import { formatQty } from "@/features/production/components/ui";
import {
  M3Empty,
  M3ErrorBanner,
  M3Field,
  M3IconCircle,
  M3Loading,
  M3NumberTile,
  m3Cls,
  type M3IconTone,
} from "@/components/ui/m3";
import {
  SolarArrowUp,
  SolarCalendarPlan,
  SolarChartBars,
  SolarCheckCircle,
  SolarClockCircle,
  SolarCloseCircle,
  SolarDangerCircle,
  SolarDangerTriangle,
  SolarFactory,
  SolarMagnifier,
} from "@/components/icons";
import type { ProductionJob } from "@/types/production";
import { PRODUCTION_JOB_STATUS_LABELS, PRODUCTION_TABLES } from "@/types/production";

// หน้าสรุปผลผลิตสำหรับ ADMIN (§8) — แยกตามสินค้า × โต๊ะ พร้อมหน่วยชัดเจน (ไม่รวมข้ามหน่วย)
// เน้น: งานจบต่ำกว่าเป้า / ผลิตเกิน / มีของเสีย · กรองช่วงวันที่ โต๊ะ สินค้า สถานะ

interface SummaryRow {
  key: string;
  sku: string;
  product_name: string;
  unit: string;
  table_no: number;
  jobs: ProductionJob[];
  target: number;
  produced: number;
  defect: number;
  remaining: number;
  over: number;
  hasDefect: boolean;
  underClosed: boolean;
  overProduced: boolean;
}

export default function ProductionSummaryPage() {
  const { user } = useTabAuth();
  const isAdmin = user?.role === "ADMIN";

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [tableFilter, setTableFilter] = useState<number | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [datesReady, setDatesReady] = useState(false);

  useEffect(() => {
    const now = new Date();
    const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const today = bangkok.toISOString().slice(0, 10);
    const weekAgo = new Date(bangkok.getTime() - 6 * 86400000).toISOString().slice(0, 10);
    setDateFrom(weekAgo);
    setDateTo(today);
    setDatesReady(true);
  }, []);

  // ส่งช่วงวันที่/โต๊ะ/สถานะให้เซิร์ฟเวอร์กรอง (รอค่าเริ่มต้น 7 วันล่าสุดก่อน) · กรองซ้ำฝั่ง client เสมอ
  const { jobs, loading, error, reload } = useProductionJobs(
    {
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      table_no: tableFilter,
      status: statusFilter,
    },
    { enabled: isAdmin && datesReady }
  );

  // อัปเดตอัตโนมัติทุก 30 วิขณะแท็บมองเห็น (หยุดเมื่อซ่อนแท็บ · กลับมาแล้วโหลดทันที)
  usePollingWhenVisible(
    useCallback(
      (initial?: boolean) => {
        if (!initial && isAdmin) reload();
      },
      [isAdmin, reload]
    ),
    PRODUCTION_POLL_MS
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (j.status === "DRAFT") return false; // ฉบับร่างยังไม่เข้าสรุปผล
      if (dateFrom && j.production_date < dateFrom) return false;
      if (dateTo && j.production_date > dateTo) return false;
      if (tableFilter !== "ALL" && j.table_no !== tableFilter) return false;
      if (statusFilter !== "ALL" && j.status !== statusFilter) return false;
      if (query && !`${j.sku} ${j.product_name} ${j.job_no}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [jobs, dateFrom, dateTo, tableFilter, statusFilter, q]);

  // รวมยอดรายการ: สินค้า × โต๊ะ (หนึ่งสินค้าหลายงาน/หลายรอบในโต๊ะเดียว = หนึ่งแถว)
  const rows = useMemo<SummaryRow[]>(() => {
    const map = new Map<string, SummaryRow>();
    for (const j of filtered) {
      const key = `${j.sku}::${j.table_no}`;
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          sku: j.sku,
          product_name: j.product_name,
          unit: j.unit,
          table_no: j.table_no,
          jobs: [],
          target: 0,
          produced: 0,
          defect: 0,
          remaining: 0,
          over: 0,
          hasDefect: false,
          underClosed: false,
          overProduced: false,
        };
        map.set(key, row);
      }
      row.jobs.push(j);
      row.target += j.target_qty;
      row.produced += j.produced_good;
      row.defect += j.defect_total;
      if (j.defect_total > 0) row.hasDefect = true;
      if (j.status === "COMPLETED" && j.remaining_qty > 0) row.underClosed = true;
      if (j.over_qty > 0) row.overProduced = true;
    }
    const list = Array.from(map.values());
    for (const r of list) {
      r.remaining = Math.max(0, Math.round((r.target - r.produced) * 100) / 100);
      r.over = Math.max(0, Math.round((r.produced - r.target) * 100) / 100);
    }
    list.sort((a, b) => {
      const warn = (x: SummaryRow) => (x.underClosed ? 0 : x.overProduced ? 1 : x.hasDefect ? 2 : 3);
      const d = warn(a) - warn(b);
      if (d !== 0) return d;
      if (a.product_name !== b.product_name) return a.product_name < b.product_name ? -1 : 1;
      return a.table_no - b.table_no;
    });
    return list;
  }, [filtered]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of filtered) c[j.status] = (c[j.status] || 0) + 1;
    return c;
  }, [filtered]);

  // KPI รวม (D35) — รวมยอดเฉพาะเมื่อทุกแถวใช้หน่วยเดียวกัน (ไม่รวมข้ามหน่วย)
  const kpi = useMemo(() => {
    const units = Array.from(new Set(rows.map((r) => r.unit)));
    const sum = (f: (r: SummaryRow) => number) => rows.reduce((acc, r) => acc + f(r), 0);
    return {
      unit: units.length === 1 ? units[0] : null,
      produced: sum((r) => r.produced),
      defect: sum((r) => r.defect),
      remaining: sum((r) => r.remaining),
      over: sum((r) => r.over),
      jobs: filtered.length,
      under: filtered.filter((j) => j.status === "COMPLETED" && j.remaining_qty > 0).length,
    };
  }, [rows, filtered]);

  if (!isAdmin) {
    return (
      <div className="w-full max-w-full pb-8">
        <h1 className="sr-only">สรุปผลผลิต</h1>
        <div className="m3-card flex flex-col items-center px-6 py-16 text-center">
          <M3IconCircle tone="error">
            <SolarDangerCircle size={26} />
          </M3IconCircle>
          <h2 className="mt-4 text-base font-bold text-m3-grey-800">เฉพาะผู้ดูแลระบบ (Admin)</h2>
        </div>
      </div>
    );
  }

  const kpiCards: { label: string; value: string; unit: string; icon: ReactNode; tone: M3IconTone; valueCls: string }[] = [
    { label: "ผลิตดี", value: kpi.unit ? formatQty(kpi.produced) : "—", unit: kpi.unit ?? "หลายหน่วย", icon: <SolarCheckCircle size={22} />, tone: "primary", valueCls: "text-m3-primary-dark" },
    { label: "ของเสีย", value: kpi.unit ? formatQty(kpi.defect) : "—", unit: kpi.unit ?? "หลายหน่วย", icon: <SolarCloseCircle size={22} />, tone: "error", valueCls: "text-m3-error-dark" },
    { label: "ยังขาด", value: kpi.unit ? formatQty(kpi.remaining) : "—", unit: kpi.unit ?? "หลายหน่วย", icon: <SolarClockCircle size={22} />, tone: "warning", valueCls: "text-m3-warning-dark" },
    { label: "ผลิตเกิน", value: kpi.unit ? formatQty(kpi.over) : "—", unit: kpi.unit ?? "หลายหน่วย", icon: <SolarArrowUp size={22} />, tone: "info", valueCls: "text-m3-info-dark" },
    { label: "งาน", value: formatQty(kpi.jobs), unit: "งาน", icon: <SolarFactory size={22} />, tone: "grey", valueCls: "text-m3-grey-800" },
    { label: "จบต่ำกว่าเป้า", value: formatQty(kpi.under), unit: "งาน", icon: <SolarDangerTriangle size={22} />, tone: "error", valueCls: "text-m3-error-dark" },
  ];

  return (
    <div className="w-full max-w-full pb-10">
      <h1 className="sr-only">สรุปผลผลิต</h1>
      <div className="mb-5 flex flex-wrap items-center justify-end gap-3 sm:mb-6">
        <Link href="/production" className="m3-btn m3-btn-outline">
          <SolarCalendarPlan size={18} />
          ไปหน้าวางแผนผลิต
        </Link>
      </div>

      {/* ตัวกรอง */}
      <div className="m3-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[150px_150px_150px_150px_minmax(0,1fr)]">
          <M3Field label="จากวันที่">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`h-12 ${m3Cls.input}`} />
          </M3Field>
          <M3Field label="ถึงวันที่">
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`h-12 ${m3Cls.input}`} />
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
              {(["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map((s) => (
                <option key={s} value={s}>{PRODUCTION_JOB_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </M3Field>
          <label className="relative block sm:col-span-2 lg:col-span-1">
            <span className="sr-only">สินค้า</span>
            <SolarMagnifier size={20} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-m3-grey-500" />
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU / ชื่อสินค้า" className={`h-12 pl-11 ${m3Cls.input}`} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="จำนวนงานตามสถานะ">
          {(["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map((s) => (
            <span
              key={s}
              className={`m3-label h-7 px-2.5 text-[13px] ${
                s === "WAITING" ? "m3-label-warning" : s === "IN_PROGRESS" ? "m3-label-info" : s === "COMPLETED" ? "m3-label-success" : "m3-label-default"
              }`}
            >
              {PRODUCTION_JOB_STATUS_LABELS[s]} {statusCounts[s] || 0}
            </span>
          ))}
        </div>
      </div>

      {/* KPI รวม */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        {kpiCards.map((k) => (
          <div key={k.label} className="m3-card flex items-center gap-3 p-4">
            <span className="hidden sm:inline-flex">
              <M3IconCircle tone={k.tone}>{k.icon}</M3IconCircle>
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs text-m3-grey-600">{k.label}</div>
              <div className="mt-0.5 truncate">
                <b className={`font-m3-disp text-xl font-bold tabular-nums ${k.valueCls}`}>{k.value}</b>{" "}
                <span className="text-xs text-m3-grey-600">{k.unit}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && !loading && (
        <div className="mt-5">
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

      {loading ? (
        <div className="mt-5">
          <M3Loading label="กำลังสรุปยอด..." />
        </div>
      ) : rows.length === 0 ? (
        <div className="m3-card mt-5 p-6">
          <M3Empty title="ไม่มีข้อมูลผลผลิตในช่วงที่เลือก" icon={<SolarChartBars size={40} />} />
        </div>
      ) : (
        <div className="m3-card mt-5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="m3-table w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr>
                  <th>สินค้า</th>
                  <th className="text-center">โต๊ะ</th>
                  <th>งาน</th>
                  <th>หน่วย</th>
                  <th className="m3-num">เป้าหมาย</th>
                  <th className="m3-num">ผลิตดี</th>
                  <th>% เป้า</th>
                  <th className="m3-num">ของเสีย</th>
                  <th className="m3-num">ยังขาด</th>
                  <th className="m3-num">เกินเป้า</th>
                  <th>สัญญาณ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pct = r.target > 0 ? Math.round((r.produced / r.target) * 100) : 0;
                  const barCls = pct >= 100 ? "bg-m3-primary" : pct >= 80 ? "bg-m3-warning" : pct > 0 ? "bg-m3-error" : "bg-transparent";
                  return (
                    <tr key={r.key}>
                      <td>
                        <div className="font-semibold">{r.product_name}</div>
                        <div className="text-xs tabular-nums text-m3-grey-500">{r.sku}</div>
                      </td>
                      <td className="text-center">
                        <M3NumberTile className="size-6 text-[13px]">{r.table_no}</M3NumberTile>
                      </td>
                      <td>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold tabular-nums">{r.jobs.length}</span>
                          {r.jobs.slice(0, 2).map((j) => (
                            <Link
                              key={j.job_no}
                              href={`/production/jobs/${encodeURIComponent(j.job_no)}`}
                              className="text-[11px] font-semibold tabular-nums text-m3-info-dark hover:underline"
                            >
                              {j.job_no}
                            </Link>
                          ))}
                          {r.jobs.length > 2 && <span className="text-[11px] text-m3-grey-500">+{r.jobs.length - 2} งาน</span>}
                        </div>
                      </td>
                      <td className="text-m3-grey-600">{r.unit}</td>
                      <td className="m3-num tabular-nums">{formatQty(r.target)}</td>
                      <td className="m3-num font-semibold tabular-nums">
                        <span className="text-m3-primary-dark">{formatQty(r.produced)}</span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[rgba(145,158,171,0.2)]">
                            <span className={`block h-full rounded-full ${barCls}`} style={{ width: `${Math.min(100, pct)}%` }} />
                          </span>
                          <span className="text-xs tabular-nums text-m3-grey-600">{formatQty(pct)}%</span>
                        </div>
                      </td>
                      <td className="m3-num tabular-nums">
                        <span className={r.defect > 0 ? "text-m3-error-dark" : "text-m3-grey-500"}>{formatQty(r.defect)}</span>
                      </td>
                      <td className="m3-num tabular-nums">
                        <span className={r.remaining > 0 ? "text-m3-warning-dark" : "text-m3-grey-500"}>{formatQty(r.remaining)}</span>
                      </td>
                      <td className="m3-num tabular-nums">
                        <span className={r.over > 0 ? "text-m3-info-dark" : "text-m3-grey-500"}>{formatQty(r.over)}</span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {r.underClosed && <span className="m3-label m3-label-error">จบต่ำกว่าเป้า</span>}
                          {r.overProduced && <span className="m3-label m3-label-info">ผลิตเกิน</span>}
                          {r.hasDefect && <span className="m3-label m3-label-error">มีของเสีย</span>}
                          {!r.underClosed && !r.overProduced && !r.hasDefect && <span className="m3-label m3-label-success">ปกติ</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
