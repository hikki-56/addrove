"use client";

import { SolarBoxClosed, SolarBus, SolarCart } from "@/components/icons";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { outboundApi, type BillListItem } from "@/client/outbound-client";
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
  IMPORTED: "bg-m3-grey-200 text-m3-grey-700 border-m3-grey-300",
  READY_TO_PICK: "bg-[rgba(0,167,111,0.08)] text-m3-primary-dark border-[rgba(0,167,111,0.24)]",
  PICKING: "bg-[rgba(0,184,217,0.08)] text-m3-info-dark border-[rgba(0,184,217,0.24)]",
  SHORTAGE: "bg-[rgba(255,171,0,0.08)] text-m3-warning-dark border-[rgba(255,171,0,0.24)]",
  PICKED_WAITING_APPROVAL: "bg-[rgba(255,171,0,0.08)] text-m3-warning-dark border-[rgba(255,171,0,0.24)]",
  READY_TO_PACK: "bg-[rgba(0,167,111,0.08)] text-m3-primary-dark border-[rgba(0,167,111,0.24)]",
  PACKING: "bg-[rgba(0,184,217,0.08)] text-m3-info-dark border-[rgba(0,184,217,0.24)]",
  PACKED: "bg-[rgba(0,167,111,0.08)] text-m3-primary-dark border-[rgba(0,167,111,0.24)]",
  ASSIGNED_TO_SHIPMENT: "bg-[rgba(142,51,255,0.08)] text-m3-secondary-dark border-[rgba(142,51,255,0.24)]",
  LOADING: "bg-[rgba(142,51,255,0.08)] text-m3-secondary-dark border-[rgba(142,51,255,0.24)]",
  PARTIALLY_SHIPPED: "bg-[rgba(255,171,0,0.08)] text-m3-warning-dark border-[rgba(255,171,0,0.24)]",
  SHIPPED: "bg-m3-primary/10 text-m3-primary-dark border-m3-primary/25",
  HOLD: "bg-[rgba(255,86,48,0.08)] text-m3-error-dark border-[rgba(255,86,48,0.24)]",
  CANCELLED: "bg-m3-grey-200 text-m3-grey-600 border-m3-grey-300 line-through",
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
          <h1 className="text-2xl font-bold text-m3-primary-dark">ส่งของออก</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/outbound/upload"
            className="px-4 py-2.5 rounded-xl bg-m3-primary text-white text-sm font-semibold hover:bg-m3-primary-dark transition-colors"
          >
            + นำเข้าบิลจากไฟล์ Express
          </Link>
        </div>
      </div>

      {/* ลิงก์ไปหน้างาน */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { href: "/outbound/pick", label: "หยิบของ", icon: <SolarCart size={28} className="text-m3-primary" /> },
          { href: "/outbound/pack", label: "แพ็กใส่กล่อง", icon: <SolarBoxClosed size={28} className="text-m3-info" /> },
          { href: "/outbound/loading", label: "ขึ้นรถ", icon: <SolarBus size={28} className="text-m3-warning" /> },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-4 hover:border-m3-primary/40 transition-colors flex items-center gap-3"
          >
            <span className="text-3xl">{item.icon}</span>
            <span className="font-semibold text-m3-grey-800">{item.label}</span>
          </Link>
        ))}
      </div>

      {/* ตัวกรองตามสถานะ */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("ALL")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
            filter === "ALL" ? "bg-m3-primary text-white border-m3-primary" : "bg-white text-m3-grey-600 border-[rgba(145,158,171,0.2)] hover:border-m3-grey-400"
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
                filter === status ? "bg-m3-primary text-white border-m3-primary" : "bg-white text-m3-grey-600 border-[rgba(145,158,171,0.2)] hover:border-m3-grey-400"
              }`}
            >
              {bills.find((b) => b.outbound_status === status)?.status_label ?? status} {count}
            </button>
          ))}
      </div>

      {error && (
        <div className="bg-[rgba(255,86,48,0.08)] border border-[rgba(255,86,48,0.24)] text-m3-error-dark rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {/* ตารางบิล */}
      <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-m3-grey-500">กำลังโหลด…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-m3-grey-500">
            {bills.length === 0
              ? "ยังไม่มีบิล"
              : "ไม่มีบิลในสถานะนี้"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-m3-grey-100 text-left text-m3-grey-600">
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
                  <tr key={b.document_id} className="border-t border-[rgba(145,158,171,0.2)] hover:bg-m3-grey-100/60">
                    <td className="px-4 py-3 font-semibold text-m3-grey-800">{b.express_bill_no}</td>
                    <td className="px-4 py-3 tabular-nums text-xs text-m3-grey-600">{b.document_no}</td>
                    <td className="px-4 py-3 text-m3-grey-600">{b.customer || "-"}</td>
                    <td className="px-4 py-3 tabular-nums text-m3-grey-700">{b.item_count}</td>
                    <td className="px-4 py-3 tabular-nums text-m3-grey-700">
                      {b.total_qty_picked.toLocaleString("th-TH")}/{b.total_qty_required.toLocaleString("th-TH")}
                      {b.problem_count > 0 && (
                        <span className="ml-1 text-m3-warning-dark" title={`${b.problem_count} รายการมีปัญหา`}>⚠️{b.problem_count}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-m3-grey-700">{b.box_count || "-"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[b.outbound_status] ?? "bg-m3-grey-200 text-m3-grey-600 border-m3-grey-300"}`}>
                        {b.status_label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/outbound/${b.document_no}`} className="text-m3-primary-dark font-semibold hover:underline">
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
