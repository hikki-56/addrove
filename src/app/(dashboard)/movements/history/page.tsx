"use client";
import { useEffect, useState } from "react";
import type { MovementWithDetails } from "@/types/models";

const movTypeLabel: Record<string, string> = {
  RECEIVE: 'รับเข้า', ISSUE: 'เบิกออก', MOVE_OUT: 'ย้ายออก', MOVE_IN: 'ย้ายเข้า',
  TRANSFER_OUT: 'โอนออก', TRANSFER_IN: 'โอนเข้า', ADJUST: 'ปรับยอด',
  OPENING: 'เปิดยอด', REVERSAL: 'กลับยอด',
};

export default function HistoryPage() {
  const [movements, setMovements] = useState<MovementWithDetails[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (search) params.set("document_no", search);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    fetch(`/api/movements?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) { setMovements(d.data.data); setTotal(d.data.total); }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, dateFrom, dateTo]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">ประวัติการเคลื่อนไหว</h1>
        <p className="text-slate-500 text-xs sm:text-sm mt-0.5">รายการเคลื่อนไหวสินค้าทั้งหมดในระบบ</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="history-search"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="ค้นหาเลขเอกสาร..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm transition-all"
          />
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-semibold" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-semibold" />
        <button onClick={load}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm shadow-md shadow-indigo-600/20 cursor-pointer active:scale-95 transition-all">
          ค้นหา
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm font-medium">กำลังโหลดข้อมูลประวัติ...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">เลขเอกสาร</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">ประเภท</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">สินค้า</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider">จำนวน</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">ตำแหน่ง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">โกดัง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">ผู้ทำรายการ</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">วันที่</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {movements.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-slate-500 text-sm font-medium">ไม่พบรายการเคลื่อนไหว</td></tr>
                ) : movements.map(m => (
                  <tr key={m.movement_id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs font-bold text-indigo-600 whitespace-nowrap">{m.document_no}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                        m.qty_change > 0
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : 'bg-rose-100 text-rose-800 border-rose-200'
                      }`}>
                        {movTypeLabel[m.movement_type] ?? m.movement_type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-xs sm:text-sm text-slate-900 font-bold truncate max-w-[180px]">{m.product_name}</p>
                      <p className="text-xs text-slate-500 font-mono">{m.sku}</p>
                    </td>
                    <td className={`px-5 py-3.5 text-xs sm:text-sm font-mono font-bold text-right ${
                      m.qty_change > 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}>
                      {m.qty_change > 0 ? '+' : ''}{m.qty_change.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-mono font-semibold text-slate-700">{m.location_code || '-'}</td>
                    <td className="px-5 py-3.5 text-xs text-slate-600 font-medium">{m.warehouse_name}</td>
                    <td className="px-5 py-3.5 text-xs text-slate-600 font-medium">{m.created_by_name}</td>
                    <td className="px-5 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3.5 border-t border-slate-200 flex items-center justify-between bg-slate-50">
            <p className="text-xs text-slate-600 font-medium">ทั้งหมด <strong className="text-slate-900 font-bold">{total.toLocaleString()}</strong> รายการ</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 text-xs font-bold transition-colors cursor-pointer shadow-xs active:scale-95">
                ก่อนหน้า
              </button>
              <span className="px-3 py-1.5 text-xs text-slate-700 font-bold">หน้า {page}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={movements.length < 50}
                className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 text-xs font-bold transition-colors cursor-pointer shadow-xs active:scale-95">
                ถัดไป
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
