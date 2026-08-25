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
import { getWarehouseName } from "@/lib/warehouse-utils";
import {
  parseTransferMetadata,
  getDisplayProductName,
  isTransferCompleted,
  getTransferNotifications,
} from "@/lib/transfer-notification-utils";

interface TransferItem {
  id: string;
  document_no: string;
  product_name: string;
  sku: string;
  from_warehouse_name: string;
  to_warehouse_name: string;
  qty: number;
  base_unit: string;
  moved_by: string;
  status: string;
  created_at: string;
}

export default function AdminDashboard() {
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
  const [recentTransfers, setRecentTransfers] = useState<TransferItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [appRes, prodRes, stockRes, movRes, trfRes] = await Promise.all([
          fetch("/api/approvals").then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/products").then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/stock").then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/movements?limit=10").then((r) => r.json()).catch(() => ({ data: { items: [], total: 0 } })),
          fetch(`/api/movements/transfer?_t=${Date.now()}`).then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
        ]);

        const pending = Array.isArray(appRes.data) ? appRes.data : [];
        const products = Array.isArray(prodRes.data)
          ? prodRes.data
          : Array.isArray(prodRes.data?.items)
          ? prodRes.data.items
          : [];
        const balances = Array.isArray(stockRes.data) ? stockRes.data : [];
        const movements = Array.isArray(movRes.data?.items)
          ? movRes.data.items
          : Array.isArray(movRes.data)
          ? movRes.data
          : [];
        const rawTransfers = Array.isArray(trfRes.data) ? trfRes.data : [];

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

        // 1. Process product quantities directly from /api/products
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

        // 3. Process Transfer / Issue History records
        const prodMapBySku = new Map<string, any>();
        const prodMapById = new Map<string, any>();
        products.forEach((p: any) => {
          if (p.sku) prodMapBySku.set(p.sku.trim().toLowerCase(), p);
          if (p.product_id) prodMapById.set(p.product_id.trim().toLowerCase(), p);
        });

        const docMap = new Map<string, TransferItem>();

        for (const doc of rawTransfers) {
          if (!doc) continue;
          const docId = String(doc.document_id || doc.document_no || "").trim();
          if (!docId) continue;

          const meta = parseTransferMetadata(doc.note);
          const rawProdId = String(meta.product_id || doc.product_id || "").trim();
          const rawSku = String(meta.sku || doc.sku || (rawProdId.startsWith("prod-") ? rawProdId.replace(/^prod-/, "") : "")).trim();
          const matchedProd = (rawSku ? prodMapBySku.get(rawSku.toLowerCase()) : undefined) ||
                              (rawProdId ? prodMapById.get(rawProdId.toLowerCase()) : undefined);

          const sku = rawSku || matchedProd?.sku || "-";
          const productName = getDisplayProductName({
            product_name: String(meta.product_name || doc.product_name || matchedProd?.product_name || (sku !== "-" ? `สินค้า ${sku}` : "รายการเบิกสินค้า")),
            note: doc.note,
            sku,
          });

          const fromWh = getWarehouseName(meta.from_warehouse_id || doc.from_warehouse_id || "wh-01");
          const toWh = getWarehouseName(meta.to_warehouse_id || doc.to_warehouse_id || "wh-02");
          const qty = Number(meta.qty ?? doc.qty ?? 1);
          const unit = String(meta.base_unit || doc.base_unit || matchedProd?.base_unit || "ชิ้น");
          const movedBy = String(meta.moved_by || meta.assigned_to_name || doc.assigned_to_name || doc.moved_by || meta.created_by_name || doc.created_by_name || "แอดมิน").trim();
          const createdAt = String(doc.created_at || meta.created_at || new Date().toISOString());

          let status = String(doc.status || meta.status || "PENDING").trim().toUpperCase();
          if (isTransferCompleted(docId) || isTransferCompleted(doc.document_no) || status === "APPROVED" || status === "DONE" || status === "SUCCESS" || status === "สำเร็จ") {
            status = "COMPLETED";
          } else if (status === "WAITING_APPROVAL" || status === "WAITING" || status === "รออนุมัติ") {
            status = "WAITING_APPROVAL";
          } else if (status === "CANCELLED" || status === "CANCEL" || status === "REJECTED" || status === "ยกเลิก") {
            status = "CANCELLED";
          } else {
            status = "PENDING";
          }

          docMap.set(docId.toLowerCase(), {
            id: docId,
            document_no: doc.document_no || docId,
            product_name: productName,
            sku,
            from_warehouse_name: fromWh,
            to_warehouse_name: toWh,
            qty,
            base_unit: unit,
            moved_by: movedBy || "พนักงาน",
            status,
            created_at: createdAt,
          });
        }

        // Add local notifications if any
        const localNotifs = getTransferNotifications();
        for (const n of localNotifs) {
          const nId = String(n.doc_no || n.id || "").trim();
          if (!nId) continue;
          if (!docMap.has(nId.toLowerCase())) {
            docMap.set(nId.toLowerCase(), {
              id: nId,
              document_no: n.doc_no || nId,
              product_name: n.product_name || "รายการเบิกสินค้า",
              sku: n.sku || "-",
              from_warehouse_name: n.from_warehouse_name || getWarehouseName(n.from_warehouse_id),
              to_warehouse_name: n.to_warehouse_name || getWarehouseName(n.to_warehouse_id),
              qty: n.qty || 1,
              base_unit: "ชิ้น",
              moved_by: n.moved_by || n.assigned_to_name || n.created_by_name || "พนักงาน",
              status: n.status || "PENDING",
              created_at: n.created_at || new Date().toISOString(),
            });
          }
        }

        const sortedTransfers = Array.from(docMap.values()).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        setRecentTransfers(sortedTransfers);
        setWarehouseQtyMap(qtyCounts);
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
        {/* Top 3 Stat Cards Grid (Fluid 1/3 Columns) */}
        <section className="w-full">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4 w-full">
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
              label="การเคลื่อนไหวทั้งหมด"
              value={stats.totalMovements}
              href="/movements/history"
              loading={loading}
              color="orange"
              bars={[50, 70, 90, 60, 100, 85, 95]}
            />
          </div>
        </section>

        {/* 2-Column Responsive Layout: Left 60% (Chart & Warehouse Summary) | Right 40% (Warehouse Summary Details) */}
        <div className="flex flex-col lg:flex-row gap-5 lg:gap-6 items-stretch w-full">
          {/* Left Column: Warehouse Inventory Chart & Summary Panel (60% width) */}
          <section className="admin-panel p-5 sm:p-6 lg:p-7 w-full lg:w-[60%] shrink-0 flex flex-col justify-between">
            <div>
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <p className="admin-eyebrow">สรุปตามคลังสินค้า</p>
                  <h2 className="admin-panel-title text-base sm:text-lg">ปริมาณสินค้าแยกตามคลังสินค้า</h2>
                </div>
                <div className="hidden items-center gap-2 text-xs font-bold text-emerald-700 sm:flex">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  หน่วย: ชิ้น
                </div>
              </div>

              <div className="h-72 sm:h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 12, right: 12, left: 10, bottom: 20 }} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke="#cbd5e1" strokeDasharray="4 4" />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      tick={{ fill: "#334155", fontSize: 12, fontWeight: 700 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#475569", fontSize: 11, fontWeight: 600 }}
                      tickFormatter={(val) => {
                        if (val >= 1000000) return `${(val / 1000000).toFixed(val % 1000000 === 0 ? 0 : 1)}M`;
                        if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
                        return val;
                      }}
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
                      maxBarSize={56}
                    >
                      {chartData.map((entry, index) => {
                        const colors = ["#10b981", "#06b6d4", "#6366f1", "#f59e0b", "#8b5cf6", "#ec4899"];
                        return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Right Column: Warehouse Inventory Summary (40% width) */}
          <div className="w-full lg:flex-1 min-w-0 flex flex-col">
            {/* Card 1: Warehouse Inventory Summary for All Warehouses */}
            <div className="admin-panel p-5 sm:p-6 lg:p-7 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex-1 flex flex-col justify-between">
              <div className="mb-3 pb-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 leading-tight">
                    ข้อมูลสินค้าในโกดังทุกโกดัง
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">ภาพรวมสต็อกแยกตามคลัง</p>
                </div>
                <span className="text-[11px] font-bold text-slate-400 bg-slate-50 border border-slate-200 px-2.5 py-0.5 rounded-full">
                  6 คลัง
                </span>
              </div>

              <div className="divide-y divide-slate-100 flex-1 flex flex-col justify-between">
                {chartData.map((item, index) => {
                  const colors = ["#10b981", "#06b6d4", "#6366f1", "#f59e0b", "#8b5cf6", "#ec4899"];
                  const barColor = colors[index % colors.length];
                  const itemQty = item["จำนวนสินค้า"] || 0;

                  return (
                    <div key={item.name} className="py-3.5 sm:py-4 flex items-center justify-between text-xs flex-1 first:pt-1 last:pb-1">
                      <span className="flex items-center gap-2.5 font-bold text-slate-800">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: barColor }}
                        />
                        <span>{item.name}</span>
                      </span>
                      <div className="flex items-center gap-1.5 font-mono">
                        <span className="font-extrabold text-slate-900 text-xs">
                          {itemQty.toLocaleString()}
                        </span>
                        <span className="text-xs text-slate-500 font-sans font-normal">
                          ชิ้น
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Section: Recent Transfer / Issue History (ประวัติการเบิกสินค้า) */}
        <section className="admin-panel p-5 sm:p-6 lg:p-7 bg-white rounded-2xl border border-slate-200/90 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <h2 className="admin-panel-title text-base sm:text-lg">ประวัติการเบิกสินค้าล่าสุด</h2>
                <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full ml-1">
                  เบิก & โอนย้าย
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                รายการเบิกและโอนสินค้าระหว่างโกดังที่มีการเคลื่อนไหวล่าสุด
              </p>
            </div>
            <Link
              href="/movements/transfer/history"
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1 shrink-0"
            >
              ดูประวัติการเบิกทั้งหมด →
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 bg-slate-50 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : recentTransfers.length === 0 ? (
            <div className="py-10 text-center flex flex-col items-center justify-center space-y-2 text-slate-400">
              <span className="text-3xl">📦</span>
              <p className="text-xs font-bold text-slate-600">ยังไม่มีรายการเบิกสินค้าในระบบ</p>
              <Link
                href="/movements/transfer"
                className="mt-2 text-xs font-bold text-indigo-600 hover:underline"
              >
                + ทำรายการเบิกสินค้า
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2 sm:mx-0">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-3 pr-4 font-bold text-slate-500">เลขที่เอกสาร</th>
                    <th className="pb-3 px-4 font-bold text-slate-500">สินค้า</th>
                    <th className="pb-3 px-4 font-bold text-slate-500">เส้นทางการเบิก</th>
                    <th className="pb-3 px-4 text-right font-bold text-slate-500">จำนวน</th>
                    <th className="pb-3 px-4 font-bold text-slate-500">ผู้ทำรายการ</th>
                    <th className="pb-3 px-4 font-bold text-slate-500">วันที่ / เวลา</th>
                    <th className="pb-3 pl-4 text-right font-bold text-slate-500">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentTransfers.slice(0, 6).map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors group">
                      <td className="py-3.5 pr-4">
                        <Link
                          href="/movements/transfer/history"
                          className="font-mono font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1.5"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 group-hover:scale-125 transition-transform" />
                          {item.document_no}
                        </Link>
                      </td>
                      <td className="py-3.5 px-4 max-w-[200px]">
                        <div className="font-bold text-slate-900 truncate" title={item.product_name}>
                          {item.product_name}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {item.sku}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                            {item.from_warehouse_name}
                          </span>
                          <span className="text-slate-400">→</span>
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                            {item.to_warehouse_name}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <span className="font-mono font-extrabold text-slate-900 text-xs">
                          {Number(item.qty).toLocaleString()}
                        </span>
                        <span className="text-slate-500 font-sans ml-1 text-[11px]">
                          {item.base_unit || "ชิ้น"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">
                            {item.moved_by?.slice(0, 1) || "U"}
                          </div>
                          <span className="truncate max-w-[100px]">{item.moved_by || "พนักงาน"}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap text-[11px]">
                        {formatThaiDate(item.created_at)}
                      </td>
                      <td className="py-3.5 pl-4 text-right whitespace-nowrap">
                        {renderStatusBadge(item.status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

function formatThaiDate(dateStr?: string) {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function renderStatusBadge(status?: string) {
  const s = String(status || "").toUpperCase();
  if (s === "COMPLETED" || s === "APPROVED" || s === "SUCCESS" || s === "DONE" || s === "สำเร็จ") {
    return (
      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        สำเร็จ
      </span>
    );
  }
  if (s === "WAITING_APPROVAL" || s === "WAITING" || s === "รออนุมัติ") {
    return (
      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
        รออนุมัติ
      </span>
    );
  }
  if (s === "CANCELLED" || s === "CANCEL" || s === "REJECTED" || s === "ยกเลิก") {
    return (
      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
        ยกเลิก
      </span>
    );
  }
  return (
    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
      รอดำเนินการ
    </span>
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
