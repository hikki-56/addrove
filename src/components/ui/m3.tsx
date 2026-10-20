// ชิ้นส่วน UI ใช้ร่วมกันของ Minimal UI v3b (เฉพาะหน้าตา — ไม่มี state/logic)
// ใช้คู่กับ token/คลาสใน globals.css (m3-card, m3-btn, m3-label …)
import React, { type ReactNode } from "react";
import { SolarCheckCircle, SolarDangerCircle, SolarDangerTriangle, SolarInboxIn } from "@/components/icons";

/** คลาสมาตรฐาน: modal / bottom sheet, ฟอร์ม, ปุ่ม */
export const m3Cls = {
  overlay: "absolute inset-0 bg-m3-grey-800/48",
  // มือถือ = bottom sheet มุมบนโค้ง · ≥sm = dialog กลางจอ
  sheet:
    "relative flex w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-m3-dropdown animate-in fade-in slide-in-from-bottom-4 duration-150 sm:rounded-2xl sm:zoom-in-95 sm:slide-in-from-bottom-0",
  head: "px-5 pt-5 pb-1 sm:px-6 sm:pt-6",
  title: "text-lg font-bold text-m3-grey-800",
  hint: "mt-0.5 text-sm text-m3-grey-600",
  body: "flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6",
  foot: "flex justify-end gap-3 px-5 pb-5 pt-2 sm:px-6 sm:pb-6",
  btnCancel: "m3-btn m3-btn-outline h-11 px-5",
  btnPrimary: "m3-btn m3-btn-primary h-11 px-5 disabled:opacity-48",
  btnDanger: "m3-btn h-11 px-5 bg-m3-error text-white hover:bg-m3-error-dark disabled:opacity-48",
  btnDark: "m3-btn m3-btn-dark h-11 px-5 disabled:opacity-48",
  label: "text-xs font-semibold text-m3-grey-600",
  input:
    "w-full rounded-lg border border-[rgba(145,158,171,0.32)] bg-white px-3.5 py-2.5 text-sm font-medium text-m3-grey-800 placeholder:text-m3-grey-500 transition-colors hover:border-m3-grey-800 focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800 focus:outline-none disabled:border-[rgba(145,158,171,0.2)] disabled:bg-m3-grey-200 disabled:text-m3-grey-500",
  inputError:
    "w-full rounded-lg border border-m3-error bg-white px-3.5 py-2.5 text-sm font-medium text-m3-grey-800 focus:ring-1 focus:ring-m3-error focus:outline-none",
  card: "m3-card",
  spinner: "inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent",
} as const;

const BANNER_TONE = {
  info: { box: "bg-[rgba(0,184,217,0.12)] text-m3-info-dark", icon: SolarDangerCircle, iconCls: "text-m3-info" },
  success: { box: "bg-[rgba(34,197,94,0.12)] text-m3-success-dark", icon: SolarCheckCircle, iconCls: "text-m3-success" },
  warning: { box: "bg-[rgba(255,171,0,0.16)] text-m3-warning-dark", icon: SolarDangerTriangle, iconCls: "text-m3-warning" },
  error: { box: "bg-[rgba(255,86,48,0.12)] text-m3-error-dark", icon: SolarDangerCircle, iconCls: "text-m3-error" },
} as const;

export type M3Tone = keyof typeof BANNER_TONE;

