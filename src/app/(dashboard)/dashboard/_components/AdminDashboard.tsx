"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface PendingDoc {
  document_id: string;
  document_no: string;
  target_sheet: string;
  document_date: string;
  created_at?: string;
  rows: Array<[string, string, string, string, number, string, string, string]>;
}

const warehouseNumbers = [1, 2, 3, 4, 5, 6];

export default function AdminDashboard() {
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const [stats, setStats] = useState({
    totalProducts: 0,
    pendingApprovals: 0,
    activeWarehouses: 6,
    totalMovements: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
  });
  const [warehouseQtyMap, setWarehouseQtyMap] = useState<Record<number, number>>({
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
  });
  const [recentMovements, setRecentMovements] = useState<any[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [appRes, prodRes, stockRes, movRes] = await Promise.all([
          fetch("/api/approvals").then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/products").then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/stock").then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/movements?limit=10").then((r) => r.json()).catch(() => ({ data: { items: [], total: 0 } })),
        ]);

        const pending = Array.isArray(appRes.data) ? appRes.data : [];
        const products = Array.isArray(prodRes.data) ? prodRes.data : [];
        const balances = Array.isArray(stockRes.data) ? stockRes.data : [];
        const movements = Array.isArray(movRes.data?.items)
          ? movRes.data.items
          : Array.isArray(movRes.data)
          ? movRes.data
          : [];

        const getWhIndex = (str?: string): number => {
          if (!str) return -1;
          const s = String(str).toLowerCase();
          if (s.includes("wh-01") || s.includes("wh-1") || s.includes("wh1") || s.includes("โกดัง 1") || s.includes("โกดัง1")) return 1;
          if (s.includes("wh-02") || s.includes("wh-2") || s.includes("wh2") || s.includes("โกดัง 2") || s.includes("โกดัง2")) return 2;
          if (s.includes("wh-03") || s.includes("wh-3") || s.includes("wh3") || s.includes("โกดัง 3") || s.includes("โกดัง3")) return 3;
          if (s.includes("wh-04") || s.includes("wh-4") || s.includes("wh4") || s.includes("โกดัง 4") || s.includes("โกดัง4")) return 4;
          if (s.includes("wh-05") || s.includes("wh-5") || s.includes("wh5") || s.includes("โกดัง 5") || s.includes("โกดัง5")) return 5;
          if (s.includes("wh-06") || s.includes("wh-6") || s.includes("wh6") || s.includes("สำนักงานใหญ่")) return 6;
          const numMatch = s.match(/\d+/);
          if (numMatch) {
            const n = parseInt(numMatch[0], 10);
            if (n >= 1 && n <= 6) return n;
          }
          return -1;
        };

        const qtyCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

        // 1. Process product quantities directly from /api/products (reads Google Sheets โกดัง 1 - 5)
        products.forEach((p: any) => {
          const breakdown = p.locations_breakdown || p.locations;
          if (Array.isArray(breakdown) && breakdown.length > 0) {
            breakdown.forEach((loc: any) => {
              const lIdx = getWhIndex(loc.warehouse_id) !== -1 
                ? getWhIndex(loc.warehouse_id) 
                : getWhIndex(loc.warehouse_name);
              const lq = Number(loc.quantity ?? loc.qty ?? 0) || 0;
              if (lIdx >= 1 && lIdx <= 6 && lq > 0) {
                qtyCounts[lIdx] += lq;
              }
            });
          } else {
            const idx = getWhIndex(p.warehouse_id) !== -1 
              ? getWhIndex(p.warehouse_id) 
              : getWhIndex(p.warehouse_name);
            const q = Number(p.quantity ?? p.qty ?? 0) || 0;
            if (idx >= 1 && idx <= 6 && q > 0) {
              qtyCounts[idx] += q;
            }
          }
        });

        // 2. Process stock balances from /api/stock if warehouse counts are not yet populated
        if (Object.values(qtyCounts).every((v) => v === 0) && balances.length > 0) {
          balances.forEach((item: any) => {
            if (Array.isArray(item.by_warehouse) && item.by_warehouse.length > 0) {
              item.by_warehouse.forEach((entry: any) => {
                const idx = getWhIndex(entry.warehouse_id) !== -1 
                  ? getWhIndex(entry.warehouse_id) 
                  : getWhIndex(entry.warehouse_name);
                const entryQ = Number(entry.quantity ?? entry.qty ?? entry.total) || 0;
                if (idx >= 1 && idx <= 6 && entryQ > 0) {
                  qtyCounts[idx] += entryQ;
                }
              });
            }
          });
        }

        const totalWarehouseQty = Object.values(qtyCounts).reduce((acc, curr) => acc + curr, 0);

        setWarehouseQtyMap(qtyCounts);
        setPendingDocs(pending);
        setRecentMovements(movements);
        setLowStockItems(balances.filter((item: any) => item.status === "LOW" || item.status === "OUT" || item.status === "NEGATIVE"));
        setStats({
          totalProducts: totalWarehouseQty > 0
            ? totalWarehouseQty
            : products.reduce((acc: number, p: any) => acc + (Number(p.quantity ?? p.qty ?? 0) || 0), 0),
          pendingApprovals: pending.length,
          activeWarehouses: 6,
          totalMovements: movRes.data?.total || movements.length || 0,
          lowStockCount: balances.filter((item: { status?: string }) => item.status === "LOW").length,
          outOfStockCount: balances.filter((item: { status?: string }) => item.status === "OUT" || item.status === "NEGATIVE").length,
        });
      } catch (error) {
        console.error("Admin dashboard fetch error:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const normalStock = Math.max(0, stats.totalProducts - stats.lowStockCount - stats.outOfStockCount);
  const percent = (count: number) => (stats.totalProducts ? `${(count / stats.totalProducts) * 100}%` : "0%");

  const warehouseList = [
    { id: 1, name: "โกดัง 1" },
    { id: 2, name: "โกดัง 2" },
    { id: 3, name: "โกดัง 3" },
    { id: 4, name: "โกดัง 4" },
    { id: 5, name: "โกดัง 5" },
    { id: 6, name: "สำนักงานใหญ่" },
  ];

  const chartData = warehouseList.map((wh) => {
    const qty = warehouseQtyMap[wh.id] ?? 0;
    return {
      name: wh.name,
      "จำนวนสินค้า": qty,
      quantity: qty,
    };
  });

  return (
    <div className="admin-dashboard min-h-full bg-[#f4f6f8] w-full max-w-full space-y-6">
      <div className="w-full space-y-6 fade-in">
        {/* Top 4 Stat Cards Grid (Fluid 1/2/4 Columns) */}
        <section className="w-full">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4 w-full">
            <StatCard
              label="รายการรออนุมัติ"
              value={stats.pendingApprovals}
              href="/approvals"
              loading={loading}
              color="emerald"
              bars={[35, 50, 30, 65, 95, 75, 100]}
            />
            <StatCard
              label="สินค้าทั้งหมด"
              value={stats.totalProducts}
              href="/products"
              loading={loading}
              color="cyan"
              bars={[45, 70, 85, 55, 75, 100, 90]}
            />
            <StatCard
              label="คลังที่ใช้งาน"
              value={stats.activeWarehouses}
              href="/locations"
              loading={loading}
              color="indigo"
              bars={[60, 75, 65, 90, 85, 80, 100]}
            />
            <StatCard
              label="การเคลื่อนไหวทั้งหมด"
              value={stats.totalMovements}
              href="/movements/history"
              loading={loading}
              color="orange"
              bars={[50, 70, 90, 60, 100, 85, 95]}
            />
          </div>
        </section>

        {/* 2-Column Responsive Layout: Left 65% (Chart & Warehouse Summary) | Right 35% (Recent Movements & Alerts) */}
        <div className="flex flex-col lg:flex-row gap-5 lg:gap-6 items-stretch w-full">
          {/* Left Column: Warehouse Inventory Chart & Summary Panel (65% width) */}
          <section className="admin-panel p-5 sm:p-6 lg:p-7 w-full lg:w-[65%] shrink-0 flex flex-col justify-between">
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_190px] xl:grid-cols-[minmax(0,1fr)_220px] items-stretch">
              <div>
                <div className="mb-4 flex items-end justify-between">
                  <div>
                    <p className="admin-eyebrow">สรุปตามคลังสินค้า</p>
                    <h2 className="admin-panel-title text-base sm:text-lg">ปริมาณสินค้าแยกตามโกดัง 1 - 5</h2>
                  </div>
                  <div className="hidden items-center gap-2 text-xs font-bold text-emerald-700 sm:flex">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    หน่วย: ชิ้น
                  </div>
                </div>

                <div className="h-72 sm:h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 12, right: 12, left: -15, bottom: 0 }} barCategoryGap="20%">
                      <CartesianGrid vertical={false} stroke="#cbd5e1" strokeDasharray="4 4" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#334155", fontSize: 11, fontWeight: 700 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#475569", fontSize: 11, fontWeight: 600 }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(226, 232, 240, 0.5)" }}
                        contentStyle={{
                          backgroundColor: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "600",
                          boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)",
                          padding: "8px 12px",
                        }}
                        formatter={(val: any) => [`${Number(val).toLocaleString()} ชิ้น`, "จำนวนสินค้าคงเหลือ"]}
                      />
                      <Bar
                        dataKey="จำนวนสินค้า"
                        radius={[8, 8, 0, 0]}
                        maxBarSize={44}
                      >
                        {chartData.map((entry, index) => {
                          const colors = ["#10b981", "#06b6d4", "#6366f1", "#f59e0b", "#8b5cf6"];
                          return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Side Summary List */}
              <div className="border-t border-slate-300 pt-5 md:border-l-2 md:border-slate-300 md:border-t-0 md:pl-6 md:pt-0 flex flex-col justify-between">
                <div>
                  <p className="mb-4 text-sm font-extrabold text-slate-900">สรุปจำนวนสินค้าแต่ละคลัง</p>
                  <div className="space-y-3">
                    {chartData.map((item) => (
                      <div key={item.name} className="flex items-center justify-between gap-3 text-sm py-2 border-b border-slate-200 last:border-0">
                        <span className="truncate font-bold text-slate-800">{item.name}</span>
                        <span className="font-mono text-xs font-extrabold text-emerald-700">
                          {item["จำนวนสินค้า"].toLocaleString()} <span className="font-sans font-normal text-slate-500">ชิ้น</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Right Column: Recent Activity Feed & Stock Alerts (Remaining 35%) */}
          <div className="w-full lg:flex-1 min-w-0 space-y-6 flex flex-col justify-between">
            {/* Card 1: Recent Movements Activity Feed */}
            <div className="admin-panel p-5 sm:p-6 bg-white rounded-2xl border border-slate-200/90 shadow-sm">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center font-bold text-sm border border-orange-100">
                    ⚡
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 leading-tight">กิจกรรมการเคลื่อนไหวล่าสุด</h3>
                    <p className="text-[11px] text-slate-500">ความเคลื่อนไหวสินค้าเรียลไทม์</p>
                  </div>
                </div>
                <Link
                  href="/movements/history"
                  className="text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-1"
                >
                  ดูประวัติทั้งหมด →
                </Link>
              </div>

              {recentMovements.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs font-medium">
                  ยังไม่มีประวัติการเคลื่อนไหวในระบบ
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {recentMovements.slice(0, 4).map((mov: any, idx: number) => {
                    const isPositive = Number(mov.qty_change) > 0;
                    const typeLabel =
                      mov.movement_type === "RECEIVE"
                        ? "รับเข้า"
                        : mov.movement_type === "ISSUE" || mov.movement_type === "ISSUE_OUT"
                        ? "เบิกออก"
                        : mov.movement_type === "TRANSFER" || mov.movement_type === "TRANSFER_IN" || mov.movement_type === "TRANSFER_OUT"
                        ? "ย้ายโกดัง"
                        : "จัดตำแหน่ง";

                    const badgeStyle =
                      mov.movement_type === "RECEIVE"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : mov.movement_type === "ISSUE" || mov.movement_type === "ISSUE_OUT"
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : mov.movement_type === "TRANSFER" || mov.movement_type === "TRANSFER_IN" || mov.movement_type === "TRANSFER_OUT"
                        ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                        : "bg-teal-50 text-teal-700 border-teal-200";

                    return (
                      <div key={`mov-${mov.movement_id || idx}`} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${badgeStyle}`}>
                            {typeLabel}
                          </span>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 truncate">
                              {mov.sku || mov.product_name || "สินค้า"}
                              {mov.product_name && mov.sku ? (
                                <span className="text-slate-500 font-normal ml-1.5 text-[11px] truncate">
                                  {mov.product_name}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-[10px] text-slate-400 font-medium truncate flex items-center gap-1.5 mt-0.5">
                              <span>{mov.warehouse_name || "คลังสินค้า"}</span>
                              {mov.location_code && <span>• ตำแหน่ง {mov.location_code}</span>}
                              {mov.created_by_name && <span>• โดย {mov.created_by_name}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span
                            className={`font-mono font-bold text-xs ${
                              isPositive ? "text-emerald-600" : "text-slate-800"
                            }`}
                          >
                            {isPositive ? `+${Number(mov.qty_change).toLocaleString()}` : Number(mov.qty_change).toLocaleString()}
                          </span>
                          <div className="text-[10px] text-slate-400">
                            {formatRelativeTime(mov.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Card 2: Low Stock Alert & Pending Approvals */}
            <div className="admin-panel p-5 sm:p-6 bg-white rounded-2xl border border-slate-200/90 shadow-sm">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold text-sm border border-rose-100">
                    ⚠️
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 leading-tight">แจ้งเตือนสต็อก & งานสำคัญ</h3>
                    <p className="text-[11px] text-slate-500">สินค้าใกล้หมด และ เอกสารรออนุมัติ</p>
                  </div>
                </div>
                {stats.pendingApprovals > 0 ? (
                  <Link
                    href="/approvals"
                    className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold hover:bg-amber-100 transition-colors"
                  >
                    รออนุมัติ {stats.pendingApprovals} รายการ
                  </Link>
                ) : (
                  <Link
                    href="/products"
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline"
                  >
                    ดูสินค้าทั้งหมด →
                  </Link>
                )}
              </div>

              {lowStockItems.length === 0 && pendingDocs.length === 0 ? (
                <div className="py-6 flex flex-col items-center justify-center text-center space-y-1 text-slate-500">
                  <span className="text-2xl">✅</span>
                  <p className="text-xs font-bold text-slate-700">สินค้าและเอกสารทั้งหมดอยู่ในเกณฑ์ปกติ</p>
                  <p className="text-[11px] text-slate-400">ไม่มีสินค้าที่สต็อกต่ำกว่าเกณฑ์ขั้นต่ำในขณะนี้</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {/* Pending Docs preview if any */}
                  {pendingDocs.slice(0, 2).map((doc) => (
                    <Link
                      key={`pend-${doc.document_id || doc.document_no}`}
                      href="/approvals"
                      className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 flex items-center justify-between hover:bg-amber-50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-amber-900 text-xs flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          เอกสารรออนุมัติ: {doc.document_no}
                        </div>
                        <div className="text-[10px] text-amber-700 mt-0.5 truncate">
                          {doc.target_sheet} • {doc.rows?.length || 0} รายการ
                        </div>
                      </div>
                      <span className="text-xs font-bold text-amber-800 shrink-0">กดอนุมัติ →</span>
                    </Link>
                  ))}

                  {/* Low Stock Items preview */}
                  {lowStockItems.slice(0, 3).map((item: any, i: number) => (
                    <div
                      key={`low-${item.product_id || item.sku || i}`}
                      className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-bold text-slate-800 truncate">
                          <span className="font-mono text-emerald-700 mr-1.5">{item.sku}</span>
                          {item.product_name}
                        </div>
                        <div className="text-[10px] text-rose-600 font-bold mt-0.5">
                          คงเหลือ: {Number(item.total_quantity || 0).toLocaleString()} {item.base_unit || "ชิ้น"} (ขั้นต่ำ: {item.minimum_stock || 0})
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200 shrink-0">
                        {item.status === "OUT" ? "สินค้าหมด" : "ใกล้หมด"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>


      </div>
    </div>
  );
}

function MiniBarChart({ bars, barColorClass }: { bars: number[]; barColorClass: string }) {
  return (
    <div className="flex items-end gap-[3px] h-9 w-14 shrink-0 pb-0.5">
      {bars.map((heightPct, idx) => {
        const opacity = idx >= bars.length - 2 ? 1 : 0.4 + idx * 0.09;
        return (
          <span
            key={idx}
            className={`w-[6px] rounded-full transition-all duration-300 ${barColorClass}`}
            style={{
              height: `${Math.max(18, heightPct)}%`,
              opacity: opacity,
            }}
          />
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  loading,
  color,
  bars,
}: {
  label: string;
  value: number;
  href: string;
  loading: boolean;
  color: "emerald" | "cyan" | "indigo" | "orange";
  bars: number[];
}) {
  const colorMap = {
    emerald: "bg-emerald-500",
    cyan: "bg-cyan-500",
    indigo: "bg-indigo-500",
    orange: "bg-orange-500",
  };

  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl bg-white p-5 shadow-md shadow-slate-200/80 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-300/70 sm:p-6"
    >
      <p className="text-sm font-semibold text-slate-600 mb-3">{label}</p>

      <div className="flex items-center justify-between gap-3">
        <p className={`text-3xl font-extrabold tracking-tight text-slate-950 tabular-nums ${loading ? "animate-pulse text-slate-200" : ""}`}>
          {loading ? "—" : value.toLocaleString()}
        </p>
        <MiniBarChart bars={bars} barColorClass={colorMap[color]} />
      </div>
    </Link>
  );
}

function QuickAction({ href, label, detail, icon }: { href: string; label: string; detail: string; icon: React.ReactNode }) {
  return <Link href={href} className="group flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 group-hover:bg-emerald-100 group-hover:text-emerald-700">{icon}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">{label}</p><p className="truncate text-xs text-slate-500">{detail}</p></div><span className="text-slate-400 group-hover:text-emerald-700"><ArrowIcon /></span></Link>;
}

function StockProgress({ label, count, total, color, value }: { label: string; count: number; total: number; color: string; value: string }) {
  return <div><div className="mb-2 flex items-center justify-between text-sm"><span className="text-slate-600">{label}</span><span className="font-mono font-semibold text-slate-900">{count} <span className="font-sans font-normal text-slate-400">/ {total}</span></span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: value }} /></div></div>;
}

function ArrowIcon() { return <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>; }
function ApprovalIcon() { return <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
function BoxIcon() { return <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m20 7-8 4-8-4m16 0-8-4-8 4m16 0v10l-8 4m0-10L4 7m8 4v10" /></svg>; }
function WarehouseIcon() { return <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M9 10h.01M15 10h.01" /></svg>; }
function HistoryIcon() { return <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2" /></svg>; }
function CheckIcon() { return <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m5 13 4 4L19 7" /></svg>; }
function DocumentIcon() { return <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h5" /></svg>; }
function ReceiveIcon() { return <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0-5 5m5-5 5 5M5 21h14" /></svg>; }
function IssueIcon() { return <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m0 0 5-5m-5 5-5-5M5 3h14" /></svg>; }
function MoveIcon() { return <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h13m0 0-4-4m4 4-4 4M17 17H4m0 0 4 4m-4-4 4-4" /></svg>; }

function formatRelativeTime(dateStr?: string) {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "เมื่อสักครู่";
    if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} ชม. ที่แล้ว`;
    return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
}

