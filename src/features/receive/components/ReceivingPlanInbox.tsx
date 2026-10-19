"use client";

import type { ReceivingPlanView } from "@/features/receive/hooks/use-receiving-plans";
import { PLAN_STATUS_LABEL } from "@/features/receive/hooks/use-receiving-plans";
import { M3Banner, M3Empty, M3Loading } from "@/components/ui/m3";
import { SolarCheckCircle } from "@/components/icons";

const cardClass = "m3-card";

/** สีป้ายสถานะแผน (D14 — รอรับ = เหลือง, กำลังรับ = ฟ้า) */
const PLAN_STATUS_TONE: Record<string, string> = {
  PENDING: "m3-label-warning",
  PROCESSING: "m3-label-info",
  COMPLETED: "m3-label-success",
  CANCELLED: "m3-label-default",
};

interface ReceivingPlanInboxProps {
  plans: ReceivingPlanView[];
  loading: boolean;
  error: string;
  warehouseName: string;
  /** เลือกแผนเพื่อเริ่ม "รับตามแผน" */
  onSelectPlan: (plan: ReceivingPlanView) => void;
}

export default function ReceivingPlanInbox({
  plans,
  loading,
  error,
  warehouseName,
  onSelectPlan,
}: ReceivingPlanInboxProps) {
  if (loading && plans.length === 0) {
    return <M3Loading label="กำลังโหลดรายการแผนรับสินค้า…" />;
  }

  if (error && plans.length === 0) {
    return <M3Banner tone="error" role="alert">{error}</M3Banner>;
  }

  if (plans.length === 0) {
    return (
      <div className={`${cardClass} p-6`}>
        <M3Empty title={`ไม่มีรายการที่ต้องรับใน${warehouseName}`} icon={<SolarCheckCircle size={36} />} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-5">
      {plans.map((plan) => {
        const targetLines = plan.lines.filter((l) => typeof l.expected_qty === "number");
        const fulfilledLines = targetLines.filter((l) => l.fulfilled).length;
        return (
          <article key={plan.document_id} className={`${cardClass} p-5 sm:p-6`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold tabular-nums text-m3-grey-800">{plan.document_no}</span>
                  <span className={`m3-label ${PLAN_STATUS_TONE[plan.status] || "m3-label-default"}`}>
                    {PLAN_STATUS_LABEL[plan.status] || plan.status}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-m3-grey-600">
                  {plan.reference_no && <span>อ้างอิง: {plan.reference_no}</span>}
                  {plan.expected_date && <span className="text-m3-grey-400">·</span>}
                  {plan.expected_date && (
                    <span>
                      คาดว่าจะมาถึง{" "}
                      {new Date(plan.expected_date + "T00:00:00").toLocaleDateString("th-TH", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                  {plan.receipts.length > 0 && (
                    <>
                      <span className="text-m3-grey-400">·</span>
                      <span>รับแล้ว {plan.receipts.length} รอบ</span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onSelectPlan(plan)}
                className="m3-btn m3-btn-primary hidden shrink-0 sm:inline-flex"
              >
                รับตามแผนนี้
              </button>
            </div>

            <ul className="mt-4 space-y-2.5 border-t border-dashed border-[rgba(145,158,171,0.32)] pt-4">
              {plan.lines.map((line) => (
                <li key={line.product_id} className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {line.fulfilled ? (
                      <SolarCheckCircle size={20} className="shrink-0 text-m3-primary" />
                    ) : (
                      <span className="size-5 shrink-0 rounded-full border-2 border-[rgba(145,158,171,0.32)]" />
                    )}
                    <span className="truncate text-sm font-medium text-m3-grey-800">{line.product_name}</span>
                    <span className="hidden truncate text-xs tabular-nums text-m3-grey-500 sm:inline">{line.sku}</span>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-m3-grey-600">
                    {typeof line.expected_qty === "number"
                      ? `${line.received_qty}/${line.expected_qty} ${line.base_unit}`
                      : `รับแล้ว ${line.received_qty} ${line.base_unit}`}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs text-m3-grey-500">
              {targetLines.length > 0
                ? `ครบแล้ว ${fulfilledLines}/${targetLines.length} รายการที่ตั้งเป้าไว้`
                : `แผนเช็คลิสต์ ${plan.lines.length} รายการ (ไม่ตั้งเป้าจำนวน)`}
            </p>
            <button
              type="button"
              onClick={() => onSelectPlan(plan)}
              className="m3-btn m3-btn-primary mt-4 h-12 w-full text-[15px] shadow-[0_8px_16px_rgba(0,167,111,0.24)] sm:hidden"
            >
              รับตามแผนนี้
            </button>
          </article>
        );
      })}
    </div>
  );
}
