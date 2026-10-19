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
import {
  SolarAltArrowRight,
  SolarBox,
  SolarDangerCircle,
  SolarInboxIn,
  SolarMagnifier,
  SolarOutboxHistory,
} from "@/components/icons";
import { avatarToneClass, userInitials } from "@/components/ui/user-initials";

/* ── Inline SVG icons (lucide paths — ตามกติกา stockify-ui ไม่ติดตั้ง icon library) ── */
function Icon({ children, className = "size-5" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
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

/* ── กราฟเคลื่อนไหว 2 ชุด: รับเข้า (เขียว) / เบิกสินค้า (แดง) ── */
const CHART_SERIES_META = [
  { key: "received", label: "รับเข้า", color: "#00A76F" },
  { key: "issued", label: "เบิกสินค้า", color: "#FFAB00" },
] as const;

// สีโดนัทโทนเขียว Minimal v3 ตามลำดับชิ้น (ข้อมูล/ลำดับมาจาก buildWarehouseDonut เหมือนเดิม)
const DONUT_COLORS_V3 = ["#004B50", "#007867", "#00A76F", "#5BE49B", "#9EEEB4", "#C8FAD6"] as const;
const donutColor = (index: number) => DONUT_COLORS_V3[index % DONUT_COLORS_V3.length];

// จำนวนวันล่าสุดที่แสดงเป็นแท่งเล็กในการ์ด KPI รับเข้า/เบิก
const KPI_SPARK_DAYS = 12;

function badgeForActivity(actionType: TodayActivity["action_type"]): string {
  switch (actionType) {
    case "RECEIVE":
    case "RECEIVE_REQUEST":
      return "m3-label-success";
    case "APPROVE_RECEIVE":
      return "m3-label-primary";
    case "ISSUE":
    case "ISSUE_REQUEST":
      return "m3-label-warning";
    case "APPROVE_ISSUE":
      return "m3-label-info";
    case "TRANSFER":
    case "TRANSFER_REQUEST":
    case "APPROVE_TRANSFER":
      return "m3-label-secondary";
    default:
      return "m3-label-default";
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
  };
  const kpiCards = buildKpiCards(kpiNumbers);
  const kpiCardMeta = [
    { icon: SolarBox, hero: true, valueRef: kpiRemainingRef },
    { icon: SolarInboxIn, hero: false, valueRef: kpiReceivedRef },
    { icon: SolarOutboxHistory, hero: false, valueRef: kpiIssuedRef },
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

  // กราฟรายวัน (รับเข้า/เบิก) — server เติมวันที่ 90 วันให้ครบ สลับช่วงเวลาฝั่ง client
  const chartData = useMemo(() => {
    const rows = stats?.chart_data ?? [];
    return rows.map((c) => ({
      label: `${Number(c.date.slice(8, 10))}/${Number(c.date.slice(5, 7))}`,
      received: c.received,
      issued: c.issued,
    }));
  }, [stats?.chart_data]);
  const visibleChart = chartData.slice(-TIMEFRAME_DAYS[timeframe]);

  // ส่วนแสดงผล Minimal v3 (D01/M31): ยอดรวมของช่วงที่เลือกใต้หัวกราฟ + แท่งเล็กในการ์ด KPI
  const seriesTotals = {
    received: visibleChart.reduce((sum, c) => sum + c.received, 0),
    issued: visibleChart.reduce((sum, c) => sum + c.issued, 0),
  };
  const showSeriesTotals = !loading && !dashError && visibleChart.length > 0;
  const sparkReceived = chartData.slice(-KPI_SPARK_DAYS).map((c) => c.received);
  const sparkIssued = chartData.slice(-KPI_SPARK_DAYS).map((c) => c.issued);

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
    <div className="w-full max-w-full space-y-3 md:space-y-6 md:pt-5">
      {/* สถานะโหลดข้อมูลไม่สำเร็จ — แจ้งผู้ใช้แทนการแสดง 0 ที่ทำให้เข้าใจผิด (D52 notification · error) */}
      {!loading && dashError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl bg-[rgba(255,86,48,0.12)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <SolarDangerCircle size={20} className="mt-0.5 shrink-0 text-m3-error" />
            <div>
              <p className="text-[14px] font-semibold text-m3-error-dark">โหลดข้อมูล Dashboard ไม่สำเร็จ</p>
              <p className="mt-0.5 text-[13px] text-m3-error-dark/90">
                {dashError} — ตัวเลขด้านล่างอาจไม่ครบถ้วน ไม่ใช่ข้อมูลจริงทั้งหมด
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="m3-btn m3-btn-sm m3-btn-outline shrink-0 self-start sm:self-auto"
          >
            ลองโหลดอีกครั้ง
          </button>
        </div>
      )}

      {/* KPI — D01: 3 ใบแถวเดียว (สินค้าทั้งหมดเป็น hero สีเขียวอ่อน) · M31: hero เต็มแถว + รับเข้า/เบิก 2 คอลัมน์ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-6">
        {kpis.map((kpiItem, index) => {
          const KpiIcon = kpiItem.icon;
          const spark = index === 1 ? sparkReceived : index === 2 ? sparkIssued : null;
          return (
            <div
              key={kpiItem.title}
              className={`min-w-0 rounded-m3-card p-4 md:p-6 ${
                kpiItem.hero
                  ? "col-span-2 bg-[linear-gradient(135deg,rgba(200,250,214,0.56),rgba(91,228,155,0.18))] md:col-span-1 md:bg-[linear-gradient(135deg,rgba(200,250,214,0.48),rgba(91,228,155,0.16))]"
                  : "m3-card"
              }`}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <p className="truncate text-[14px] font-semibold text-m3-grey-700 md:text-m3-grey-800" title={kpiItem.title}>
                  {kpiItem.title}
                </p>
                {kpiItem.hero ? (
                  <span className="hidden size-10 shrink-0 place-items-center rounded-[10px] bg-[rgba(0,167,111,0.16)] text-m3-primary md:grid">
                    <KpiIcon size={24} />
                  </span>
                ) : null}
              </div>
              <div className="flex min-w-0 items-end justify-between gap-3">
                <div className="min-w-0">
                  {loading ? (
                    <span className="mt-2 inline-block h-9 w-24 rounded-lg skeleton opacity-50 md:mt-3" />
                  ) : dashError ? (
                    // โหลดไม่สำเร็จ → แสดง — แทนเลข 0 ที่ทำให้เข้าใจว่าไม่มีสินค้า/ไม่มีรายการจริง
                    <p className="mt-0.5 font-m3-disp text-[30px] font-bold leading-[1.5] text-m3-grey-500 md:mt-3 md:text-[32px]">—</p>
                  ) : (
                    <p
                      className={`mt-0.5 whitespace-nowrap font-m3-disp text-[30px] font-bold leading-[1.5] tabular-nums md:mt-3 md:text-[32px] ${
                        kpiItem.hero ? "text-m3-primary-darker" : "text-m3-grey-800"
                      }`}
                    >
                      <span ref={kpiItem.valueRef} />
                      {kpiItem.unit ? (
                        <span className="ml-1.5 font-m3 text-[14px] font-semibold text-m3-grey-600 md:text-[16px]">
                          {kpiItem.unit}
                        </span>
                      ) : null}
                    </p>
                  )}
                  <p
                    className={`truncate text-[12px] md:mt-1.5 md:text-[14px] ${
                      dashError
                        ? "font-medium text-m3-warning-dark"
                        : kpiItem.hero
                          ? "text-m3-grey-500 md:text-[#1B806A]"
                          : "text-m3-grey-500"
                    }`}
                    title={dashError ? undefined : kpiItem.caption}
                  >
                    {dashError ? "ไม่สามารถโหลดข้อมูลส่วนนี้ได้" : kpiItem.caption}
                  </p>
                </div>
                {spark && !loading && !dashError ? (
                  <KpiSparkline values={spark} color={index === 1 ? "#00B8D9" : "#FFAB00"} />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Analytics 2/3 + Warehouse donut 1/3 — มือถือเรียง: กราฟ → โดนัท → รออนุมัติ → กิจกรรมวันนี้ */}
      <div className="grid grid-cols-1 gap-3 md:gap-6 lg:grid-cols-3">
          <div className="m3-card flex min-w-0 flex-col lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <div className="flex min-w-0 items-center justify-between gap-3 px-4 pt-4 md:px-6 md:pt-6">
              <h2 className="text-[16px] font-semibold text-m3-grey-800 md:text-[18px]">ภาพรวมการเคลื่อนไหว</h2>
              <div className="m3-segment shrink-0" role="group" aria-label="ช่วงเวลา">
                {([["7d", "7"], ["30d", "30"], ["90d", "90"]] as const).map(([key, days]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTimeframe(key)}
                    aria-pressed={timeframe === key}
                    className="transition-colors duration-150"
                  >
                    {days}<span className="hidden md:inline"> วัน</span>
                  </button>
                ))}
              </div>
            </div>
            {/* ตัวอย่างสี + ยอดรวมของช่วงเวลาที่เลือก */}
            <div className="flex flex-wrap items-start gap-x-5 gap-y-1 px-4 pt-2.5 md:gap-x-8 md:px-6 md:pt-5">
              {CHART_SERIES_META.map((series) => (
                <div key={series.key}>
                  <div className="flex items-center gap-2 text-[12px] text-m3-grey-600 md:text-[13px]">
                    <span className="m3-dot size-2.5 md:size-2" style={{ backgroundColor: series.color }} />
                    {series.label}
                    {showSeriesTotals ? (
                      <b className="ml-1 font-bold text-m3-grey-800 tabular-nums md:hidden">
                        {seriesTotals[series.key].toLocaleString()}
                      </b>
                    ) : null}
                  </div>
                  {showSeriesTotals ? (
                    <p className="mt-0.5 hidden text-[18px] font-bold text-m3-grey-800 tabular-nums md:block">
                      {seriesTotals[series.key].toLocaleString()}{" "}
                      <span className="text-[13px] font-medium text-m3-grey-600">ชิ้น</span>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="flex-1 pb-3 pt-2 md:pb-5 md:pt-4">
              {loading ? (
                <div className="mx-4 h-[200px] rounded-xl skeleton opacity-40 md:mx-6 md:h-[300px]" />
              ) : dashError ? (
                <div className="px-4 md:px-6"><SectionStateBox tone="error" title="โหลดข้อมูลกราฟไม่สำเร็จ" /></div>
              ) : visibleChart.length === 0 ? (
                <div className="px-4 md:px-6"><SectionStateBox title="ไม่มีข้อมูลการเคลื่อนไหวในช่วงเวลานี้" /></div>
              ) : (
                <div className="h-[200px] w-full pr-3 md:h-[300px] md:pr-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={visibleChart} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
                      <defs>
                        {CHART_SERIES_META.map((series) => (
                          <linearGradient key={series.key} id={`${series.key}Fill`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={series.color} stopOpacity={series.key === "received" ? 0.24 : 0.14} />
                            <stop offset="100%" stopColor={series.color} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid vertical={false} stroke="rgba(145,158,171,0.2)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12, fill: "#919EAB" }}
                        dy={8}
                        interval="preserveStartEnd"
                        minTickGap={24}
                      />
                      <YAxis
                        width={48}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12, fill: "#919EAB" }}
                        tickFormatter={(val: number) => {
                          if (val >= 1000000) return `${(val / 1000000).toFixed(val % 1000000 === 0 ? 0 : 1)}M`;
                          if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
                          return String(val);
                        }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        cursor={{ stroke: "rgba(145,158,171,0.4)", strokeWidth: 1, strokeDasharray: "3 3" }}
                        content={<ChartTooltip />}
                      />
                      {CHART_SERIES_META.map((series) => (
                        <Area
                          key={series.key}
                          type="monotone"
                          dataKey={series.key}
                          stroke={series.color}
                          strokeWidth={2.5}
                          fill={`url(#${series.key}Fill)`}
                          dot={false}
                          activeDot={{ r: 5, fill: series.color, stroke: "#ffffff", strokeWidth: 2 }}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Right column: warehouse donut + pending approvals — มือถือแสดงก่อนกิจกรรมวันนี้ */}
          <div className="flex flex-col gap-3 md:gap-6 lg:col-start-3 lg:row-start-1 lg:row-span-2">
          <div className="m3-card">
            <div className="px-4 pt-4 md:px-6 md:pt-6">
              <h2 className="text-[16px] font-semibold text-m3-grey-800 md:text-[18px]">สินค้าแยกตามโกดัง</h2>
            </div>
            {loading ? (
              <div className="flex flex-col items-center gap-6 px-6 py-6">
                <div className="size-[220px] max-w-full rounded-full skeleton opacity-40" />
                <div className="w-full space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={`sk-donut-${i}`} className="h-6 rounded skeleton opacity-40" />
                  ))}
                </div>
              </div>
            ) : dashError ? (
              <div className="px-4 py-5 md:px-6"><SectionStateBox tone="error" title="โหลดข้อมูลสต็อกแยกโกดังไม่สำเร็จ" /></div>
            ) : !donut.hasData ? (
              <div className="px-4 py-5 md:px-6"><SectionStateBox title="ไม่มีข้อมูลจำนวนคงเหลือ" /></div>
            ) : (
              <>
                <div className="relative mx-auto w-full max-w-[260px] py-2 md:py-3">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={donut.slices}
                        dataKey="segmentValue"
                        nameKey="warehouseName"
                        cx="50%"
                        cy="50%"
                        innerRadius="72%"
                        outerRadius="98%"
                        paddingAngle={1}
                        strokeWidth={0}
                        startAngle={90}
                        endAngle={-270}
                        isAnimationActive={false}
                      >
                        {donut.slices.map((slice, i) => (
                          <Cell key={slice.warehouseId} fill={donutColor(i)} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[12px] text-m3-grey-600">จำนวนคงเหลือ</span>
                    <span className="max-w-[160px] truncate font-m3-disp text-[24px] font-bold leading-tight text-m3-grey-800 tabular-nums">
                      {donut.total.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="border-t border-dashed border-m3-divider px-4 pb-3 pt-2 md:px-6 md:pb-4 md:pt-3">
                  {donut.slices.map((slice, i) => (
                    <WarehouseLegendRow key={slice.warehouseId} slice={slice} color={donutColor(i)} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* รออนุมัติด่วน (แอดมิน) */}
          {(loading || pendingTotal > 0) && (
            <div className="m3-card">
              <div className="flex items-center gap-2.5 px-4 pt-4 md:px-6 md:pt-6">
                <h2 className="text-[16px] font-semibold text-m3-grey-800 md:text-[18px]">รออนุมัติ</h2>
                {/* badge = จำนวน PENDING ทั้งหมด ไม่ใช่แค่ 3 รายการที่แสดงในกล่อง */}
                <span className="m3-label m3-label-warning tabular-nums">
                  {loading ? "…" : pendingTotal}
                </span>
              </div>
              <div className="px-4 pb-1 pt-1 md:px-6 md:pb-2">
                {loading ? (
                  <div className="my-3 h-12 rounded-xl skeleton opacity-40" />
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
                        className={`flex items-center gap-3 border-b border-dashed border-m3-divider py-3 ${isLeaving ? "leave-up" : ""}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold text-m3-grey-800">{doc.document_no}</p>
                          <p className="truncate text-[13px] text-m3-grey-500">เป้าหมาย {doc.target_sheet || "-"}</p>
                        </div>
                        <span className={`m3-label shrink-0 whitespace-nowrap ${ageHrs !== null && ageHrs >= 24 ? "m3-label-error" : "m3-label-default"}`}>
                          {ageHrs !== null ? `รอ ${ageHrs} ชม.` : "รอดำเนินการ"}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuickAction(doc, "approve")}
                          disabled={approvingId === doc.document_id || isLeaving}
                          className="m3-btn m3-btn-primary h-8 shrink-0 whitespace-nowrap px-3.5 text-[13px]"
                        >
                          {isLeaving ? "สำเร็จ ✓" : approvingId === doc.document_id ? "กำลังบันทึก…" : "อนุมัติ"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="flex justify-end px-3 pb-3.5 pt-1 md:px-4">
                <Link href="/approvals" className="m3-btn m3-btn-text m3-btn-sm gap-0.5">
                  ดูทั้งหมด
                  <SolarAltArrowRight size={16} />
                </Link>
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

// คอลัมน์ที่ชิดขวา (จำนวน / เวลา)
const ACTIVITY_RIGHT_COLUMNS = new Set(["quantity", "created_at"]);

function qtyColorClass(actionType: TodayActivity["action_type"]): string {
  if (["ISSUE", "ISSUE_REQUEST", "APPROVE_ISSUE"].includes(actionType)) return "text-m3-error-dark";
  return "text-m3-grey-800";
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
          <div className="flex min-w-[150px] items-center gap-3">
            <ActorAvatar name={row.original.actor_name} />
            <span className="block font-semibold text-m3-grey-800" title={row.original.actor_name}>
              {row.original.actor_name}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "action_type",
        header: "รายการ",
        enableSorting: false,
        cell: ({ row }) => (
          <span className={`m3-label whitespace-nowrap ${badgeForActivity(row.original.action_type)}`}>
            {row.original.action_label}
          </span>
        ),
      },
      {
        accessorKey: "product_name",
        header: "สินค้า / เอกสาร",
        cell: ({ row }) => (
          <div className="min-w-[180px] max-w-[260px]">
            <div className="truncate font-semibold text-m3-grey-800" title={row.original.product_name}>
              {row.original.product_name || "-"}
            </div>
            {row.original.document_no ? <div className="text-[12px] text-m3-grey-500">เอกสาร {row.original.document_no}</div> : null}
          </div>
        ),
      },
      {
        accessorKey: "warehouse_name",
        header: "โกดัง",
        cell: ({ row }) => (
          <span className="text-m3-grey-600">{row.original.warehouse_name || "-"}</span>
        ),
      },
      {
        accessorKey: "quantity",
        header: "จำนวน",
        cell: ({ row }) => (
          <span className={`font-semibold ${qtyColorClass(row.original.action_type)}`}>
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
            <span className="text-m3-grey-600" title={d ? formatDateThai(d) : undefined}>
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
    <div className="m3-card min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-2">
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 md:px-6 md:pb-5 md:pt-6">
        <h2 className="text-[16px] font-semibold text-m3-grey-800 md:text-[18px]">กิจกรรมวันนี้</h2>
        <div className="flex items-center gap-2.5">
          <label
            htmlFor="activity-actor-filter"
            className="text-[13px] font-semibold text-m3-grey-600"
          >
            ผู้ทำรายการ
          </label>
          <select
            id="activity-actor-filter"
            value={effectiveActorFilter}
            onChange={(e) => onActorFilterChange(e.target.value)}
            disabled={loading || !!dashError || todayActivities.length === 0}
            className="h-[30px] min-w-[120px] cursor-pointer rounded-lg border border-[rgba(145,158,171,0.32)] bg-white px-2.5 text-[13px] font-semibold text-m3-grey-800 transition-colors duration-150 hover:border-m3-grey-800 focus:border-m3-grey-800 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:min-w-[140px]"
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
        <div className="space-y-3 px-4 pb-6 md:px-6">
          {[96, 88, 92, 84].map((w, i) => (
            <div key={i} className="h-12 skeleton" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : dashError ? (
        <div className="px-4 pb-5 md:px-6 md:pb-6">
          <SectionStateBox tone="error" title="โหลดกิจกรรมวันนี้ไม่สำเร็จ" />
        </div>
      ) : todayActivities.length === 0 ? (
        <div className="px-4 pb-5 md:px-6 md:pb-6">
          <SectionStateBox title="ยังไม่มีกิจกรรมวันนี้" />
        </div>
      ) : visibleActivities.length === 0 ? (
        <div className="px-4 pb-5 md:px-6 md:pb-6">
          <SectionStateBox
            title="ไม่พบกิจกรรมของผู้ทำรายการที่เลือก"
            icon="search"
          />
        </div>
      ) : (
        <>
          {/* Desktop table — TanStack Table: กดหัวคอลัมน์เพื่อเรียงได้ · การ์ดแคบให้เลื่อนแนวนอนในการ์ด */}
          <div className="hidden md:block overflow-x-auto overscroll-x-contain">
            <table className="m3-table text-[14px]">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const isRight = ACTIVITY_RIGHT_COLUMNS.has(header.column.id);
                      return (
                        <th key={header.id} className={isRight ? "m3-num" : undefined}>
                          {header.column.getCanSort() ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className={`inline-flex cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-m3-grey-800 ${isRight ? "flex-row-reverse" : ""}`}
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
                  <tr key={row.id} className="transition-colors duration-150">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={ACTIVITY_RIGHT_COLUMNS.has(cell.column.id) ? "m3-num tabular-nums" : undefined}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards (M31b) — ใช้ลำดับเดียวกับตาราง (ตามการเรียงปัจจุบัน) */}
          <div className="flex flex-col divide-y divide-dashed divide-m3-divider px-4 md:hidden">
            {rows.map((row) => {
              const item = row.original;
              const d = parseDateSafe(item.created_at);
              return (
                <div key={item.id} className="py-3.5">
                  <div className="flex items-center gap-3">
                    <ActorAvatar name={item.actor_name} className="size-8 text-[12px]" />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-m3-grey-800">{item.actor_name}</span>
                    <span className={`m3-label shrink-0 whitespace-nowrap ${badgeForActivity(item.action_type)}`}>
                      {item.action_label}
                    </span>
                  </div>
                  <div className="pl-11">
                    {item.product_name ? (
                      <p className="mt-2 text-[14px] font-semibold text-m3-grey-800">{item.product_name}</p>
                    ) : null}
                    {item.document_no ? <p className="text-[12px] text-m3-grey-500">เอกสาร {item.document_no}</p> : null}
                    <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-m3-grey-600">
                      <span className="truncate">โกดัง {item.warehouse_name || "-"}</span>
                      <span className="whitespace-nowrap">
                        จำนวน{" "}
                        <b className={`text-[13px] font-bold tabular-nums ${qtyColorClass(item.action_type)}`}>
                          {item.quantity.toLocaleString()} {item.unit}
                        </b>
                      </span>
                      <span className="whitespace-nowrap">{d ? formatTimeThai(d) : "-"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* แบ่งหน้าโดย TanStack Table — แสดงพอดีการ์ด ที่เหลือดูต่อผ่านปุ่ม */}
          {table.getPageCount() > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-m3-divider px-4 py-3.5 md:border-0 md:px-6">
              <p className="text-[12px] text-m3-grey-600 tabular-nums md:text-[13px]">
                หน้า {table.getState().pagination.pageIndex + 1} / {table.getPageCount()} · รวม {visibleActivities.length.toLocaleString()} รายการ
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="ดูกิจกรรมวันนี้หน้าก่อนหน้า"
                  className="m3-btn m3-btn-outline m3-btn-sm"
                >
                  ก่อนหน้า
                </button>
                <button
                  type="button"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  aria-label="ดูกิจกรรมวันนี้หน้าถัดไป"
                  className="m3-btn m3-btn-outline m3-btn-sm"
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

/* ── อวาตาร์อักษรย่อผู้ทำรายการ (D01 / M31b) ── */
function ActorAvatar({ name, className = "size-9 text-[13px]" }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${avatarToneClass(name)} ${className}`}
    >
      {userInitials(name)}
    </span>
  );
}

/* ── แท่งกราฟเล็กในการ์ด KPI (D01) — ยอดรายวันช่วงล่าสุดจาก chart_data ชุดเดียวกับกราฟ ── */
function KpiSparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const barW = 5;
  const gap = 3.5;
  const h = 40;
  return (
    <svg
      aria-hidden="true"
      className="mb-1.5 hidden shrink-0 md:block"
      width={values.length * (barW + gap) - gap}
      height={h}
    >
      {values.map((v, i) => {
        const bh = Math.max(3, Math.round((v / max) * h));
        return <rect key={i} x={i * (barW + gap)} y={h - bh} width={barW} height={bh} rx={2.5} fill={color} />;
      })}
    </svg>
  );
}

/* ── tooltip กราฟเคลื่อนไหว (D01) — หัววันที่ + เส้นประ + ยอดแต่ละชุด ── */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  label?: unknown;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-[10px] bg-white px-3 py-2 text-[12px] shadow-m3-dropdown">
      <p className="mb-1 border-b border-dashed border-m3-divider pb-1 font-bold text-m3-grey-800">วันที่ {String(label)}</p>
      {CHART_SERIES_META.map((series) => {
        const item = payload.find((p) => p.dataKey === series.key);
        if (!item) return null;
        return (
          <p key={series.key} className="flex items-center gap-1.5 text-m3-grey-600">
            <span className="m3-dot size-2" style={{ backgroundColor: series.color }} />
            {series.label}
            <b className="ml-auto pl-3 font-bold text-m3-grey-800 tabular-nums">{Number(item.value).toLocaleString()} ชิ้น</b>
          </p>
        );
      })}
    </div>
  );
}

/* ── แถวชื่อโกดังใต้กราฟโดนัท ── */
function WarehouseLegendRow({ slice, color }: { slice: WarehouseDonutSlice; color: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[5px] md:py-[7px]">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="m3-dot size-2.5" style={{ backgroundColor: color }} />
        <span className="truncate text-[13px] text-m3-grey-600 md:text-[14px]">{slice.warehouseName}</span>
        {slice.isNegative ? (
          <span className="m3-label m3-label-error shrink-0">ยอดติดลบ</span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-baseline gap-2 text-[13px] text-m3-grey-600 tabular-nums">
        <span>
          <b className="font-semibold text-m3-grey-800">{slice.quantity.toLocaleString()}</b> ชิ้น
        </span>
        <span className="w-9 text-right text-[12px] text-m3-grey-500">{slice.percent}%</span>
      </div>
    </div>
  );
}

/* ── กล่องสถานะว่าง/ผิดพลาดของแต่ละส่วน (D52 · SectionStateBox) ── */
function SectionStateBox({
  title,
  tone = "empty",
  icon = "inbox",
}: {
  title: string;
  tone?: "empty" | "error";
  icon?: "inbox" | "search";
}) {
  const isError = tone === "error";
  const EmptyIcon = icon === "search" ? SolarMagnifier : SolarInboxIn;
  return (
    <div
      className={`flex w-full flex-col items-center justify-center gap-2.5 rounded-xl py-10 text-center ${
        isError ? "bg-[rgba(255,86,48,0.08)]" : "border border-dashed border-[rgba(145,158,171,0.32)]"
      }`}
    >
      {isError ? (
        <SolarDangerCircle size={32} className="text-m3-error" />
      ) : (
        <EmptyIcon size={32} className="text-m3-grey-400" />
      )}
      <p className={`text-[14px] font-semibold ${isError ? "text-m3-error-dark" : "text-m3-grey-600"}`}>{title}</p>
    </div>
  );
}
