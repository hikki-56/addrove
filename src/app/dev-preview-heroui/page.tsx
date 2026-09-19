"use client";

// TEMPORARY preview route — ทดลอง render Dashboard ด้วย HeroUI v3 (mock data ไม่ยิง API)
// เทียบกับหน้า /dev-preview ที่ใช้ UI แบบเดิม (hand-rolled Tailwind)

import { useEffect, useMemo, useState } from "react";
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
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  Heading,
  ListBox,
  ListBoxItem,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  Paragraph,
  Select,
  SelectIndicator,
  SelectPopover,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tab,
  TabList,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableContent,
  TableHeader,
  TableRow,
  TableScrollContainer,
  TableSortableColumnHeader,
} from "@heroui/react";
import Sidebar from "@/components/layout/Sidebar";
import DashboardHeader from "@/components/layout/Navbar";

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
const ArrowRightIcon = ({ className }: { className?: string }) => (
  <Icon className={className}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Icon>
);

/* ── Mock data ──────────────────────────────────────────────── */

type Timeframe = "7d" | "30d" | "90d";
const TIMEFRAME_DAYS: Record<Timeframe, number> = { "7d": 7, "30d": 30, "90d": 90 };

const CHART_SERIES_META = [
  { key: "received", label: "รับเข้า", color: "#06402B" },
  { key: "issued", label: "เบิกสินค้า", color: "#B42318" },
  { key: "produced", label: "ผลิต", color: "#7A5AF8" },
] as const;

// ตัวเลขจำลอง 90 วัน (deterministic — ให้กราฟหน้าตาคงที่ทุกครั้งที่เปิด)
function buildChartData(): { label: string; received: number; issued: number; produced: number }[] {
  let seed = 20260919;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const rows: { label: string; received: number; issued: number; produced: number }[] = [];
  for (let d = 89; d >= 0; d--) {
    const date = new Date(Date.UTC(2026, 8, 19 - d));
    const day = date.getUTCDay();
    const weekend = day === 0 || day === 6 ? 0.35 : 1;
    rows.push({
      label: `${date.getUTCDate()}/${date.getUTCMonth() + 1}`,
      received: Math.round((900 + rand() * 2600) * weekend),
      issued: Math.round((600 + rand() * 1900) * weekend),
      produced: Math.round((500 + rand() * 2200) * weekend),
    });
  }
  return rows;
}

const KPI = [
  { title: "สินค้าคงคลังรวม", value: "128,450", unit: "ชิ้น", icon: PackageIcon, hero: true },
  { title: "รับเข้าวันนี้", value: "3,280", unit: "ชิ้น", icon: ArrowDownIcon, hero: false },
  { title: "เบิกออกวันนี้", value: "1,940", unit: "ชิ้น", icon: ArrowUpIcon, hero: false },
  { title: "ผลิตวันนี้", value: "2,150", unit: "ชิ้น", icon: FactoryIcon, hero: false },
] as const;

const DONUT = {
  total: 128450,
  slices: [
    { id: "wh-a", name: "โกดังอุตสาหกรรม (A)", quantity: 57802, percent: 45, color: "#06402B" },
    { id: "wh-b", name: "โกดังบรรจุภัณฑ์ (B)", quantity: 35966, percent: 28, color: "#0A7A54" },
    { id: "wh-c", name: "โกดังวัตถุดิบ (C)", quantity: 21836, percent: 17, color: "#175CD3" },
    { id: "wh-d", name: "โกดังอะไหล่ (D)", quantity: 12846, percent: 10, color: "#7A5AF8" },
  ],
};

interface PendingDoc {
  document_id: string;
  document_no: string;
  target_sheet: string;
  ageHrs: number;
}

const PENDING: PendingDoc[] = [
  { document_id: "RCV-2569-0812", document_no: "RCV-2569-0812", target_sheet: "รับเข้าโกดัง A", ageHrs: 26 },
  { document_id: "RCV-2569-0813", document_no: "RCV-2569-0813", target_sheet: "รับเข้าโกดัง B", ageHrs: 9 },
  { document_id: "RCV-2569-0814", document_no: "RCV-2569-0814", target_sheet: "รับเข้าโกดัง C", ageHrs: 3 },
];

