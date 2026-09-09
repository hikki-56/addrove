"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardStats, TodayActivity } from "@/types/models";
import { useCountUpText } from "@/hooks/use-count-up";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { buildKpiCards, type KpiNumbers } from "../_lib/kpi-cards";
import {
  buildWarehouseDonut,
  type WarehouseDonutSlice,
} from "../_lib/warehouse-distribution";
import {
  ALL_ACTORS_VALUE,
  buildActorOptions,
  filterActivitiesByActor,
  type ActivityActorOption,
} from "../_lib/today-activities";

/* ── Inline SVG icons (lucide paths — ตามกติกา stockify-ui ไม่ติดตั้ง icon library) ── */
function Icon({ children, className = "size-5" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const PackageIcon = ({ className }: { className?: string }) => (
  <Icon className={className}><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12" /><path d="m3.3 7 8.7 5 8.7-5" /></Icon>
);
const ArrowDownIcon = ({ className }: { className?: string }) => (
  <Icon className={className}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Icon>
);
const ArrowUpIcon = ({ className }: { className?: string }) => (
  <Icon className={className}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Icon>
);
const FactoryIcon = ({ className }: { className?: string }) => (
  <Icon className={className}><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M17 18h1" /><path d="M12 18h1" /><path d="M7 18h1" /></Icon>
);
const TriangleAlertIcon = ({ className }: { className?: string }) => (
  <Icon className={className}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></Icon>
);
const ArrowRightIcon = ({ className }: { className?: string }) => (
  <Icon className={className}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Icon>
);

type Timeframe = "7d" | "30d" | "90d";

// รายการรออนุมัติที่แสดงในกล่อง — ดึงจาก /api/approvals?status=PENDING
interface PendingApprovalDoc {
  document_id: string;
  document_no: string;
  target_sheet?: string;
  created_at?: string;
}

interface ApprovalApiResponse {
  success?: boolean;
  data?: PendingApprovalDoc[];
}

const TIMEFRAME_DAYS: Record<Timeframe, number> = { "7d": 7, "30d": 30, "90d": 90 };

// อ้างอิง array ว่างคงที่ — กัน dependency ของ useMemo เปลี่ยนทุก render ตอนยังไม่มีข้อมูล
const EMPTY_ACTIVITIES: TodayActivity[] = [];

/* ── กราฟเคลื่อนไหว 3 ชุด: รับเข้า (เขียว) / เบิกสินค้า (แดง) / ผลิต (ม่วง) ── */
const CHART_SERIES_META = [
  { key: "received", label: "รับเข้า", color: "#06402B" },
  { key: "issued", label: "เบิกสินค้า", color: "#B42318" },
  { key: "produced", label: "ผลิต", color: "#7A5AF8" },
] as const;

function badgeForActivity(actionType: TodayActivity["action_type"]): string {
  switch (actionType) {
    case "RECEIVE":
      return "bg-[#EAF2EE] text-[#06402B]";
    case "ISSUE":
      return "bg-[#FCEFED] text-[#B42318]";
    case "TRANSFER":
      return "bg-[#EFF8FF] text-[#175CD3]";
    case "PRODUCTION":
      return "bg-[#F4F3FF] text-[#5925DC]";
    default:
      return "bg-[#F3F6F4] text-[#475467]";
  }
}

function parseDateSafe(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

// เวลาทำรายการแสดงตามเขตเวลา Asia/Bangkok เสมอ ไม่ขึ้นกับเขตเวลาเครื่องผู้ใช้
function formatTimeThai(d: Date): string {
  return (
    d.toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Bangkok",
    }) + " น."
  );
}

function formatDateThai(d: Date): string {
  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [pendingAll, setPendingAll] = useState<PendingApprovalDoc[]>([]);
  const [approvalsFailed, setApprovalsFailed] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>("30d");
  const [actorFilter, setActorFilter] = useState<string>(ALL_ACTORS_VALUE);
  // เวลาที่โหลดข้อมูลสำเร็จ — ใช้คำนวณอายุรายการรออนุมัติแทนการเรียก Date.now() ระหว่าง render
  const [loadedAt, setLoadedAt] = useState<number>(0);

  // ตัวเลขวิ่ง count-up เมื่อโหลดข้อมูลเสร็จและไม่มี error — กันเลข 0 หลอกตอนโหลดไม่สำเร็จ
  const kpiActive = !loading && !dashError && stats !== null;
  const kpiRemainingRef = useCountUpText(stats?.total_remaining_quantity ?? 0, kpiActive, 900);
  const kpiReceivedRef = useCountUpText(stats?.received_today ?? 0, kpiActive);
  const kpiIssuedRef = useCountUpText(stats?.issued_today ?? 0, kpiActive);
  const kpiProducedRef = useCountUpText(stats?.produced_today ?? 0, kpiActive);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, apprRes] = await Promise.all([
        fetch("/api/dashboard?days=90", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
        fetch("/api/approvals?status=PENDING", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null),
      ]);

      // API แจ้ง error (เช่น Google Sheets อ่านไม่ได้) → แสดงสถานะโหลดไม่สำเร็จ
      // ไม่ปล่อยให้หน้าเว็บเงียบแล้วโชว์ 0 จนเข้าใจผิดว่าหมดสต็อกทั้งหมด
      if (!dashRes || dashRes.success !== true) {
        setStats(null);
        setDashError(
          dashRes?.message || "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อโหลดข้อมูล Dashboard ได้"
        );
      } else {
        setStats(dashRes.data as DashboardStats);
        setDashError(null);
      }

      const appr = (apprRes as ApprovalApiResponse | null) ?? null;
      if (appr && appr.success === true) {
        setApprovalsFailed(false);
        setPendingAll(Array.isArray(appr.data) ? appr.data : []);
      } else {
        // ตัวเลขรวม fallback จาก pending_approval_count ของ Dashboard API
        setApprovalsFailed(true);
        setPendingAll([]);
      }
      setLoadedAt(Date.now());
    } catch (error) {
      console.error("Admin dashboard fetch error:", error);
      setStats(null);
      setDashError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อโหลดข้อมูล Dashboard ได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleQuickAction = async (doc: PendingApprovalDoc, action: "approve" | "reject") => {
    if (approvingId || leavingId) return;
    if (action === "reject" && !window.confirm("ยืนยันปฏิเสธรายการรับสินค้านี้?")) return;
    setApprovingId(doc.document_id);
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(doc.document_id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      if (res.ok) {
        setLeavingId(doc.document_id);
        window.setTimeout(() => {
          setPendingAll((prev) => prev.filter((d) => d.document_id !== doc.document_id));
        }, 320);
      }
    } catch {
      // ให้ผู้ใช้กดใหม่
    } finally {
      setApprovingId(null);
    }
  };

  /* ── Derived data ─────────────────────────────────────────── */

  // KPI — server คำนวณจาก Google Sheets + Documents + StockMovements ทั้งหมดแล้ว
  const kpiNumbers: KpiNumbers = {
    totalRemaining: stats?.total_remaining_quantity ?? 0,
    receivedToday: stats?.received_today ?? 0,
    receivedDocumentCountToday: stats?.received_document_count_today ?? 0,
    issuedToday: stats?.issued_today ?? 0,
    issuedDocumentCountToday: stats?.issued_document_count_today ?? 0,
    producedToday: stats?.produced_today ?? 0,
    productionOrderCountToday: stats?.production_order_count_today ?? 0,
  };
  const kpiCards = buildKpiCards(kpiNumbers);
  const kpiCardMeta = [
    { icon: PackageIcon, hero: true, valueRef: kpiRemainingRef },
    { icon: ArrowDownIcon, hero: false, valueRef: kpiReceivedRef },
    { icon: ArrowUpIcon, hero: false, valueRef: kpiIssuedRef },
    { icon: FactoryIcon, hero: false, valueRef: kpiProducedRef },
  ];
  const kpis = kpiCards.map((card, i) => ({
    ...card,
    icon: kpiCardMeta[i].icon,
    hero: kpiCardMeta[i].hero,
    valueRef: kpiCardMeta[i].valueRef,
  }));

  // กราฟโดนัท — ใช้ผลรวม "จำนวนคงเหลือ" ชุดเดียวกับการ์ด "สินค้าทั้งหมด" (warehouse_distribution)
  const donut = useMemo(
    () => buildWarehouseDonut(stats?.warehouse_distribution),
    [stats?.warehouse_distribution]
  );

  // กราฟรายวัน (รับเข้า/เบิก/ผลิต) — server เติมวันที่ 90 วันให้ครบ สลับช่วงเวลาฝั่ง client
  const chartData = useMemo(() => {
    const rows = stats?.chart_data ?? [];
    return rows.map((c) => ({
      label: `${Number(c.date.slice(8, 10))}/${Number(c.date.slice(5, 7))}`,
      received: c.received,
      issued: c.issued,
      produced: c.produced,
    }));
  }, [stats?.chart_data]);
  const visibleChart = chartData.slice(-TIMEFRAME_DAYS[timeframe]);

  // กิจกรรมวันนี้ + ตัวกรองผู้ทำรายการ (client กรองเองจากข้อมูลที่ server ส่งมา)
  const todayActivities = stats?.today_activities ?? EMPTY_ACTIVITIES;
  const actorOptions = useMemo(() => buildActorOptions(todayActivities), [todayActivities]);
  // ตัวกรองที่เลือกหายไปจากรายชื่อ (ข้อมูลใหม่) → กลับไป "ทุกคน" กัน select ว่าง
  const effectiveActorFilter = actorOptions.some((o) => o.id === actorFilter)
    ? actorFilter
    : ALL_ACTORS_VALUE;
  const visibleActivities = useMemo(
    () => filterActivitiesByActor(todayActivities, effectiveActorFilter),
    [todayActivities, effectiveActorFilter]
  );

  // รายการรออนุมัติ — badge ใช้ยอดรวมก่อน slice, กล่องแสดง 3 รายการที่รอนานที่สุด (เก่าสุดก่อน)
  const pendingTotal = approvalsFailed
    ? (stats?.pending_approval_count ?? 0)
    : pendingAll.length;
  const oldestPending = useMemo(
    () =>
      [...pendingAll]
        .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
        .slice(0, 3),
    [pendingAll]
  );

  return (
    <div className="w-full max-w-full space-y-6 lg:space-y-8">
      {/* สถานะโหลดข้อมูลไม่สำเร็จ — แจ้งผู้ใช้แทนการแสดง 0 ที่ทำให้เข้าใจผิด */}
      {!loading && dashError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-[#F2C4BC] bg-[#FCEFED] p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-[#B42318]" />
            <div>
              <p className="text-sm font-semibold text-[#B42318]">โหลดข้อมูล Dashboard ไม่สำเร็จ</p>
              <p className="mt-0.5 text-[13px] text-[#912018]">
                {dashError} — ตัวเลขด้านล่างอาจไม่ครบถ้วน ไม่ใช่ข้อมูลจริงทั้งหมด
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="shrink-0 self-start rounded-lg bg-[#B42318] px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#912018] cursor-pointer sm:self-auto"
          >
            ลองโหลดอีกครั้ง
          </button>
        </div>
      )}

      {/* KPI — 4 ใบ/แถวตั้งแต่ lg (โน้ตบุ๊ตทุกรุ่น) · แคบกว่านั้นเรียง 2×2 · เลข+หน่วยบรรทัดเดียวเสมอ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:gap-6">
        {kpis.map((kpiItem) => {
          const KpiIcon = kpiItem.icon;
          return (
            <div key={kpiItem.title} className={`rounded-2xl border p-4 lg:p-3 xl:p-4 2xl:p-6 shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${
              kpiItem.hero ? "border-[#04301F] bg-[#06402B]" : "border-[#E8ECEA] bg-white"
            }`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <p className={`truncate text-sm 2xl:text-base font-medium ${kpiItem.hero ? "text-[#9FC0AF]" : "text-[#667085]"}`} title={kpiItem.title}>
                    {kpiItem.title}
                  </p>
                  {loading ? (
                    <span className="inline-block h-9 w-24 rounded-lg skeleton opacity-50" />
                  ) : dashError ? (
                    // โหลดไม่สำเร็จ → แสดง — แทนเลข 0 ที่ทำให้เข้าใจว่าไม่มีสินค้า/ไม่มีรายการจริง
                    <p className="text-3xl font-semibold tracking-tight text-[#667085]">—</p>
                  ) : (
                    <p className={`whitespace-nowrap text-3xl lg:text-[20px] xl:text-[28px] 2xl:text-[32px] font-semibold tracking-tight tabular-nums ${kpiItem.hero ? "text-white" : "text-[#111827]"}`}>
                      <span ref={kpiItem.valueRef} />
                      {kpiItem.unit ? (
                        <span className={`ml-1.5 text-base lg:text-[13px] xl:text-sm 2xl:text-base font-medium ${kpiItem.hero ? "text-[#9FC0AF]" : "text-[#667085]"}`}>
                          {kpiItem.unit}
                        </span>
                      ) : null}
                    </p>
                  )}
                </div>
                <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${
                  kpiItem.hero
                    ? "bg-[#0F5C3F] text-[#C9E5D6]"
                    : "bg-[#EAF2EE] text-[#06402B]"
                }`}>
                  <KpiIcon />
                </div>
              </div>
              <p className={`mt-4 truncate text-sm 2xl:text-[15px] ${
                dashError ? "font-medium text-[#B54708]" : kpiItem.hero ? "text-[#9FC0AF]" : "text-[#667085]"
              }`} title={dashError ? undefined : kpiItem.caption}>
                {dashError ? "ไม่สามารถโหลดข้อมูลส่วนนี้ได้" : kpiItem.caption}
              </p>
            </div>
          );
        })}
      </div>

      {/* Analytics 2/3 + Warehouse donut 1/3 — มือถือเรียง: กราฟ → โดนัท → รออนุมัติ → กิจกรรมวันนี้ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col rounded-2xl border border-[#E8ECEA] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3 px-6 pt-6">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-base 2xl:text-lg font-semibold tracking-tight text-[#111827]">ภาพรวมการเคลื่อนไหว</h2>
                <div className="flex flex-wrap items-center gap-4">
                  {CHART_SERIES_META.map((series) => (
                    <span key={series.key} className="flex items-center gap-1.5 text-sm 2xl:text-base text-[#667085]">
                      <span className="size-2 rounded-full" style={{ backgroundColor: series.color }} />
                      {series.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="inline-flex h-9 items-center rounded-lg bg-[#F3F6F4] p-1">
                {([["7d", "7 วัน"], ["30d", "30 วัน"], ["90d", "90 วัน"]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTimeframe(key)}
                    aria-pressed={timeframe === key}
                    className={`h-7 rounded-md px-3 text-xs 2xl:text-sm font-medium transition-colors duration-150 cursor-pointer ${
                      timeframe === key
                        ? "bg-white text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,0.06)]"
                        : "text-[#667085] hover:text-[#111827]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 px-2 pb-4 pt-2">
              {loading ? (
                <div className="mx-4 mb-2 h-[280px] rounded-xl skeleton opacity-40 sm:h-[320px]" />
              ) : dashError ? (
                <SectionStateBox tone="error" title="โหลดข้อมูลกราฟไม่สำเร็จ" hint="กด “ลองโหลดอีกครั้ง” ด้านบนเพื่อลองใหม่" />
              ) : visibleChart.length === 0 ? (
                <SectionStateBox title="ไม่มีข้อมูลการเคลื่อนไหวในช่วงเวลานี้" hint="รายการรับ–เบิก–ผลิตจะแสดงที่นี่" />
              ) : (
                <div className="h-[280px] w-full pr-4 sm:h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={visibleChart} margin={{ top: 16, right: 8, bottom: 0, left: 8 }}>
                      <defs>
                        {CHART_SERIES_META.map((series) => (
                          <linearGradient key={series.key} id={`${series.key}Fill`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={series.color} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={series.color} stopOpacity={0.01} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid vertical={false} stroke="#E6EDE9" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12, fill: "#667085" }}
                        dy={8}
                        interval="preserveStartEnd"
                        minTickGap={24}
                      />
                      <YAxis
                        width={44}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12, fill: "#667085" }}
                        tickFormatter={(val: number) => {
                          if (val >= 1000000) return `${(val / 1000000).toFixed(val % 1000000 === 0 ? 0 : 1)}M`;
                          if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
                          return String(val);
                        }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        cursor={{ stroke: "#D5DDD9", strokeWidth: 1 }}
                        contentStyle={{
                          backgroundColor: "#ffffff",
                          border: "1px solid #E8ECEA",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "600",
                          boxShadow: "0 8px 24px rgba(16,24,40,0.12)",
                          padding: "6px 10px",
                        }}
                        labelFormatter={(label: unknown) => `วันที่ ${String(label)}`}
                        formatter={(val: unknown, name: unknown) => {
                          const series = CHART_SERIES_META.find((s) => s.key === name);
                          return [
                            `${Number(val).toLocaleString()} ชิ้น`,
                            series?.label ?? String(name),
                          ];
                        }}
                      />
                      {CHART_SERIES_META.map((series) => (
                        <Area
                          key={series.key}
                          type="monotone"
                          dataKey={series.key}
                          stroke={series.color}
                          strokeWidth={2}
                          fill={`url(#${series.key}Fill)`}
                          dot={false}
                          activeDot={{ r: 4, fill: series.color, stroke: "#ffffff", strokeWidth: 2 }}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Right column: warehouse donut + pending approvals — มือถือแสดงก่อนกิจกรรมวันนี้ */}
          <div className="flex flex-col gap-6 lg:col-start-3 lg:row-start-1 lg:row-span-2">
          <div className="rounded-2xl border border-[#E8ECEA] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
            <div className="px-6 pt-6">
              <h2 className="text-base 2xl:text-lg font-semibold tracking-tight text-[#111827]">สินค้าแยกตามโกดัง</h2>
              <p className="mt-1 text-sm 2xl:text-base text-[#667085]">สัดส่วนจำนวนคงเหลือในแต่ละโกดัง</p>
            </div>
            <div className="flex flex-1 flex-col items-center gap-6 px-6 py-6">
              {loading ? (
                <>
                  <div className="size-[240px] rounded-full skeleton opacity-40" />
                  <div className="w-full space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={`sk-donut-${i}`} className="h-6 rounded skeleton opacity-40" />
                    ))}
                  </div>
                </>
              ) : dashError ? (
                <SectionStateBox tone="error" title="โหลดข้อมูลสต็อกแยกโกดังไม่สำเร็จ" hint="กด “ลองโหลดอีกครั้ง” ด้านบนเพื่อลองใหม่" />
              ) : !donut.hasData ? (
                <SectionStateBox title="ไม่มีข้อมูลจำนวนคงเหลือ" hint="ยอดรวมทุกโกดังเป็น 0 — ยังไม่มีสต็อกให้แสดงสัดส่วน" />
              ) : (
                <>
                  <div className="relative size-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donut.slices}
                          dataKey="segmentValue"
                          nameKey="warehouseName"
                          innerRadius={84}
                          outerRadius={113}
                          paddingAngle={2}
                          cornerRadius={2}
                          strokeWidth={0}
                          startAngle={90}
                          endAngle={-270}
                        >
                          {donut.slices.map((slice) => (
                            <Cell key={slice.warehouseId} fill={slice.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="max-w-[132px] truncate text-2xl font-semibold tracking-tight text-[#111827] tabular-nums">
                        {donut.total.toLocaleString()}
                      </span>
                      <span className="text-xs 2xl:text-sm text-[#667085]">ชิ้น</span>
                    </div>
                  </div>

                  <div className="w-full">
                    {donut.slices.map((slice) => (
                      <WarehouseLegendRow key={slice.warehouseId} slice={slice} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* รออนุมัติด่วน (แอดมิน) */}
          {(loading || pendingTotal > 0) && (
            <div className="rounded-2xl border border-[#E8ECEA] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
              <div className="flex items-center justify-between px-6 pt-5">
                <div className="flex items-center gap-2">
                  <h2 className="text-base 2xl:text-lg font-semibold tracking-tight text-[#111827]">รออนุมัติ</h2>
                  {/* badge = จำนวน PENDING ทั้งหมด ไม่ใช่แค่ 3 รายการที่แสดงในกล่อง */}
                  <span className="rounded-full bg-[#F3F6F4] px-2 py-0.5 text-xs 2xl:text-sm font-medium text-[#667085] tabular-nums">
                    {loading ? "…" : pendingTotal}
                  </span>
                </div>
                <Link href="/approvals" className="inline-flex items-center gap-1 text-sm 2xl:text-base font-medium text-[#06402B] hover:text-[#0A5236]">
                  ดูทั้งหมด
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              </div>
              <div className="space-y-2.5 px-6 py-5">
                {loading ? (
                  <div className="h-12 rounded-xl skeleton opacity-40" />
                ) : (
                  oldestPending.map((doc) => {
                    const isLeaving = leavingId === doc.document_id;
                    const created = parseDateSafe(doc.created_at);
                    const ageHrs = created && loadedAt > 0
                      ? Math.max(0, Math.floor((loadedAt - created.getTime()) / 3600000))
                      : null;
                    return (
                      <div
                        key={doc.document_id}
                        className={`flex items-center gap-3 rounded-xl border border-[#E8ECEA] bg-white px-3.5 py-3 ${isLeaving ? "leave-up" : ""}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm 2xl:text-base font-semibold text-[#111827]">{doc.document_no} · เป้าหมาย {doc.target_sheet || "-"}</p>
                          <p className="mt-0.5 text-[13px] 2xl:text-sm text-[#667085]">
                            {ageHrs !== null ? `รอ ${ageHrs} ชม.` : "รอดำเนินการ"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleQuickAction(doc, "approve")}
                          disabled={approvingId === doc.document_id || isLeaving}
                          className={`shrink-0 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm 2xl:text-base font-semibold text-white transition-colors duration-150 disabled:opacity-50 ${
                            isLeaving ? "bg-[#06402B]" : "bg-[#06402B] hover:bg-[#0A5236]"
                          } cursor-pointer`}
                        >
                          {isLeaving ? "สำเร็จ ✓" : approvingId === doc.document_id ? "กำลังบันทึก…" : "อนุมัติ"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

          {/* กิจกรรมวันนี้ — เดสก์ท็อปอยู่ใต้กราฟ · มือถืออยู่หลังรายการรออนุมัติ */}
          <ActivityCard
            loading={loading}
            dashError={dashError}
            todayActivities={todayActivities}
            visibleActivities={visibleActivities}
            actorOptions={actorOptions}
            effectiveActorFilter={effectiveActorFilter}
            onActorFilterChange={setActorFilter}
          />
      </div>
    </div>
  );
}


/* ── การ์ดกิจกรรมวันนี้ — ใช้ TanStack Table (เรียงคอลัมน์ได้ + แบ่งหน้า) 5 แถว/หน้า ── */
const ACTIVITY_PAGE_SIZE = 5;

// class ของ td รายคอลัมน์ — จัด padding/การจัดวางให้เหมือนเดิมทุกจุด
const ACTIVITY_TD_CLASS: Record<string, string> = {
  actor_name: "py-3.5 pl-6 pr-3",
  action_type: "px-3 py-3.5",
  product_name: "max-w-[240px] px-3 py-3.5",
  warehouse_name: "whitespace-nowrap px-3 py-3.5",
  quantity: "px-3 py-3.5 text-right tabular-nums",
  created_at: "py-3.5 pl-3 pr-6 text-right whitespace-nowrap",
};

// คอลัมน์ที่ชิดขวา (จำนวน / เวลา)
const ACTIVITY_RIGHT_COLUMNS = new Set(["quantity", "created_at"]);

function qtyColorClass(actionType: TodayActivity["action_type"]): string {
  if (actionType === "RECEIVE" || actionType === "PRODUCTION") return "text-[#06402B]";
  if (actionType === "ISSUE") return "text-[#B42318]";
  return "text-[#111827]";
}

/* ── ลูกศรบอกทิศทางเรียงของคอลัมน์ (inline SVG ตามกติกา) ── */
function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
  if (dir === "asc") {
    return <Icon className="size-3"><path d="m18 15-6-6-6 6" /></Icon>;
  }
  if (dir === "desc") {
    return <Icon className="size-3"><path d="m6 9 6 6 6-6" /></Icon>;
  }
  return <Icon className="size-3 opacity-40"><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></Icon>;
}

function ActivityCard({
  loading,
  dashError,
  todayActivities,
  visibleActivities,
  actorOptions,
  effectiveActorFilter,
  onActorFilterChange,
}: {
  loading: boolean;
  dashError: string | null;
  todayActivities: TodayActivity[];
  visibleActivities: TodayActivity[];
  actorOptions: ActivityActorOption[];
  effectiveActorFilter: string;
  onActorFilterChange: (value: string) => void;
}) {
  // TanStack Table จัดเรียง + แบ่งหน้าให้ (autoResetPageIndex รีเซ็ตกลับหน้าแรกเมื่อข้อมูล/ตัวกรองเปลี่ยน)
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: ACTIVITY_PAGE_SIZE,
  });

  const columns = useMemo<ColumnDef<TodayActivity>[]>(
    () => [
      {
        accessorKey: "actor_name",
        header: "ผู้ทำรายการ",
        cell: ({ row }) => (
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate font-medium text-[#111827]" title={row.original.actor_name}>
              {row.original.actor_name}
            </span>
            {row.original.document_no ? (
              <span className="shrink-0 text-xs text-[#667085]">{row.original.document_no}</span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "action_type",
        header: "รายการ",
        enableSorting: false,
        cell: ({ row }) => (
          <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeForActivity(row.original.action_type)}`}>
            {row.original.action_label}
          </span>
        ),
      },
      {
        accessorKey: "product_name",
        header: "สินค้า / เอกสาร",
        cell: ({ row }) => (
          <div className="truncate font-medium text-[#111827]" title={row.original.product_name}>
            {row.original.product_name || row.original.document_no || "-"}
          </div>
        ),
      },
      {
        accessorKey: "warehouse_name",
        header: "โกดัง",
        cell: ({ row }) => (
          <span className="text-[#667085]">{row.original.warehouse_name || "-"}</span>
        ),
      },
      {
        accessorKey: "quantity",
        header: "จำนวน",
        cell: ({ row }) => (
          <span className={`text-sm font-medium ${qtyColorClass(row.original.action_type)}`}>
            {row.original.quantity.toLocaleString()} {row.original.unit}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "เวลา",
        cell: ({ row }) => {
          const d = parseDateSafe(row.original.created_at);
          return (
            <span className="text-[#667085]" title={d ? formatDateThai(d) : undefined}>
              {d ? formatTimeThai(d) : "-"}
            </span>
          );
        },
      },
    ],
    []
  );

  const table = useReactTable({
    data: visibleActivities,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // แถวของหน้าปัจจุบัน (ตามการเรียง) — ใช้ทั้งตาราง desktop และการ์ดมือถือให้เรียงเหมือนกัน
  const rows = table.getRowModel().rows;

  return (
    <div className="min-w-0 rounded-2xl border border-[#E8ECEA] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] lg:col-span-2 lg:col-start-1 lg:row-start-2">
      <div className="flex flex-col gap-3 px-6 pb-2 pt-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-base 2xl:text-lg font-semibold tracking-tight text-[#111827]">กิจกรรมวันนี้</h2>
          <p className="text-sm 2xl:text-base text-[#667085]">รายการรับ–เบิก–โอน–ผลิต–ปรับยอด ของวันนี้ (ตามเวลาประเทศไทย)</p>
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="activity-actor-filter"
            className="text-xs font-medium text-[#667085]"
          >
            ผู้ทำรายการ
          </label>
          <select
            id="activity-actor-filter"
            value={effectiveActorFilter}
            onChange={(e) => onActorFilterChange(e.target.value)}
            disabled={loading || !!dashError || todayActivities.length === 0}
            className="h-9 cursor-pointer rounded-lg border border-[#E8ECEA] bg-white px-3 text-sm font-medium text-[#111827] transition-colors duration-150 hover:border-[#D5DDD9] focus:border-[#06402B] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value={ALL_ACTORS_VALUE}>ทุกคน</option>
            {actorOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 px-6 py-6">
          {[96, 88, 92, 84].map((w, i) => (
            <div key={i} className="h-12 skeleton" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : dashError ? (
        <div className="px-6 pb-6 pt-2">
          <SectionStateBox tone="error" title="โหลดกิจกรรมวันนี้ไม่สำเร็จ" hint="กด “ลองโหลดอีกครั้ง” ด้านบนเพื่อลองใหม่" />
        </div>
      ) : todayActivities.length === 0 ? (
        <div className="px-6 pb-6 pt-2">
          <SectionStateBox title="ยังไม่มีกิจกรรมวันนี้" hint="กิจกรรมการรับ–เบิก–โอนย้าย–ผลิตของวันนี้จะแสดงที่นี่" />
        </div>
      ) : visibleActivities.length === 0 ? (
        <div className="px-6 pb-6 pt-2">
          <SectionStateBox
            title="ไม่พบกิจกรรมของผู้ทำรายการที่เลือก"
            hint="ลองเลือก “ทุกคน” เพื่อดูกิจกรรมทั้งหมดของวันนี้"
          />
        </div>
      ) : (
        <>
          {/* Desktop table — TanStack Table: กดหัวคอลัมน์เพื่อเรียงได้ · การ์ดแคบให้เลื่อนแนวนอนในการ์ด */}
          <div className="hidden md:block overflow-x-auto overscroll-x-contain">
            <table className="w-full text-left text-sm 2xl:text-base">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="text-xs 2xl:text-sm font-medium text-[#667085]">
                    {headerGroup.headers.map((header) => {
                      const isRight = ACTIVITY_RIGHT_COLUMNS.has(header.column.id);
                      return (
                        <th
                          key={header.id}
                          className={`whitespace-nowrap font-medium ${ACTIVITY_TD_CLASS[header.column.id] ?? "px-3 py-3"}`}
                        >
                          {header.column.getCanSort() ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className={`inline-flex cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-[#111827] ${isRight ? "flex-row-reverse" : ""}`}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              <SortIcon dir={header.column.getIsSorted()} />
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[#E8ECEA] transition-colors duration-150 hover:bg-[#FAFBFA]">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={ACTIVITY_TD_CLASS[cell.column.id] ?? "px-3 py-3.5"}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards — ใช้ลำดับเดียวกับตาราง (ตามการเรียงปัจจุบัน) */}
          <div className="flex flex-col divide-y divide-[#E8ECEA] px-4 pb-2 md:hidden">
            {rows.map((row) => {
              const item = row.original;
              const d = parseDateSafe(item.created_at);
              return (
                <div key={item.id} className="flex flex-col gap-3 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="line-clamp-1 text-sm font-medium text-[#111827]">{item.actor_name}</span>
                      {item.document_no ? (
                        <span className="text-xs text-[#667085]">{item.document_no}</span>
                      ) : null}
                    </div>
                    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeForActivity(item.action_type)}`}>
                      {item.action_label}
                    </span>
                  </div>
                  {item.product_name ? (
                    <p className="text-sm text-[#111827]">{item.product_name}</p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-[#667085]">โกดัง</span>
                      <span className="text-sm text-[#111827]">{item.warehouse_name || "-"}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-[#667085]">จำนวน</span>
                      <span className={`text-sm font-medium tabular-nums ${
                        item.action_type === "RECEIVE" || item.action_type === "PRODUCTION"
                          ? "text-[#06402B]"
                          : item.action_type === "ISSUE"
                            ? "text-[#B42318]"
                            : "text-[#111827]"
                      }`}>
                        {item.quantity.toLocaleString()} {item.unit}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-[#667085]">เวลา</span>
                      <span className="text-sm text-[#667085]">{d ? formatTimeThai(d) : "-"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* แบ่งหน้าโดย TanStack Table — แสดงพอดีการ์ด ที่เหลือดูต่อผ่านปุ่ม */}
          {table.getPageCount() > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E8ECEA] px-6 py-3">
              <p className="text-xs 2xl:text-sm text-[#667085] tabular-nums">
                หน้า {table.getState().pagination.pageIndex + 1} / {table.getPageCount()} · รวม {visibleActivities.length.toLocaleString()} รายการ
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="ดูกิจกรรมวันนี้หน้าก่อนหน้า"
                  className="h-8 cursor-pointer rounded-lg border border-[#E8ECEA] bg-white px-3 text-sm 2xl:text-base font-medium text-[#111827] transition-colors duration-150 hover:border-[#D5DDD9] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ก่อนหน้า
                </button>
                <button
                  type="button"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  aria-label="ดูกิจกรรมวันนี้หน้าถัดไป"
                  className="h-8 cursor-pointer rounded-lg border border-[#E8ECEA] bg-white px-3 text-sm 2xl:text-base font-medium text-[#111827] transition-colors duration-150 hover:border-[#D5DDD9] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── แถวชื่อโกดังใต้กราฟโดนัท ── */
function WarehouseLegendRow({ slice }: { slice: WarehouseDonutSlice }) {
  return (
    <div className="flex items-center justify-between border-b border-[#E8ECEA] py-3 last:border-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
        <span className="truncate text-sm 2xl:text-base text-[#667085]">{slice.warehouseName}</span>
        {slice.isNegative ? (
          <span className="shrink-0 rounded-full bg-[#FCEFED] px-1.5 py-0.5 text-[10px] font-semibold text-[#B42318]">
            ยอดติดลบ
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-xs 2xl:text-sm text-[#667085] tabular-nums">{slice.quantity.toLocaleString()} ชิ้น</span>
        <span className="text-sm 2xl:text-base font-medium text-[#111827] tabular-nums">{slice.percent}%</span>
      </div>
    </div>
  );
}

/* ── กล่องสถานะว่าง/ผิดพลาดของแต่ละส่วน ── */
function SectionStateBox({
  title,
  hint,
  tone = "empty",
}: {
  title: string;
  hint?: string;
  tone?: "empty" | "error";
}) {
  return (
    <div
      className={`flex w-full flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center ${
        tone === "error" ? "border-[#F2C4BC] bg-[#FCEFED]" : "border-[#E8ECEA] bg-[#EFF3F1]"
      }`}
    >
      <p className={`text-sm font-semibold ${tone === "error" ? "text-[#B42318]" : "text-[#344054]"}`}>{title}</p>
      {hint ? <p className="mt-1 text-[13px] text-[#667085]">{hint}</p> : null}
    </div>
  );
}
