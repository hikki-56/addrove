"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { outboundApi, type BillListItem } from "@/lib/outbound-client";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";

const STATUS_ORDER = [
  "IMPORTED",
  "READY_TO_PICK",
  "PICKING",
  "SHORTAGE",
  "PICKED_WAITING_APPROVAL",
  "READY_TO_PACK",
  "PACKING",
  "PACKED",
  "ASSIGNED_TO_SHIPMENT",
  "LOADING",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "HOLD",
  "CANCELLED",
];

const STATUS_COLORS: Record<string, string> = {
  IMPORTED: "bg-slate-100 text-slate-700 border-slate-200",
  READY_TO_PICK: "bg-emerald-50 text-emerald-800 border-emerald-200",
  PICKING: "bg-blue-50 text-blue-800 border-blue-200",
  SHORTAGE: "bg-orange-50 text-orange-800 border-orange-200",
  PICKED_WAITING_APPROVAL: "bg-amber-50 text-amber-800 border-amber-200",
  READY_TO_PACK: "bg-emerald-50 text-emerald-800 border-emerald-200",
  PACKING: "bg-blue-50 text-blue-800 border-blue-200",
  PACKED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  ASSIGNED_TO_SHIPMENT: "bg-violet-50 text-violet-800 border-violet-200",
  LOADING: "bg-violet-50 text-violet-800 border-violet-200",
  PARTIALLY_SHIPPED: "bg-orange-50 text-orange-800 border-orange-200",
  SHIPPED: "bg-[#06402B]/10 text-[#06402B] border-[#06402B]/25",
  HOLD: "bg-red-50 text-red-800 border-red-200",
  CANCELLED: "bg-slate-100 text-slate-500 border-slate-200 line-through",
};

export default function OutboundPage() {
  const [bills, setBills] = useState<BillListItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await outboundApi.listBills();
      setBills(data.bills);
      setCounts(data.counts);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  usePollingWhenVisible(load, 15000);

  const activeCounts = Object.entries(counts).filter(([s]) => s !== "SHIPPED" && s !== "CANCELLED");
  const filtered = filter === "ALL" ? bills : bills.filter((b) => b.outbound_status === filter);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#06402B]">ส่งของออก</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/outbound/upload"
            className="px-4 py-2.5 rounded-xl bg-[#06402B] text-white text-sm font-semibold hover:bg-[#0A5C4E] transition-colors"
          >
            + นำเข้าบิลจากไฟล์ Express
          </Link>
        </div>
      </div>

      {/* ลิงก์ไปหน้างาน */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { href: "/outbound/pick", label: "หยิบของ", icon: "🎯" },
          { href: "/outbound/pack", label: "แพ็กใส่กล่อง", icon: "📦" },
          { href: "/outbound/loading", label: "ขึ้นรถ", icon: "🚚" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="bg-white rounded-2xl border border-[#E8ECEA] p-4 hover:border-[#06402B]/40 transition-colors flex items-center gap-3"
          >
            <span className="text-3xl">{item.icon}</span>
            <span className="font-semibold text-slate-800">{item.label}</span>
          </Link>
        ))}
      </div>

      {/* ตัวกรองตามสถานะ */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("ALL")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
            filter === "ALL" ? "bg-[#06402B] text-white border-[#06402B]" : "bg-white text-slate-600 border-[#E8ECEA] hover:border-slate-300"
          }`}
        >
          ทั้งหมด {bills.length}
        </button>
        {activeCounts
          .sort((a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0]))
          .map(([status, count]) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                filter === status ? "bg-[#06402B] text-white border-[#06402B]" : "bg-white text-slate-600 border-[#E8ECEA] hover:border-slate-300"
              }`}
            >
              {bills.find((b) => b.outbound_status === status)?.status_label ?? status} {count}
            </button>
          ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {/* ตารางบิล */}
      <div className="bg-white rounded-2xl border border-[#E8ECEA] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">กำลังโหลด…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            {bills.length === 0
              ? "ยังไม่มีบิล — เริ่มจากกด \"นำเข้าบิลจากไฟล์ Express\""
              : "ไม่มีบิลในสถานะนี้"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F7F9F8] text-left text-slate-500">
                  <th className="px-4 py-3 font-medium">เลขที่บิล Express</th>
                  <th className="px-4 py-3 font-medium">เลขที่ระบบ</th>
                  <th className="px-4 py-3 font-medium">ลูกค้า</th>
                  <th className="px-4 py-3 font-medium">รายการ</th>
                  <th className="px-4 py-3 font-medium">หยิบแล้ว</th>
                  <th className="px-4 py-3 font-medium">กล่อง</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.document_id} className="border-t border-[#E8ECEA] hover:bg-[#F7F9F8]/60">
                    <td className="px-4 py-3 font-semibold text-slate-800">{b.express_bill_no}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{b.document_no}</td>
                    <td className="px-4 py-3 text-slate-600">{b.customer || "-"}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{b.item_count}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {b.total_qty_picked.toLocaleString("th-TH")}/{b.total_qty_required.toLocaleString("th-TH")}
                      {b.problem_count > 0 && (
                        <span className="ml-1 text-orange-600" title={`${b.problem_count} รายการมีปัญหา`}>⚠️{b.problem_count}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">{b.box_count || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[b.outbound_status] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {b.status_label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/outbound/${b.document_no}`} className="text-[#06402B] font-semibold hover:underline">
                        ดู →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
