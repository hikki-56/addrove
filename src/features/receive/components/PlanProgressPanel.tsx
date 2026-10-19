"use client";

import React from "react";
import { useWatch, type Control } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { ReceivingPlanView } from "@/features/receive/hooks/use-receiving-plans";
import { PLAN_STATUS_LABEL } from "@/features/receive/hooks/use-receiving-plans";
import { SolarCheckCircle } from "@/components/icons";

const cardClass = "m3-card";

interface PlanProgressPanelProps {
  plan: ReceivingPlanView;
  control: Control<ReceiveDocumentInput>;
  onExitPlan?: () => void;
}

export default function PlanProgressPanel({ plan, control, onExitPlan }: PlanProgressPanelProps) {
  // Subscribe here so quantity-only scans/edits update the plan even when the
  // parent props and field-array rows have not changed. Confirmation is separate.
  const formLines = useWatch({ control, name: "lines" }) || [];
  const sessionQtyByProduct = new Map<string, number>();
  for (const line of formLines || []) {
    if (!line?.product_id) continue;
    sessionQtyByProduct.set(
      line.product_id,
      (sessionQtyByProduct.get(line.product_id) || 0) + (Number(line.qty) || 0)
    );
  }

  const progressLines = plan.lines.map((line) => {
    const sessionQty = sessionQtyByProduct.get(line.product_id) || 0;
    const totalIncludingSession = line.received_qty + sessionQty;
    const hasTarget = typeof line.expected_qty === "number";
    return {
      line, sessionQty, totalIncludingSession, hasTarget,
      overTarget: hasTarget && totalIncludingSession > (line.expected_qty as number),
      reachedTarget: hasTarget && totalIncludingSession >= (line.expected_qty as number),
    };
  });
  const targetCount = progressLines.filter((line) => line.hasTarget).length;
  const fulfilledCount = progressLines.filter((line) => line.reachedTarget).length;
  const hasAnyTarget = targetCount > 0;

  return (
    <section className={`${cardClass} overflow-hidden`}>
      <div className="flex flex-col gap-3 bg-[rgba(0,167,111,0.08)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="m3-label bg-m3-primary text-white">กำลังรับตามแผน</span>
            <span className="text-base font-bold tabular-nums text-m3-grey-800">{plan.document_no}</span>
            <span className="m3-label m3-label-info">{PLAN_STATUS_LABEL[plan.status] || plan.status}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm text-m3-grey-600">
            <span>{plan.warehouse_name}</span>
            {plan.reference_no && <span className="text-m3-grey-400">·</span>}
            {plan.reference_no && <span>อ้างอิง: {plan.reference_no}</span>}
            {hasAnyTarget && (
              <>
                <span className="text-m3-grey-400">·</span>
                <span aria-live="polite" aria-atomic="true">
                  ครบตามจำนวน {fulfilledCount}/{targetCount} รายการ (รวมรอบนี้)
                </span>
              </>
            )}
          </div>
          <p className="mt-1 text-xs text-m3-grey-500">ยอดรอบนี้แสดงทันทีเมื่อสแกน และจะบันทึกเมื่อกดบันทึกรับสินค้า</p>
        </div>
        {onExitPlan && (
          <button type="button" onClick={onExitPlan} className="m3-btn m3-btn-outline shrink-0 self-start bg-white">
            ออกจากโหมดแผน
          </button>
        )}
      </div>

      <ul className="divide-y divide-dashed divide-[rgba(145,158,171,0.32)]">
        {progressLines.map(({ line, sessionQty, totalIncludingSession, hasTarget, overTarget, reachedTarget }) => {
          return (
            <li key={line.product_id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2.5">
                  {reachedTarget ? (
                    <SolarCheckCircle size={20} className="shrink-0 text-m3-primary" />
                  ) : (
                    <span className="size-5 shrink-0 rounded-full border-2 border-[rgba(145,158,171,0.32)]" />
                  )}
                  <span className="truncate text-sm font-semibold text-m3-grey-800">{line.product_name}</span>
                  <span className="hidden truncate text-xs tabular-nums text-m3-grey-500 sm:inline">{line.sku}</span>
                </div>
                <div className="mt-1 ml-[30px] text-xs text-m3-grey-600">
                  รับไปแล้ว {line.received_qty} {line.base_unit}
                  <span className="font-bold text-m3-primary-dark"> + สแกนรอบนี้ {sessionQty} {line.base_unit}</span>
                  {overTarget && (
                    <span className="ml-1.5 font-bold text-m3-warning-dark">
                      (เกินเป้าที่คาดไว้ {(line.expected_qty as number)} — บันทึกตามของจริงได้)
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {hasTarget ? (
                  <span className={`m3-label tabular-nums ${reachedTarget ? "m3-label-success" : "m3-label-default"}`}>
                    {totalIncludingSession}/{line.expected_qty} {line.base_unit}
                  </span>
                ) : (
                  <span className="m3-label m3-label-default">เช็คลิสต์ (ไม่ตั้งเป้า)</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
