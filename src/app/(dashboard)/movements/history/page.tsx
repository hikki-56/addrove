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
        <h1 className="text-2xl font-bold text-white">ประวัติการเคลื่อนไหว</h1>
        <p className="text-gray-400 text-sm mt-1">รายการเคลื่อนไหวสินค้าทั้งหมด</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="history-search"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="ค้นหาเลขเอกสาร..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
          />
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
        <button onClick={load}
          className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all shadow-md shadow-emerald-600/30">
          ค้นหา
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">กำลังโหลด...</div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden border border-emerald-900/30">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-emerald-400/80 uppercase tracking-wider bg-emerald-950/40">
                  <th className="text-left px-6 py-3.5">เลขเอกสาร</th>
                  <th className="text-left px-6 py-3.5">ประเภท</th>
                  <th className="text-left px-6 py-3.5">สินค้า</th>
                  <th className="text-right px-6 py-3.5">จำนวน</th>
                  <th className="text-left px-6 py-3.5">ตำแหน่ง</th>
                  <th className="text-left px-6 py-3.5">โกดัง</th>
                  <th className="text-left px-6 py-3.5">ผู้ทำรายการ</th>
                  <th className="text-left px-6 py-3.5">วันที่</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-900/20">
                {movements.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-gray-500">ไม่พบรายการ</td></tr>
                ) : movements.map(m => (
                  <tr key={m.movement_id} className="hover:bg-emerald-950/30 transition-colors">
                    <td className="px-6 py-3.5 font-mono text-sm text-emerald-400 font-semibold whitespace-nowrap">{m.document_no}</td>
                    <td className="px-6 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        m.qty_change > 0 ? 'badge-normal' : 'badge-out'
                      }`}>
                        {movTypeLabel[m.movement_type] ?? m.movement_type}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <p className="text-sm text-white truncate max-w-[160px] font-medium">{m.product_name}</p>
                      <p className="text-xs text-gray-500">{m.sku}</p>
                    </td>
                    <td className={`px-6 py-3.5 text-sm font-semibold text-right ${
                      m.qty_change > 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {m.qty_change > 0 ? '+' : ''}{m.qty_change.toLocaleString()}
                    </td>
                    <td className="px-6 py-3.5 text-xs font-mono text-emerald-300">{m.location_code || '-'}</td>
                    <td className="px-6 py-3.5 text-sm text-gray-300">{m.warehouse_name}</td>
                    <td className="px-6 py-3.5 text-sm text-gray-300">{m.created_by_name}</td>
                    <td className="px-6 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-3.5 border-t border-emerald-900/30 flex items-center justify-between">
            <p className="text-xs text-gray-500">ทั้งหมด {total.toLocaleString()} รายการ</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-900/30 text-gray-300 hover:bg-emerald-900/50 disabled:opacity-30 text-xs transition-colors">
                ก่อนหน้า
              </button>
              <span className="px-3 py-1.5 text-xs text-gray-300">หน้า {page}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={movements.length < 50}
                className="px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-900/30 text-gray-300 hover:bg-emerald-900/50 disabled:opacity-30 text-xs transition-colors">
                ถัดไป
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