/** แบนเนอร์แจ้งผล (D52 · notification banner) */
export function M3Banner({
  tone,
  title,
  children,
  action,
  className = "",
  role,
}: {
  tone: M3Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const t = BANNER_TONE[tone];
  const Icon = t.icon;
  return (
    <div role={role} className={`flex items-start gap-3 rounded-lg px-4 py-3 ${t.box} ${className}`}>
      <Icon size={20} className={`mt-px shrink-0 ${t.iconCls}`} />
      <div className="min-w-0 flex-1 text-sm">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5 font-medium" : "font-semibold"}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

/** ข้อความ error ของระบบผลิต: 409 (ข้อความแนะนำให้รีเฟรช) แสดงเป็นแบนเนอร์ "ข้อมูลงานไม่เป็นปัจจุบัน" (D52) */
export function isStaleDataMessage(message: string): boolean {
  return /รีเฟรช/.test(message);
}

export function M3ErrorBanner({ message, action, className }: { message: string; action?: ReactNode; className?: string }) {
  return isStaleDataMessage(message) ? (
    <M3Banner tone="warning" role="alert" title="ข้อมูลงานไม่เป็นปัจจุบัน" action={action} className={className}>
      {message}
    </M3Banner>
  ) : (
    <M3Banner tone="error" role="alert" action={action} className={className}>
      {message}
    </M3Banner>
  );
}

/** กล่องสถานะว่าง (D52 · SectionStateBox ว่าง) */
export function M3Empty({ title, icon, children }: { title: ReactNode; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-[rgba(145,158,171,0.32)] px-6 py-12 text-center">
      <span className="text-m3-grey-400">{icon ?? <SolarInboxIn size={36} />}</span>
      <p className="text-sm font-semibold text-m3-grey-600">{title}</p>
      {children}
    </div>
  );
}

/** สถานะกำลังโหลด (D52 · วงแหวนเขียว) */
export function M3Loading({ label }: { label: string }) {
  return (
    <div role="status" className="m3-card flex flex-col items-center justify-center gap-3 px-6 py-16 text-m3-primary-dark">
      <span aria-hidden="true" className="size-8 animate-spin rounded-full border-[3px] border-m3-primary border-r-transparent" />
      <p className="text-sm font-semibold">{label}</p>
    </div>
  );
}

/** กล่องโหลดไม่สำเร็จ (D52 · SectionStateBox ผิดพลาด) — ปุ่ม "ลองโหลดใหม่" เรียก onRetry ของผู้ใช้ */
export function M3ErrorState({ title, onRetry, retryLabel = "ลองโหลดใหม่", children }: { title: ReactNode; onRetry?: () => void; retryLabel?: string; children?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2.5 rounded-xl bg-[rgba(255,86,48,0.08)] px-6 py-10 text-center">
      <SolarDangerCircle size={32} className="text-m3-error" />
      <p className="text-sm font-bold text-m3-error-dark">{title}</p>
      {children}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="m3-btn m3-btn-sm m3-btn-outline mt-1 cursor-pointer">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/** โครงโหลดแบบตาราง (D52 · skeleton) */
export function M3Skeleton({ rows = 3, label }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-4 px-2 py-4">
      {label ? <span className="sr-only">{label}</span> : null}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6">
          <div className="flex-1 space-y-2">
            <div className="h-2.5 w-3/5 animate-pulse rounded-full bg-m3-grey-200" />
            <div className="h-2.5 w-2/5 animate-pulse rounded-full bg-m3-grey-200" />
          </div>
          <div className="h-2.5 w-16 animate-pulse rounded-full bg-m3-grey-200" />
        </div>
      ))}
    </div>
  );
}

const STAT_TONE = {
  grey: "bg-m3-grey-100 text-m3-grey-800",
  primary: "bg-[rgba(0,167,111,0.10)] text-m3-primary-dark",
  error: "bg-[rgba(255,86,48,0.10)] text-m3-error-dark",
  warning: "bg-[rgba(255,171,0,0.12)] text-m3-warning-dark",
  info: "bg-[rgba(0,184,217,0.10)] text-m3-info-dark",
} as const;

export type M3StatTone = keyof typeof STAT_TONE;

/** ช่องตัวเลขสี (เป้า / ดี / เสีย / ขาด) — D26/D30 */
export function M3StatTile({
  label,
  value,
  unit,
  tone,
  size = "sm",
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  tone: M3StatTone;
  size?: "sm" | "lg";
}) {
  return (
    <div className={`min-w-0 rounded-lg ${size === "lg" ? "px-4 py-3" : "px-2 py-1.5"} ${STAT_TONE[tone]}`}>
      <div className={`truncate font-medium text-m3-grey-600 ${size === "lg" ? "text-[13px]" : "text-[11px]"}`}>{label}</div>
      <div className={`truncate font-m3-disp font-bold tabular-nums ${size === "lg" ? "mt-1 text-2xl" : "text-base"}`}>
        {value}
        {unit ? <span className="ml-1 font-m3 text-[11px] font-semibold text-m3-grey-600">{unit}</span> : null}
      </div>
    </div>
  );
}

/** ป้ายเลขโต๊ะ/ลำดับ (ไทล์เข้ม 28px) */
export function M3NumberTile({ children, className = "size-7 text-[15px]" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-m3-grey-800 font-m3-disp font-bold text-white ${className}`}>
      {children}
    </span>
  );
}

const ICON_TONE = {
  primary: "bg-[rgba(0,167,111,0.12)] text-m3-primary",
  info: "bg-[rgba(0,184,217,0.12)] text-m3-info",
  warning: "bg-[rgba(255,171,0,0.16)] text-m3-warning",
  error: "bg-[rgba(255,86,48,0.12)] text-m3-error",
  grey: "bg-[rgba(145,158,171,0.16)] text-m3-grey-600",
} as const;

export type M3IconTone = keyof typeof ICON_TONE;

/** วงกลมไอคอนหัว dialog (52px — D29/D31) */
export function M3IconCircle({ tone, children }: { tone: M3IconTone; children: ReactNode }) {
  return (
    <span aria-hidden="true" className={`inline-flex size-13 shrink-0 items-center justify-center rounded-full ${ICON_TONE[tone]}`}>
      {children}
    </span>
  );
}

/**
 * โครง dialog (D29): มือถือ = bottom sheet, ≥sm = กล่องกลางจอ 16px radius
 * หัว = วงกลมไอคอน + หัวข้อ 20px + คำอธิบาย, ไม่มีเส้นคั่น, ปุ่มชิดขวา
 * (เฉพาะหน้าตา — การปิด/ESC/state อยู่ที่ component ที่เรียกใช้)
 */
export function M3Dialog({
  title,
  hint,
  subtitle,
  icon,
  iconTone = "primary",
  widthClass = "sm:max-w-[480px]",
  onBackdrop,
  footer,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  iconTone?: M3IconTone;
  widthClass?: string;
  onBackdrop?: () => void;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className={m3Cls.overlay} onClick={onBackdrop} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`${m3Cls.sheet} max-h-[92dvh] ${widthClass}`}
      >
        <div className="px-5 pt-6 sm:px-7 sm:pt-7">
          {icon ? (
            <div className="mb-4">
              <M3IconCircle tone={iconTone}>{icon}</M3IconCircle>
            </div>
          ) : null}
          <h2 className="text-xl font-bold text-m3-grey-800">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs font-semibold tabular-nums text-m3-grey-500">{subtitle}</p> : null}
          {hint ? <p className="mt-1.5 text-sm text-m3-grey-600">{hint}</p> : null}
        </div>
        {children ? <div className="flex-1 space-y-4 overflow-y-auto px-5 pt-5 pb-2 sm:px-7">{children}</div> : <div className="pt-2" />}
        {footer ? <div className="flex justify-end gap-3 px-5 pt-4 pb-5 sm:px-7 sm:pb-7">{footer}</div> : null}
      </div>
    </div>
  );
}

/** ปุ่มยืนยันพร้อม spinner ขณะส่ง */
export function M3SubmitLabel({ submitting, children }: { submitting: boolean; children: ReactNode }) {
  return submitting ? <span aria-label="กำลังส่ง" className={m3Cls.spinner} /> : <>{children}</>;
}

/** ช่องกรอกแบบ label ลอยบนเส้นขอบ (D32 · outlined text field) */
export function M3Field({
  label,
  error = false,
  children,
  className = "",
}: {
  label: ReactNode;
  error?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`relative block ${className}`}>
      <span
        className={`pointer-events-none absolute -top-2 left-3 z-[1] bg-white px-1 text-[11px] font-semibold ${
          error ? "text-m3-error-dark" : "text-m3-grey-500"
        }`}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