type ActionType = "RECEIVE" | "ISSUE" | "TRANSFER" | "PRODUCTION";

interface Activity {
  id: string;
  actor_name: string;
  document_no: string;
  action_type: ActionType;
  action_label: string;
  product_name: string;
  warehouse_name: string;
  quantity: number;
  unit: string;
  time: string;
}

const ACTIVITIES: Activity[] = [
  { id: "a1", actor_name: "สมชาย ใจดี", document_no: "RCV-0812", action_type: "RECEIVE", action_label: "รับเข้า", product_name: "กล่องลูกฟูก 60×40×40 ซม.", warehouse_name: "โกดัง A", quantity: 1200, unit: "กล่อง", time: "16:42 น." },
  { id: "a2", actor_name: "ปิยะพร ศรีสุข", document_no: "ISS-0455", action_type: "ISSUE", action_label: "เบิกสินค้า", product_name: "ฟิล์มยืด PVC 500 ซม.", warehouse_name: "โกดัง B", quantity: 85, unit: "ม้วน", time: "16:20 น." },
  { id: "a3", actor_name: "ธนกร วงศ์ทอง", document_no: "PRD-0203", action_type: "PRODUCTION", action_label: "ผลิต", product_name: "ชุดประกอบแพ็คเกจพรีเมียม", warehouse_name: "สายการผลิต 1", quantity: 640, unit: "ชุด", time: "15:58 น." },
  { id: "a4", actor_name: "สมหญิง แจ่มใส", document_no: "TRF-0311", action_type: "TRANSFER", action_label: "โอนย้าย", product_name: "เทปกาว 2 นิ้ว (ใส)", warehouse_name: "A → C", quantity: 300, unit: "แถว", time: "15:31 น." },
  { id: "a5", actor_name: "วิชัย รักงาน", document_no: "RCV-0813", action_type: "RECEIVE", action_label: "รับเข้า", product_name: "ถุงกระดาษ Kraft ขนาด M", warehouse_name: "โกดัง B", quantity: 2400, unit: "ใบ", time: "15:04 น." },
  { id: "a6", actor_name: "ปิยะพร ศรีสุข", document_no: "ISS-0454", action_type: "ISSUE", action_label: "เบิกสินค้า", product_name: "สติกเกอร์ฉลากสินค้า (กลม)", warehouse_name: "โกดัง C", quantity: 5000, unit: "ดวง", time: "14:47 น." },
  { id: "a7", actor_name: "ธนกร วงศ์ทอง", document_no: "PRD-0202", action_type: "PRODUCTION", action_label: "ผลิต", product_name: "กล่องพัฒน์ของขวัญตรุษจีน", warehouse_name: "สายการผลิต 2", quantity: 980, unit: "กล่อง", time: "14:15 น." },
  { id: "a8", actor_name: "สมชาย ใจดี", document_no: "RCV-0811", action_type: "RECEIVE", action_label: "รับเข้า", product_name: "ฟอยล์อะลูมิเนียม 80 ไมครอน", warehouse_name: "โกดัง C", quantity: 420, unit: "ม้วน", time: "13:52 น." },
  { id: "a9", actor_name: "มานพ บุญมี", document_no: "TRF-0310", action_type: "TRANSFER", action_label: "โอนย้าย", product_name: "พาเลทไม้ 100×120 ซม.", warehouse_name: "B → A", quantity: 60, unit: "แผ่น", time: "13:20 น." },
  { id: "a10", actor_name: "สมหญิง แจ่มใส", document_no: "ISS-0453", action_type: "ISSUE", action_label: "เบิกสินค้า", product_name: "หีบลังไม้สนขนาดใหญ่", warehouse_name: "โกดัง A", quantity: 210, unit: "ใบ", time: "12:44 น." },
  { id: "a11", actor_name: "วิชัย รักงาน", document_no: "PRD-0201", action_type: "PRODUCTION", action_label: "ผลิต", product_name: "ถุงซิปล็อกอาหาร 1 กก.", warehouse_name: "สายการผลิต 1", quantity: 3100, unit: "ถุง", time: "11:30 น." },
  { id: "a12", actor_name: "มานพ บุญมี", document_no: "RCV-0810", action_type: "RECEIVE", action_label: "รับเข้า", product_name: "กระดาษลูกฟูก 1 หุน", warehouse_name: "โกดัง A", quantity: 1800, unit: "แผ่น", time: "10:55 น." },
];

