"use client";
import { useEffect, useState } from "react";
import type { StockCount } from "@/types/models";
import { useSession } from "next-auth/react";

export default function StockCountsPage() {
  const { data: session } = useSession();
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [warehouses, setWarehouses] = useState<{ warehouse_id: string; warehouse_name: string }[]>([]);
  const [locations, setLocations] = useState<{ location_id: string; location_code: string }[]>([]);
  const [products, setProducts] = useState<{ product_id: string; product_name: string; sku: string }[]>([]);
  const [form, setForm] = useState({ product_id: "", warehouse_id: "", location_id: "", counted_qty: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/stock-counts")
      .then(r => r.json())
      .then(d => { if (d.success) setCounts(d.data); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    Promise.all([
      fetch("/api/warehouses").then(r => r.json()),
      fetch("/api/products?active=true").then(r => r.json()),
    ]).then(([w, p]) => {
      if (w.success) setWarehouses(w.data);
      if (p.success) setProducts(p.data);
    });
  }, []);

  useEffect(() => {
    if (form.warehouse_id) {
      fetch(`/api/locations?warehouse_id=${form.warehouse_id}`)
        .then(r => r.json())
        .then(d => { if (d.success) setLocations(d.data); });
    }
  }, [form.warehouse_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const res = await fetch("/api/stock-counts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, counted_qty: Number(form.counted_qty) }),
    });
    const json = await res.json();
    if (json.success) { setShowForm(false); load(); }
    else setError(json.message);
    setSubmitting(false);
  };

  const handleApprove = async (id: string) => {
    const res = await fetch(`/api/stock-counts/${id}/approve`, { method: "POST" });
    const json = await res.json();
    if (json.success) load();
    else alert(json.message);
  };

  const statusLabel: Record<string, string> = { PENDING: 'รอดำเนินการ', COUNTED: 'นับแล้ว', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ปฏิเสธ' };
  const statusClass: Record<string, string> = { PENDING: 'badge-low', COUNTED: 'badge-normal', APPROVED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', REJECTED: 'badge-out' };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">ตรวจนับสต็อก</h1>
          <p className="text-gray-400 text-sm mt-1">บันทึกผลการตรวจนับสินค้าจริง</p>
        </div>
        {session?.user.role !== 'VIEWER' && (
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all shadow-lg shadow-emerald-600/30">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            เพิ่มการตรวจนับ
          </button>
        )}
      </div>

      {showForm && (
        <div className="glass-card rounded-2xl p-5 border border-emerald-900/30">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">เพิ่มรายการตรวจนับ</h2>
          {error && <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">สินค้า *</label>
              <select value={form.product_id} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm">
                <option value="" className="bg-[#080d0a]">เลือกสินค้า</option>
                {products.map(p => <option key={p.product_id} value={p.product_id} className="bg-[#080d0a]">{p.product_name} ({p.sku})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">โกดัง *</label>
              <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value, location_id: "" }))}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm">
                <option value="" className="bg-[#080d0a]">เลือกโกดัง</option>
                {warehouses.map(w => <option key={w.warehouse_id} value={w.warehouse_id} className="bg-[#080d0a]">{w.warehouse_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">ตำแหน่ง *</label>
              <select value={form.location_id} onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm">
                <option value="" className="bg-[#080d0a]">เลือกตำแหน่ง</option>
                {locations.map(l => <option key={l.location_id} value={l.location_id} className="bg-[#080d0a]">{l.location_code}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">จำนวนที่นับได้จริง *</label>
              <input type="number" min="0" value={form.counted_qty}
                onChange={e => setForm(f => ({ ...f, counted_qty: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all text-sm">ยกเลิก</button>
              <button type="submit" disabled={submitting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-all text-sm shadow-md shadow-emerald-600/30">
                {submitting ? 'กำลังบันทึก...' : 'บันทึกผลการตรวจนับ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">กำลังโหลด...</div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden border border-emerald-900/30">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-emerald-400/80 uppercase tracking-wider bg-emerald-950/40">
                  <th className="text-left px-6 py-3.5">เลขที่</th>
                  <th className="text-left px-6 py-3.5">สินค้า</th>
                  <th className="text-right px-6 py-3.5">ยอดระบบ</th>
                  <th className="text-right px-6 py-3.5">ยอดที่นับ</th>
                  <th className="text-right px-6 py-3.5">ผลต่าง</th>
                  <th className="text-left px-6 py-3.5">สถานะ</th>
                  {session?.user.role === 'ADMIN' && <th className="text-right px-6 py-3.5">จัดการ</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-900/20">
                {counts.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-gray-500">ยังไม่มีรายการตรวจนับ</td></tr>
                ) : counts.map(c => (
                  <tr key={c.count_id} className="hover:bg-emerald-950/30 transition-colors">
                    <td className="px-6 py-3.5 font-mono text-sm text-emerald-400 font-semibold">{c.count_no}</td>
                    <td className="px-6 py-3.5 text-sm text-gray-300">{c.product_id}</td>
                    <td className="px-6 py-3.5 text-sm text-right text-gray-300">{c.system_qty.toLocaleString()}</td>
                    <td className="px-6 py-3.5 text-sm text-right text-white font-medium">{c.counted_qty?.toLocaleString() ?? '-'}</td>
                    <td className={`px-6 py-3.5 text-sm font-semibold text-right ${
                      (c.difference ?? 0) > 0 ? 'text-emerald-400' : (c.difference ?? 0) < 0 ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      {c.difference !== null ? (c.difference > 0 ? '+' : '') + c.difference.toLocaleString() : '-'}
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${statusClass[c.status] ?? 'badge-low'}`}>
                        {statusLabel[c.status] ?? c.status}
                      </span>
                    </td>
                    {session?.user.role === 'ADMIN' && (
                      <td className="px-6 py-3.5 text-right">
                        {c.status === 'COUNTED' && (
                          <button onClick={() => handleApprove(c.count_id)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-medium transition-colors border border-emerald-500/30 shadow-sm shadow-emerald-950">
                            อนุมัติ
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
