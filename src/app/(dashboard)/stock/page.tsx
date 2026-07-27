"use client";
import { useEffect, useState } from "react";
import type { StockBalance } from "@/types/models";

const statusLabel: Record<string, string> = {
  NORMAL: 'ปกติ', LOW: 'ใกล้หมด', OUT: 'หมด', NEGATIVE: 'ติดลบ'
};
const statusClass: Record<string, string> = {
  NORMAL: 'badge-normal', LOW: 'badge-low', OUT: 'badge-out', NEGATIVE: 'badge-negative'
};

export default function StockPage() {
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("ALL");

  useEffect(() => {
    fetch("/api/stock")
      .then(r => r.json())
      .then(d => { if (d.success) setBalances(d.data); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = balances.filter(b => {
    const matchSearch = !search || b.sku.toLowerCase().includes(search.toLowerCase()) ||
      b.product_name.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'ALL' || b.status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">ตรวจสอบสต็อก</h1>
        <p className="text-gray-400 text-sm mt-1">ยอดคงเหลือสินค้าทุกโกดังและตำแหน่ง</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="stock-search"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา รหัสสินค้า หรือชื่อสินค้า..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {['ALL', 'NORMAL', 'LOW', 'OUT', 'NEGATIVE'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                filter === s
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              {s === 'ALL' ? 'ทั้งหมด' : statusLabel[s]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">กำลังโหลด...</div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden border border-emerald-900/30">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-emerald-400/80 uppercase tracking-wider bg-emerald-950/40">
                  <th className="text-left px-6 py-3.5">รหัสสินค้า</th>
                  <th className="text-left px-6 py-3.5">ชื่อสินค้า</th>
                  <th className="text-left px-6 py-3.5">หน่วย</th>
                  <th className="text-right px-6 py-3.5">ยอดรวม</th>
                  <th className="text-right px-6 py-3.5">ขั้นต่ำ</th>
                  <th className="text-left px-6 py-3.5">สถานะ</th>
                  <th className="text-left px-6 py-3.5">ตำแหน่ง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-900/20">
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-gray-500">ไม่พบสินค้า</td></tr>
                ) : filtered.map(b => (
                  <tr key={b.product_id} className="hover:bg-emerald-950/30 transition-colors">
                    <td className="px-6 py-3.5 font-mono text-sm text-emerald-400 font-semibold">{b.sku}</td>
                    <td className="px-6 py-3.5 text-sm text-white max-w-[200px] truncate">{b.product_name}</td>
                    <td className="px-6 py-3.5 text-sm text-gray-400">{b.base_unit}</td>
                    <td className={`px-6 py-3.5 text-sm font-bold text-right ${
                      b.total_quantity < 0 ? 'text-purple-400' :
                      b.total_quantity === 0 ? 'text-red-400' :
                      b.total_quantity <= b.minimum_stock ? 'text-amber-400' : 'text-emerald-400'
                    }`}>
                      {b.total_quantity.toLocaleString()}
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-400 text-right">{b.minimum_stock.toLocaleString()}</td>
                    <td className="px-6 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${statusClass[b.status]}`}>
                        {statusLabel[b.status]}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="space-y-1">
                        {b.by_warehouse.flatMap(wh =>
                          wh.by_location.map(loc => (
                            <div key={loc.location_id} className="flex items-center gap-2">
                              <span className="font-mono text-xs text-emerald-300 font-medium">{loc.location_code}</span>
                              <span className="text-xs text-gray-400">{loc.quantity.toLocaleString()}</span>
                            </div>
                          ))
                        )}
                        {b.by_warehouse.length === 0 && <span className="text-xs text-gray-500">ไม่มีข้อมูล</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-3 border-t border-emerald-900/30 text-xs text-gray-500">
            แสดง {filtered.length} จาก {balances.length} รายการ
          </div>
        </div>
      )}
    </div>
  );
}
