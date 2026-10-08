"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { useProductionJobs } from "../_lib/use-production-data";
import { formatQty } from "../_components/ui";
import type { ProductionJob } from "@/types/production";
import { PRODUCTION_JOB_STATUS_LABELS, PRODUCTION_TABLES } from "@/types/production";

// หน้าสรุปผลผลิตสำหรับ ADMIN (§8) — แยกตามสินค้า × โต๊ะ พร้อมหน่วยชัดเจน (ไม่รวมข้ามหน่วย)
// เน้น: งานจบต่ำกว่าเป้า / ผลิตเกิน / มีของเสีย · กรองช่วงวันที่ โต๊ะ สินค้า สถานะ

const filterInputClass =
  "w-full rounded-lg border border-[#E8ECEA] bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 focus:outline-none";

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
  const { jobs, loading, error } = useProductionJobs();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [tableFilter, setTableFilter] = useState<number | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");

  useEffect(() => {
    const now = new Date();
    const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const today = bangkok.toISOString().slice(0, 10);
    const weekAgo = new Date(bangkok.getTime() - 6 * 86400000).toISOString().slice(0, 10);
    setDateFrom(weekAgo);
    setDateTo(today);
  }, []);

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

  if (!isAdmin) {
    return (
      <div className="w-full max-w-full pb-8">
        <h1 className="text-2xl font-extrabold text-slate-900">สรุปผลผลิต</h1>
        <div className="mt-6 rounded-xl border border-[#E8ECEA] bg-white px-6 py-16 text-center shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-xl">🔒</div>
          <h2 className="mt-3.5 text-base font-extrabold text-slate-900">เฉพาะผู้ดูแลระบบ (Admin)</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full pb-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">สรุปผลผลิต</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            ยอดรวมแยกตามสินค้า × โต๊ะ — เรียงงานที่ต้องสนใจขึ้นบน (จบต่ำกว่าเป้า · ผลิตเกิน · มีของเสีย)
          </p>
        </div>
        <Link
          href="/production"
          className="rounded-lg border border-[#E8ECEA] bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-all hover:border-[#C8DBD1] hover:bg-slate-50"
        >
          ไปหน้าวางแผนผลิต
        </Link>
      </div>

      {/* สถิติรวม */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {(["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map((s) => (
          <div key={s} className="rounded-xl border border-[#E8ECEA] bg-white px-3.5 py-3 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{PRODUCTION_JOB_STATUS_LABELS[s]}</div>
            <div className="mt-0.5 font-mono text-2xl font-black text-slate-900">{statusCounts[s] || 0}</div>
            <div className="text-[11px] font-semibold text-slate-400">งาน</div>
          </div>
        ))}
      </div>

      {/* ตัวกรอง */}
      <div className="mb-5 rounded-xl border border-[#E8ECEA] bg-white p-4 shadow-xs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block">
            <span className="text-xs font-bold text-slate-400">จากวันที่</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`mt-1 ${filterInputClass}`} />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-400">ถึงวันที่</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`mt-1 ${filterInputClass}`} />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-400">โต๊ะ</span>
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
              {(["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map((s) => (
                <option key={s} value={s}>{PRODUCTION_JOB_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-slate-400">สินค้า</span>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU / ชื่อสินค้า" className={`mt-1 ${filterInputClass}`} />
          </label>
        </div>
      </div>

      {error && !loading && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-bold text-rose-800">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-[#E8ECEA] bg-white p-16 text-center shadow-xs">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0F5C3F] border-t-transparent" />
          <p className="mt-3 text-sm font-semibold text-slate-500">กำลังสรุปยอด...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[#E8ECEA] bg-white px-6 py-16 text-center shadow-xs">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#C9DFD4] bg-[#EAF2EE] text-2xl">📈</div>
          <h2 className="mt-4 text-lg font-extrabold text-slate-900">ไม่มีข้อมูลผลผลิตในช่วงที่เลือก</h2>
          <p className="mt-1.5 text-sm font-medium text-slate-500">ลองปรับช่วงวันที่หรือตัวกรอง</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#E8ECEA] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="bg-slate-50 font-bold text-slate-500">
                  <th className="px-4 py-3">สินค้า</th>
                  <th className="px-4 py-3 text-center">โต๊ะ</th>
                  <th className="px-4 py-3 text-right">เป้าหมาย</th>
                  <th className="px-4 py-3 text-right">ผลิตดี</th>
                  <th className="px-4 py-3 text-right">ของเสีย</th>
                  <th className="px-4 py-3 text-right">ยังขาด</th>
                  <th className="px-4 py-3 text-right">เกินเป้า</th>
                  <th className="px-4 py-3">สัญญาณ</th>
                  <th className="px-4 py-3 text-center">งาน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EF]">
                {rows.map((r) => (
                  <tr key={r.key} className={r.underClosed ? "bg-amber-50/50" : r.overProduced ? "bg-sky-50/40" : undefined}>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{r.product_name}</div>
                      <div className="font-mono text-xs text-slate-400">
                        {r.sku} · หน่วย {r.unit}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 font-mono text-xs font-black text-slate-700">
                        {r.table_no}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-slate-900">{formatQty(r.target)}</td>
                    <td className="px-4 py-3 text-right font-mono font-black tabular-nums text-[#06402B]">{formatQty(r.produced)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${r.defect > 0 ? "text-rose-700" : "text-slate-300"}`}>
                      {formatQty(r.defect)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${r.remaining > 0 ? "text-amber-700" : "text-slate-300"}`}>
                      {formatQty(r.remaining)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${r.over > 0 ? "text-sky-700" : "text-slate-300"}`}>
                      {formatQty(r.over)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.underClosed && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-800">จบต่ำกว่าเป้า</span>
                        )}
                        {r.overProduced && (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-extrabold text-sky-800">ผลิตเกิน</span>
                        )}
                        {r.hasDefect && (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-700">มีของเสีย</span>
                        )}
                        {!r.underClosed && !r.overProduced && !r.hasDefect && (
                          <span className="rounded bg-[#EAF2EE] px-1.5 py-0.5 text-[10px] font-extrabold text-[#053425]">ปกติ</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        {r.jobs.slice(0, 2).map((j) => (
                          <Link
                            key={j.job_no}
                            href={`/production/jobs/${encodeURIComponent(j.job_no)}`}
                            className="font-mono text-[11px] font-bold text-[#0F5C3F] hover:underline"
                          >
                            {j.job_no}
                          </Link>
                        ))}
                        {r.jobs.length > 2 && <span className="text-[10px] font-semibold text-slate-400">+{r.jobs.length - 2} งาน</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-[#EEF1EF] px-4 py-2.5 text-[11px] font-semibold text-slate-400">
            หน่วยแสดงต่อรายการสินค้า — ไม่รวมยอดสินค้าต่างหน่วยเป็นตัวเลขเดียว · “ยังขาด” และ “เกินเป้า” คำนวณจากผลิตดีเท่านั้น (ไม่รวมของเสีย)
          </p>
        </div>
      )}
    </div>
  );
}
