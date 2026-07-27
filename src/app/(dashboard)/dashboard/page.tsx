"use client";
import { useEffect, useState } from "react";
import type { DashboardStats } from "@/types/models";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

function StatCard({ title, value, icon, color, subtitle }: {
  title: string; value: number | string; icon: React.ReactNode;
  color: string; subtitle?: string;
}) {
  return (
    <div className="glass-card rounded-xl p-5 hover:border-emerald-500/30 transition-all">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-400 text-sm">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${color}`}>{value.toLocaleString()}</p>
          {subtitle && <p className="text-gray-500 text-xs mt-1">{subtitle}</p>}
        </div>
        <div className={`p-2.5 rounded-lg ${color.replace('text-', 'bg-').replace('400', '500/10')} ${color.replace('text-', 'border-').replace('400', '500/20')} border`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

const movTypeLabel: Record<string, string> = {
  RECEIVE: 'รับเข้า', ISSUE: 'เบิกออก', MOVE_OUT: 'ย้ายออก', MOVE_IN: 'ย้ายเข้า',
  TRANSFER_OUT: 'โอนออก', TRANSFER_IN: 'โอนเข้า', ADJUST: 'ปรับยอด',
  OPENING: 'เปิดยอด', REVERSAL: 'กลับยอด',
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard?days=${days}`)
      .then(r => r.json())
      .then(d => { if (d.success) setStats(d.data); })
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <svg className="animate-spin h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <p className="text-gray-400 text-sm">กำลังโหลด...</p>
      </div>
    </div>
  );

  if (!stats) return <div className="text-gray-400 text-center py-12">ไม่สามารถโหลดข้อมูลได้</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">ภาพรวมคลังสินค้า</h1>
          <p className="text-gray-400 text-sm mt-1">ข้อมูลสต็อกและการเคลื่อนไหวสินค้า</p>
        </div>
        <div className="flex gap-2">
          {[7, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                days === d
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {d} วัน
            </button>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="จำนวนรายการสินค้า" value={stats.total_sku} color="text-emerald-400"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
        />
        <StatCard title="สินค้าคงเหลือรวม" value={stats.total_quantity} color="text-teal-400"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>}
        />
        <StatCard title="ใกล้หมด" value={stats.low_stock_count} color="text-amber-400"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
        />
        <StatCard title="สินค้าหมด" value={stats.out_of_stock_count} color="text-red-400"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>}
        />
        <StatCard title="รับเข้าวันนี้" value={stats.received_today} color="text-emerald-300"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>}
        />
        <StatCard title="เบิกออกวันนี้" value={stats.issued_today} color="text-orange-400"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
        />
      </div>

      {/* Chart */}
      <div className="glass-card rounded-xl p-6 border border-emerald-900/30">
        <h2 className="text-lg font-semibold text-white mb-4">การเคลื่อนไหว {days} วันที่ผ่านมา</h2>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={stats.chart_data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="recvGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="issGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: '#080d0a', border: '1px solid #065f46', borderRadius: 8, color: '#f9fafb' }}
              labelStyle={{ color: '#9ca3af' }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
            <Area type="monotone" dataKey="received" name="รับเข้า" stroke="#10b981" fill="url(#recvGrad)" strokeWidth={2} />
            <Area type="monotone" dataKey="issued" name="เบิกออก" stroke="#f97316" fill="url(#issGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Movements */}
      <div className="glass-card rounded-xl overflow-hidden border border-emerald-900/30">
        <div className="px-6 py-4 border-b border-emerald-900/30">
          <h2 className="text-lg font-semibold text-white">รายการเคลื่อนไหวล่าสุด</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-emerald-400/80 uppercase tracking-wider bg-emerald-950/40">
                <th className="text-left px-6 py-3">เลขเอกสาร</th>
                <th className="text-left px-6 py-3">ประเภท</th>
                <th className="text-left px-6 py-3">สินค้า</th>
                <th className="text-right px-6 py-3">จำนวน</th>
                <th className="text-left px-6 py-3">ตำแหน่ง</th>
                <th className="text-left px-6 py-3">โดย</th>
                <th className="text-left px-6 py-3">วันที่</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-900/20">
              {stats.recent_movements.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-500">ยังไม่มีรายการ</td></tr>
              ) : stats.recent_movements.map((m) => (
                <tr key={m.movement_id} className="hover:bg-emerald-950/30 transition-colors">
                  <td className="px-6 py-3 text-sm font-mono text-emerald-400 font-semibold">{m.document_no}</td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${
                      m.movement_type.includes('IN') || m.movement_type === 'RECEIVE'
                        ? 'badge-normal' : 'badge-out'
                    }`}>
                      {movTypeLabel[m.movement_type] ?? m.movement_type}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-sm text-white truncate max-w-[160px]">{m.product_name}</p>
                    <p className="text-xs text-gray-500">{m.sku}</p>
                  </td>
                  <td className={`px-6 py-3 text-sm font-semibold text-right ${
                    m.qty_change > 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {m.qty_change > 0 ? '+' : ''}{m.qty_change.toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-xs text-gray-400 font-mono">{m.location_code || '-'}</td>
                  <td className="px-6 py-3 text-sm text-gray-400">{m.created_by_name}</td>
                  <td className="px-6 py-3 text-xs text-gray-500">
                    {new Date(m.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