const ACTORS = ["ทุกคน", "สมชาย ใจดี", "ปิยะพร ศรีสุข", "ธนกร วงศ์ทอง", "สมหญิง แจ่มใส", "วิชัย รักงาน", "มานพ บุญมี"];

function chipForActivity(type: ActionType): { color: "success" | "danger" | "accent" | "default"; label: string } {
  switch (type) {
    case "RECEIVE":
      return { color: "success", label: "รับเข้า" };
    case "ISSUE":
      return { color: "danger", label: "เบิกสินค้า" };
    case "TRANSFER":
      return { color: "accent", label: "โอนย้าย" };
    default:
      return { color: "default", label: "ผลิต" };
  }
}

const PAGE_SIZE = 5;

/* ── Page ───────────────────────────────────────────────────── */

export default function HeroUiPreviewPage() {
  // จำลองสถานะโหลดสั้น ๆ เพื่อให้เห็น Skeleton ของ HeroUI ตอนเปิดหน้า
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 1100);
    return () => window.clearTimeout(t);
  }, []);

  const [timeframe, setTimeframe] = useState<Timeframe>("30d");
  const [actor, setActor] = useState<string>("ทุกคน");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ column: string; direction: "ascending" | "descending" } | undefined>();

  const [pending, setPending] = useState<PendingDoc[]>(PENDING);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const chartData = useMemo(buildChartData, []);
  const visibleChart = chartData.slice(-TIMEFRAME_DAYS[timeframe]);

  const visibleActivities = useMemo(
    () => (actor === "ทุกคน" ? ACTIVITIES : ACTIVITIES.filter((a) => a.actor_name === actor)),
    [actor]
  );

  const sortedActivities = useMemo(() => {
    if (!sort) return visibleActivities;
    const key = sort.column as keyof (typeof visibleActivities)[number];
    const mul = sort.direction === "ascending" ? 1 : -1;
    return [...visibleActivities].sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
      return String(va).localeCompare(String(vb), "th") * mul;
    });
  }, [visibleActivities, sort]);

  const pageCount = Math.max(1, Math.ceil(sortedActivities.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sortedActivities.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleApprove = async (doc: PendingDoc) => {
    if (approvingId) return;
    setApprovingId(doc.document_id);
    window.setTimeout(() => {
      setPending((prev) => prev.filter((d) => d.document_id !== doc.document_id));
      setApprovingId(null);
    }, 420);
  };

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] bg-[#EFF3F1] text-[#111827] overflow-hidden w-full max-w-full">
      <Sidebar role="ADMIN" userName="ผู้ดูแลระบบ" />
      <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden w-full max-w-full">
        <DashboardHeader
          user={{ name: "ผู้ดูแลระบบ", email: "admin@stockify.local", role: "ADMIN" }}
        />
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain w-full max-w-full bg-[#EFF3F1]">
          <div className="mx-auto w-full px-4 py-6 md:px-6 md:py-8 xl:px-8 space-y-6">

            {/* ── KPI ── */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {KPI.map((kpi) => {
                const KpiIcon = kpi.icon;
                return (
                  <Card
                    key={kpi.title}
                    className={kpi.hero ? "bg-accent text-accent-foreground border-transparent" : undefined}
                  >
                    <CardContent className="flex flex-col gap-2">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <Paragraph size="sm" className={kpi.hero ? "text-accent-foreground/70" : "text-[#667085]"}>
                            {kpi.title}
                          </Paragraph>
                          {loading ? (
                            <Skeleton className="h-9 w-28" />
                          ) : (
                            <p className="text-3xl font-semibold tracking-tight tabular-nums">
                              {kpi.value}
                              <span className={`ml-1.5 text-sm font-medium ${kpi.hero ? "text-accent-foreground/70" : "text-[#667085]"}`}>
                                {kpi.unit}
                              </span>
                            </p>
                          )}
                        </div>
                        <div
                          className={`grid size-11 shrink-0 place-items-center rounded-xl ${
                            kpi.hero ? "bg-accent-foreground/15 text-accent-foreground" : "bg-[#EAF2EE] text-[#06402B]"
                          }`}
                        >
                          <KpiIcon className="size-5" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* ── Analytics + Donut + รออนุมัติ ── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* กราฟพื้นที่ */}
              <Card className="lg:col-span-2">
                <CardHeader className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle>ภาพรวมการเคลื่อนไหว</CardTitle>
                    <CardDescription>จำนวนรับ–เบิก–ผลิตรายวัน (ชิ้น)</CardDescription>
                  </div>
                  {/* HeroUI Tabs แทนปุ่มสลับช่วงเวลาแบบเดิม */}
                  <Tabs
                    aria-label="ช่วงเวลาของกราฟ"
                    selectedKey={timeframe}
                    onSelectionChange={(key) => setTimeframe(key as Timeframe)}
                    variant="secondary"
                  >
                    <TabList aria-label="ช่วงเวลา">
                      <Tab id="7d">7 วัน</Tab>
                      <Tab id="30d">30 วัน</Tab>
                      <Tab id="90d">90 วัน</Tab>
                    </TabList>
                  </Tabs>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    {CHART_SERIES_META.map((series) => (
                      <span key={series.key} className="flex items-center gap-1.5 text-sm text-[#667085]">
                        <span className="size-2 rounded-full" style={{ backgroundColor: series.color }} />
                        {series.label}
                      </span>
                    ))}
                  </div>
                  {loading ? (
                    <Skeleton className="h-[300px]" />
                  ) : (
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={visibleChart} margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
                          <defs>
                            {CHART_SERIES_META.map((series) => (
                              <linearGradient key={series.key} id={`heroui-${series.key}Fill`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={series.color} stopOpacity={0.2} />
                                <stop offset="100%" stopColor={series.color} stopOpacity={0.01} />
                              </linearGradient>
                            ))}
                          </defs>
                          <CartesianGrid vertical={false} stroke="#E6EDE9" />
                          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 16, fill: "#667085" }} dy={8} interval="preserveStartEnd" minTickGap={24} />
                          <YAxis
                            width={56}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 16, fill: "#667085" }}
                            tickFormatter={(val: number) => (val >= 1000 ? `${Math.round(val / 1000)}k` : String(val))}
                            allowDecimals={false}
                          />
                          <Tooltip
                            cursor={{ stroke: "#D5DDD9", strokeWidth: 1 }}
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              border: "1px solid #E8ECEA",
                              borderRadius: "12px",
                              fontSize: "16px",
                              fontWeight: "600",
                              boxShadow: "0 8px 24px rgba(16,24,40,0.12)",
                              padding: "6px 10px",
                            }}
                            labelFormatter={(label: unknown) => `วันที่ ${String(label)}`}
                            formatter={(val: unknown, name: unknown) => {
                              const series = CHART_SERIES_META.find((s) => s.key === name);
                              return [`${Number(val).toLocaleString()} ชิ้น`, series?.label ?? String(name)];
                            }}
                          />
                          {CHART_SERIES_META.map((series) => (
                            <Area
                              key={series.key}
                              type="monotone"
                              dataKey={series.key}
                              stroke={series.color}
                              strokeWidth={2}
                              fill={`url(#heroui-${series.key}Fill)`}
                              dot={false}
                              activeDot={{ r: 4, fill: series.color, stroke: "#ffffff", strokeWidth: 2 }}
                            />
                          ))}
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* คอลัมน์ขวา: โดนัท + รออนุมัติ */}
              <div className="flex flex-col gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>สินค้าแยกตามโกดัง</CardTitle>
                    <CardDescription>สัดส่วนจำนวนคงเหลือในแต่ละโกดัง</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col items-center gap-5">
                    {loading ? (
                      <Skeleton className="size-[280px] rounded-full" />
                    ) : (
                      <div className="relative w-full max-w-[320px]">
                        <ResponsiveContainer width="100%" height={280}>
                          <PieChart>
                            <Pie
                              data={DONUT.slices}
                              dataKey="quantity"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius="70%"
                              outerRadius="94%"
                              paddingAngle={2}
                              cornerRadius={2}
                              strokeWidth={0}
                              startAngle={90}
                              endAngle={-270}
                              isAnimationActive={false}
                            >
                              {DONUT.slices.map((slice) => (
                                <Cell key={slice.id} fill={slice.color} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-2xl font-semibold tracking-tight tabular-nums">
                            {DONUT.total.toLocaleString()}
                          </span>
                          <span className="text-sm text-[#667085]">ชิ้น</span>
                        </div>
                      </div>
                    )}
                    <div className="w-full">
                      {DONUT.slices.map((slice) => (
                        <div key={slice.id} className="flex items-center justify-between border-b border-[#E8ECEA] py-2.5 last:border-0">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                            <span className="truncate text-sm text-[#667085]">{slice.name}</span>
                          </div>
                          <div className="flex shrink-0 items-baseline gap-2">
                            <span className="text-sm text-[#667085] tabular-nums">{slice.quantity.toLocaleString()} ชิ้น</span>
                            <span className="text-sm font-medium tabular-nums">{slice.percent}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* รออนุมัติ — Button/Chip ของ HeroUI */}
                <Card>
                  <CardHeader className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle>รออนุมัติ</CardTitle>
                      <Chip color="default" variant="soft">{loading ? "…" : pending.length}</Chip>
                    </div>
                    <Link
                      href="/approvals"
                      className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                    >
                      ดูทั้งหมด
                      <ArrowRightIcon className="size-3.5" />
                    </Link>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2.5">
                    {loading ? (
                      <Skeleton className="h-12" />
                    ) : pending.length === 0 ? (
                      <Paragraph size="sm" className="py-4 text-center text-[#667085]">
                        ไม่มีรายการรออนุมัติ 🎉
                      </Paragraph>
                    ) : (
                      pending.map((doc) => (
                        <div
                          key={doc.document_id}
                          className="flex items-center gap-3 rounded-xl border border-[#E8ECEA] bg-white px-3.5 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">
                              {doc.document_no} · เป้าหมาย {doc.target_sheet}
                            </p>
                            <p className="mt-0.5 text-sm text-[#667085]">รอ {doc.ageHrs} ชม.</p>
                          </div>
                          <Button
                            size="sm"
                            variant="primary"
                            isDisabled={approvingId === doc.document_id}
                            onPress={() => handleApprove(doc)}
                          >
                            {approvingId === doc.document_id ? "กำลังบันทึก…" : "อนุมัติ"}
                          </Button>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* ── กิจกรรมวันนี้ — HeroUI Table + Select + Pagination ── */}
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <CardTitle>กิจกรรมวันนี้</CardTitle>
                  <CardDescription>รายการรับ–เบิก–โอน–ผลิต ของวันนี้ (ตามเวลาประเทศไทย)</CardDescription>
                </div>
                <div className="flex w-full flex-col gap-1 sm:w-56">
                  <span className="text-xs font-medium text-[#667085]" id="heroui-actor-filter-label">
                    ผู้ทำรายการ
                  </span>
                  {/* HeroUI Select แทน <select> + CustomSelect แบบเดิม */}
                  <Select
                    aria-labelledby="heroui-actor-filter-label"
                    selectedKey={actor}
                    onSelectionChange={(key) => {
                      setActor(String(key ?? "ทุกคน"));
                      setPage(1);
                    }}
                    isDisabled={loading}
                  >
                    <SelectTrigger>
                      <SelectValue />
                      <SelectIndicator />
                    </SelectTrigger>
                    <SelectPopover>
                      <ListBox>
                        {ACTORS.map((name) => (
                          <ListBoxItem key={name} id={name}>{name}</ListBoxItem>
                        ))}
                      </ListBox>
                    </SelectPopover>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {loading ? (
                  <div className="space-y-3">
                    {[96, 88, 92, 84].map((w, i) => (
                      <Skeleton key={i} className="h-12" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : visibleActivities.length === 0 ? (
                  <Paragraph size="sm" className="py-8 text-center text-[#667085]">
                    ไม่พบกิจกรรมของผู้ทำรายการที่เลือก — ลองเลือก “ทุกคน”
                  </Paragraph>
                ) : (
                  <>
                    {/* HeroUI Table — กดหัวคอลัมน์เพื่อเรียงได้ (React Aria) */}
                    <Table>
                      <TableScrollContainer>
                        <TableContent
                          aria-label="กิจกรรมวันนี้"
                          sortDescriptor={sort}
                          onSortChange={(desc) => {
                            if (desc) setSort({ column: String(desc.column), direction: desc.direction });
                          }}
                        >
                          <TableHeader>
                            <TableColumn id="actor_name" isRowHeader allowsSorting>
                              {({ sortDirection }) => (
                                <TableSortableColumnHeader sortDirection={sortDirection}>ผู้ทำรายการ</TableSortableColumnHeader>
                              )}
                            </TableColumn>
                            <TableColumn id="action_type">รายการ</TableColumn>
                            <TableColumn id="product_name">สินค้า / เอกสาร</TableColumn>
                            <TableColumn id="warehouse_name">โกดัง</TableColumn>
                            <TableColumn id="quantity" allowsSorting className="text-right">
                              {({ sortDirection }) => (
                                <TableSortableColumnHeader className="justify-end" sortDirection={sortDirection}>จำนวน</TableSortableColumnHeader>
                              )}
                            </TableColumn>
                            <TableColumn id="time" allowsSorting className="text-right">
                              {({ sortDirection }) => (
                                <TableSortableColumnHeader className="justify-end" sortDirection={sortDirection}>เวลา</TableSortableColumnHeader>
                              )}
                            </TableColumn>
                          </TableHeader>
                          <TableBody>
                            {pageRows.map((item) => {
                              const badge = chipForActivity(item.action_type);
                              return (
                                <TableRow key={item.id} id={item.id}>
                                  <TableCell>
                                    <div className="flex min-w-0 items-baseline gap-1.5">
                                      <span className="truncate font-medium" title={item.actor_name}>{item.actor_name}</span>
                                      <span className="shrink-0 text-xs text-[#667085]">{item.document_no}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Chip color={badge.color} variant="soft">{badge.label}</Chip>
                                  </TableCell>
                                  <TableCell>
                                    <span className="block max-w-[260px] truncate font-medium" title={item.product_name}>
                                      {item.product_name}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="whitespace-nowrap text-[#667085]">{item.warehouse_name}</span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="block text-right font-medium tabular-nums">
                                      {item.quantity.toLocaleString()} {item.unit}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="block text-right whitespace-nowrap text-[#667085]">{item.time}</span>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </TableContent>
                      </TableScrollContainer>
                    </Table>

                    {/* HeroUI Pagination */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-[#667085] tabular-nums">
                        หน้า {currentPage} / {pageCount} · รวม {visibleActivities.length.toLocaleString()} รายการ
                      </p>
                      <Pagination>
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious
                              aria-label="ดูกิจกรรมวันนี้หน้าก่อนหน้า"
                              isDisabled={currentPage <= 1}
                              onPress={() => setPage((p) => Math.max(1, p - 1))}
                            >
                              ก่อนหน้า
                            </PaginationPrevious>
                          </PaginationItem>
                          {Array.from({ length: pageCount }).map((_, i) => (
                            <PaginationItem key={i}>
                              <Button
                                variant={currentPage === i + 1 ? "primary" : "ghost"}
                                className="min-w-8"
                                aria-label={`ดูกิจกรรมวันนี้หน้า ${i + 1}`}
                                aria-current={currentPage === i + 1 ? "page" : undefined}
                                onPress={() => setPage(i + 1)}
                              >
                                {i + 1}
                              </Button>
                            </PaginationItem>
                          ))}
                          <PaginationItem>
                            <PaginationNext
                              aria-label="ดูกิจกรรมวันนี้หน้าถัดไป"
                              isDisabled={currentPage >= pageCount}
                              onPress={() => setPage((p) => Math.min(pageCount, p + 1))}
                            >
                              ถัดไป
                            </PaginationNext>
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
