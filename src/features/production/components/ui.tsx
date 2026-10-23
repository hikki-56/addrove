"use client";

// องค์ประกอบ UI ใช้ร่วมกันของระบบผลิต — badge สถานะ/ความสำคัญ, ฟอร์แมตตัวเลข/วันที่
import type { ProductionJob, ProductionJobStatus, ProductionPriority } from "@/types/production";
import { PRODUCTION_JOB_STATUS_LABELS, PRODUCTION_PRIORITY_LABELS } from "@/types/production";
import type { ReactElement } from "react";
import {
  SolarArrowUp,
  SolarCheckCircle,
  SolarClockCircle,
  SolarDangerTriangle,
  SolarCloseCircle,
  SolarFlag,
  SolarPen,
  SolarPlayCircle,
  type SolarIconProps,
} from "@/components/icons";
import { M3StatTile } from "@/components/ui/m3";

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

const STATUS_LABEL: Record<ProductionJobStatus, { cls: string; Icon: (p: SolarIconProps) => ReactElement }> = {
  DRAFT: { cls: "m3-label-default", Icon: SolarPen },
  WAITING: { cls: "m3-label-warning", Icon: SolarClockCircle },
  IN_PROGRESS: { cls: "m3-label-info", Icon: SolarPlayCircle },
  COMPLETED: { cls: "m3-label-success", Icon: SolarCheckCircle },
  CANCELLED: { cls: "m3-label-default", Icon: SolarCloseCircle },
};

export function StatusBadge({ status }: { status: ProductionJobStatus }) {
  const { cls, Icon } = STATUS_LABEL[status];
  return (
    <span className={`m3-label gap-1 px-2 ${cls}`}>
      <Icon size={14} className={status === "IN_PROGRESS" ? "animate-pulse" : undefined} />
      {PRODUCTION_JOB_STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: ProductionPriority }) {
  if (priority === "NORMAL") return null;
  const isCritical = priority === "CRITICAL";
  return (
    <span className={`m3-label gap-1 px-2 ${isCritical ? "m3-label-error" : "m3-label-warning"}`}>
      <SolarFlag size={13} />
      {PRODUCTION_PRIORITY_LABELS[priority]}
    </span>
  );
}

/** แถบสีซ้ายของการ์ดตามความสำคัญ (D26/D30 — ด่วน = เหลือง, ด่วนมาก = แดง) */
export function priorityEdgeClass(priority: ProductionPriority): string {
  if (priority === "CRITICAL") return "before:bg-m3-error";
  if (priority === "URGENT") return "before:bg-m3-warning";
  return "before:bg-transparent";
}

/** แถบตัวเลขยอดของงาน — ก่อนจบงานโชว์เฉพาะเป้า; จบงานแล้วโชว์ ดี/เสีย/ขาด(หรือเกิน) */
export function JobNumbers({ job, compact = false }: { job: ProductionJob; compact?: boolean }) {
  const done = job.status === "COMPLETED";
  const over = done && (job.over_qty ?? 0) > 0;
  if (!done) {
    return (
      <div className={`grid gap-1.5 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
        <M3StatTile tone="grey" label={compact ? "เป้า" : "เป้าหมาย"} value={formatQty(job.target_qty)} unit={compact ? undefined : job.unit} />
      </div>
    );
  }
  return (
    <div className={`grid gap-1.5 ${compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`}>
      <M3StatTile tone="grey" label={compact ? "เป้า" : "เป้าหมาย"} value={formatQty(job.target_qty)} unit={compact ? undefined : job.unit} />
      <M3StatTile tone="primary" label={compact ? "ดี" : "ผลิตดี"} value={formatQty(job.produced_good)} />
      <M3StatTile tone="error" label={compact ? "เสีย" : "ของเสีย"} value={formatQty(job.defect_total)} />
      {over ? (
        <M3StatTile tone="info" label={compact ? "เกิน" : "ผลิตเกิน"} value={formatQty(job.over_qty)} />
      ) : (
        <M3StatTile tone="warning" label={compact ? "ขาด" : "ยังขาด"} value={formatQty(job.remaining_qty)} />
      )}
    </div>
  );
}

/** ป้ายสัญญาณเพิ่มเติม (D26): จบต่ำกว่าเป้า / ผลิตเกิน — คำนวณจากยอดที่มีอยู่แล้ว */
export function JobSignalBadges({ job }: { job: ProductionJob }) {
  const under = job.status === "COMPLETED" && job.remaining_qty > 0;
  const over = job.status === "COMPLETED" && (job.over_qty ?? 0) > 0;
  return (
    <>
      {under && (
        <span className="m3-label m3-label-error gap-1 px-2">
          <SolarDangerTriangle size={13} />
          จบต่ำกว่าเป้า
        </span>
      )}
      {over && (
        <span className="m3-label m3-label-info gap-1 px-2">
          <SolarArrowUp size={13} />
          ผลิตเกิน
        </span>
      )}
    </>
  );
}

/** คำอธิบายกติกาการแก้ไขตามสถานะ — ใช้ใน modal แก้ไขงาน */
export function editRuleHint(status: ProductionJobStatus): string {
  if (status === "DRAFT") return "ฉบับร่าง";
  if (status === "WAITING") return "แก้สินค้า จำนวน และโต๊ะได้";
  if (status === "IN_PROGRESS") return "แก้เฉพาะเป้าหมายและหมายเหตุ";
  return "งานสถานะนี้แก้ไขไม่ได้";
}
