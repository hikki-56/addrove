"use client";

// องค์ประกอบ UI ใช้ร่วมกันของระบบผลิต — badge สถานะ/ความสำคัญ, ฟอร์แมตตัวเลข/วันที่
import type { ProductionJob, ProductionJobStatus, ProductionPriority } from "@/types/production";
import { PRODUCTION_JOB_STATUS_LABELS, PRODUCTION_PRIORITY_LABELS } from "@/types/production";

export function formatQty(n: number | undefined | null): string {
  const v = Number(n) || 0;
  return v.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function todayYMD(): string {
  const d = new Date();
  const bangkok = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return bangkok.toISOString().slice(0, 10);
}

export function StatusBadge({ status }: { status: ProductionJobStatus }) {
  const styles: Record<ProductionJobStatus, string> = {
    DRAFT: "bg-slate-100 text-slate-600 border border-slate-200",
    WAITING: "bg-amber-50 text-amber-800 border border-amber-200",
    IN_PROGRESS: "bg-sky-50 text-sky-800 border border-sky-200",
    COMPLETED: "bg-[#EAF2EE] text-[#053425] border border-[#C9DFD4]",
    CANCELLED: "bg-rose-50 text-rose-700 border border-rose-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold whitespace-nowrap ${styles[status]}`}>
      {status === "IN_PROGRESS" && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />}
      {PRODUCTION_JOB_STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: ProductionPriority }) {
  if (priority === "NORMAL") return null;
  const isCritical = priority === "CRITICAL";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-extrabold text-white whitespace-nowrap ${
        isCritical ? "bg-[#B42318]" : "bg-[#B54708]"
      }`}
    >
      {isCritical ? "🔴" : "🟠"} {PRODUCTION_PRIORITY_LABELS[priority]}
    </span>
  );
}

/** แถบตัวเลขยอดของงาน: เป้าหมาย / ดีสะสม / เสียสะสม / ยังขาด */
export function JobNumbers({ job, compact = false }: { job: ProductionJob; compact?: boolean }) {
  const cell = "rounded-lg px-2.5 py-1.5 min-w-0";
  const label = "text-[10px] font-bold uppercase tracking-wide";
  const value = "mt-0.5 font-mono text-sm font-black tabular-nums";
  return (
    <div className={`grid gap-1.5 ${compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}>
      <div className={`${cell} bg-slate-50`}>
        <div className={`${label} text-slate-400`}>เป้าหมาย</div>
        <div className={`${value} text-slate-900`}>
          {formatQty(job.target_qty)} <span className="text-[10px] font-bold text-slate-400">{job.unit}</span>
        </div>
      </div>
      <div className={`${cell} bg-[#EAF2EE]`}>
        <div className={`${label} text-[#4A7A66]`}>ผลิตดีสะสม</div>
        <div className={`${value} text-[#06402B]`}>{formatQty(job.produced_good)}</div>
      </div>
      <div className={`${cell} bg-rose-50`}>
        <div className={`${label} text-rose-400`}>ของเสียสะสม</div>
        <div className={`${value} text-rose-700`}>{formatQty(job.defect_total)}</div>
      </div>
      <div className={`${cell} bg-amber-50`}>
        <div className={`${label} text-amber-500`}>ยังขาด</div>
        <div className={`${value} text-amber-800`}>{formatQty(job.remaining_qty)}</div>
      </div>
    </div>
  );
}

/** คำอธิบายกติกาการแก้ไขตามสถานะ — ใช้ใน modal แก้ไขงาน */
export function editRuleHint(status: ProductionJobStatus): string {
  if (status === "DRAFT") return "ฉบับร่าง — แก้ไขได้ทุกอย่าง";
  if (status === "WAITING") return "ส่งงานแล้วแต่ยังไม่เริ่ม — แก้สินค้า จำนวน และโต๊ะได้ พร้อมระบุเหตุผล (ระบบแจ้งผู้ผลิต)";
  if (status === "IN_PROGRESS") return "กำลังผลิต — แก้ได้เฉพาะเป้าหมายและหมายเหตุ พร้อมระบุเหตุผล (ระบบแจ้งผู้ผลิต)";
  return "งานสถานะนี้แก้ไขไม่ได้";
}
