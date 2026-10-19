"use client";

import React from "react";
import { useWatch, type Control } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { ReceivingPlanView } from "@/features/receive/hooks/use-receiving-plans";
import { PLAN_STATUS_LABEL } from "@/features/receive/hooks/use-receiving-plans";

const cardClass =
  "bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

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
      <div className="px-4 sm:px-5 py-3.5 flex items-start justify-between gap-3 border-b border-[#EEF1EF] bg-[#F7FAF8]">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-[#0F5C3F] text-white">
              กำลังรับตามแผน
            </span>
            <span className="font-extrabold text-slate-900 text-sm sm:text-base font-mono">{plan.document_no}</span>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#EAF2EE] border border-[#DFEDE6] text-[#052B1F]">
              {PLAN_STATUS_LABEL[plan.status] || plan.status}
            </span>
          </div>
          <div className="mt-1.5 text-sm text-slate-600 font-semibold flex items-center gap-2 flex-wrap">
            <span>{plan.warehouse_name}</span>
            {plan.reference_no && (
              <span className="text-slate-400">•</span>
            )}
            {plan.reference_no && <span>อ้างอิง: {plan.reference_no}</span>}
            {hasAnyTarget && (
              <>
                <span className="text-slate-400">•</span>
                <span aria-live="polite" aria-atomic="true">
                  ครบตามจำนวน {fulfilledCount}/{targetCount} รายการ (รวมรอบนี้)
                </span>
              </>
            )}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            ยอดรอบนี้แสดงทันทีเมื่อสแกน และจะบันทึกเมื่อกดบันทึกรับสินค้า
          </p>
        </div>
        {onExitPlan && (
          <button
            type="button"
            onClick={onExitPlan}
            className="shrink-0 min-h-10 px-3.5 rounded-xl bg-black/[.04] hover:bg-black/[.07] text-slate-700 font-bold text-sm transition-colors cursor-pointer"
          >
            ออกจากโหมดแผน
          </button>
        )}
      </div>

      <ul className="divide-y divide-[#EEF1EF]">
        {progressLines.map(({ line, sessionQty, totalIncludingSession, hasTarget, overTarget, reachedTarget }) => {
          return (
            <li key={line.product_id} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  {reachedTarget ? (
                    <span className="w-5 h-5 rounded-full bg-[#0F5C3F] text-white grid place-items-center shrink-0">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : (
                    <span className="w-5 h-5 rounded-full border-2 border-[#CBD5D0] shrink-0" />
                  )}
                  <span className="font-bold text-slate-900 text-sm truncate">{line.product_name}</span>
                  <span className="text-xs font-mono text-slate-500 truncate">{line.sku}</span>
                </div>
                <div className="mt-1 ml-7 text-xs text-slate-600 font-semibold">
                  รับไปแล้ว {line.received_qty} {line.base_unit}
                  <span className="text-[#0F5C3F] font-extrabold"> + สแกนรอบนี้ {sessionQty} {line.base_unit}</span>
                  {overTarget && (
                    <span className="ml-1.5 text-amber-700 font-extrabold">
                      (เกินเป้าที่คาดไว้ {(line.expected_qty as number)} — บันทึกตามของจริงได้)
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {hasTarget ? (
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-extrabold ${
                      reachedTarget
                        ? "bg-[#EAF2EE] border border-[#C9DFD4] text-[#052B1F]"
                        : "bg-slate-100 border border-[#E8ECEA] text-slate-700"
                    }`}
                  >
                    {totalIncludingSession}/{line.expected_qty} {line.base_unit}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 border border-[#E8ECEA] text-slate-500">
                    เช็คลิสต์ (ไม่ตั้งเป้า)
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
