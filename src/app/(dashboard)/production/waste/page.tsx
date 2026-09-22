"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WasteRecord } from "@/types/production";

const DATE_PRESETS = [
  { id: "TODAY", label: "วันนี้" },
  { id: "7D", label: "7 วัน" },
  { id: "30D", label: "30 วัน" },
  { id: "ALL", label: "ทั้งหมด" },
] as const;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const token =
      sessionStorage.getItem("stockify_tab_token") || localStorage.getItem("stockify_tab_token");
    if (token) {
      headers["x-tab-token"] = token;
      headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return headers;
}

function startOfDay(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

export default function ProductionWastePage() {
  const [records, setRecords] = useState<WasteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [preset, setPreset] = useState<(typeof DATE_PRESETS)[number]["id"]>("ALL");

  const loadWaste = useCallback(async () => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const res = await fetch("/api/production/waste", { headers: authHeaders(), cache: "no-store" });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setRecords(json.data);
      } else {
        setErrorBanner(json.message || "ดึงรายการของเสียไม่สำเร็จ");
      }
    } catch {
      setErrorBanner("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWaste();
    const handler = () => loadWaste();
    window.addEventListener("stockify-production-created", handler);
    return () => window.removeEventListener("stockify-production-created", handler);
  }, [loadWaste]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const days = preset === "7D" ? 7 : preset === "30D" ? 30 : 0;
    const minTime =
      preset === "TODAY" ? startOfDay(new Date()) : days > 0 ? now - days * 86400000 : 0;

    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      const t = new Date(r.created_at || r.document_date || 0).getTime();
      if (t < minTime) return false;
      if (!q) return true;
      return (
        r.fg_sku.toLowerCase().includes(q) ||
        r.fg_name.toLowerCase().includes(q) ||
        r.order_no.toLowerCase().includes(q) ||
        r.recorded_by_name.toLowerCase().includes(q)
      );
    });
  }, [records, search, preset]);

  const totalQty = filtered.reduce((s, r) => s + (r.qty || 0), 0);
  const totalOrders = new Set(filtered.map((r) => r.order_no).filter(Boolean)).size;

  return (
    <div className="w-full max-w-full pb-8">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">ของเสียจากการผลิต</h1>
        <p className="mt-1.5 text-sm font-medium text-slate-500">
          ชิ้นงานที่ผลิตแล้วเสีย บันทึกอัตโนมัติจากการตรวจการผลิต — ไม่นับเป็นสต็อกขายได้
        </p>
      </div>

      {errorBanner && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-bold text-rose-800">{errorBanner}</p>
          <button
            onClick={() => setErrorBanner(null)}
            className="rounded-lg px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
          >
            ปิด
          </button>
        </div>
      )}

      {/* ตัวกรอง */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาสินค้า / เลขที่ใบผลิต / ผู้บันทึก"
            className="w-full rounded-xl border border-[#E1E8EE] bg-white px-4 py-2.5 pl-10 text-sm font-semibold text-slate-800 focus:border-[#0F5C3F] focus:outline-none"
          />
          <svg
            className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
        </div>
        <div className="flex gap-1.5 rounded-xl border border-[#E1E8EE] bg-white p-1">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                preset === p.id ? "bg-[#06402B] text-white" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={loadWaste}
          className="rounded-xl border border-[#E1E8EE] bg-white px-3.5 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
          title="รีเฟรช"
        >
          ↻
        </button>
      </div>

      {/* สรุปยอด */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#E8ECEA] bg-white px-4 py-3 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">รายการเสีย</div>
          <div className="mt-1 font-mono text-2xl font-black text-slate-900">{filtered.length.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wide text-rose-400">จำนวนชิ้นรวม</div>
          <div className="mt-1 font-mono text-2xl font-black text-rose-700">{totalQty.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-[#E8ECEA] bg-white px-4 py-3 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">จากใบผลิต</div>
          <div className="mt-1 font-mono text-2xl font-black text-slate-900">{totalOrders.toLocaleString()} ใบ</div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-[#E8ECEA] bg-white p-16 text-center shadow-xs">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0F5C3F] border-t-transparent" />
          <p className="mt-3 text-sm font-semibold text-slate-500">กำลังดึงรายการของเสีย...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#E8ECEA] bg-white px-6 py-16 text-center shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#C9DFD4] bg-[#EAF2EE] text-xl">
            🗑️
          </div>
          <h2 className="mt-3.5 text-base font-extrabold text-slate-900">ยังไม่มีรายการของเสีย</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            เมื่อพนักงานตรวจการผลิตและระบุจำนวนของเสีย รายการจะแสดงที่นี่
          </p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[#E8ECEA] bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#EEF1EF] bg-slate-50/70 font-bold text-slate-500">
                  <th className="px-4 py-3">วันที่</th>
                  <th className="px-4 py-3">รหัสสินค้า</th>
                  <th className="px-4 py-3">ชื่อสินค้า</th>
                  <th className="px-4 py-3 text-right">จำนวน</th>
                  <th className="px-4 py-3">ใบผลิต</th>
                  <th className="px-4 py-3">ผู้บันทึก</th>
                  <th className="px-4 py-3">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EF]">
                {filtered.map((r) => (
                  <tr key={r.waste_id} className="hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-bold text-slate-600">
                      {r.document_date || String(r.created_at || "").slice(0, 10)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-bold text-slate-800">{r.fg_sku}</td>
                    <td className="max-w-[220px] px-4 py-3 font-semibold text-slate-800">
                      <span className="block truncate" title={r.fg_name}>
                        {r.fg_name}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-black text-rose-700">
                      {r.qty.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.order_no ? (
                        <span className="font-mono text-xs font-bold text-slate-600">
                          {r.order_no}
                          {r.round_no ? ` (รอบ ${r.round_no})` : ""}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-500">
                      {r.recorded_by_name || "—"}
                    </td>
                    <td className="max-w-[180px] px-4 py-3 text-xs font-medium text-slate-500">
                      <span className="block truncate" title={r.note}>
                        {r.note || "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
