"use client";

import type { ReceivingPlanView } from "../_hooks/use-receiving-plans";
import { PLAN_STATUS_LABEL } from "../_hooks/use-receiving-plans";

const cardClass =
  "bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

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
    return (
      <div className={`${cardClass} p-8 text-center text-slate-500 font-semibold`}>
        กำลังโหลดรายการแผนรับสินค้า…
      </div>
    );
  }

  if (error && plans.length === 0) {
    return (
      <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
        {error}
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className={`${cardClass} p-8 text-center space-y-2`}>
        <div className="w-12 h-12 mx-auto rounded-2xl bg-[#EAF2EE] border border-[#DFEDE6] grid place-items-center">
          <svg className="w-6 h-6 text-[#053425]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="font-extrabold text-slate-900">ไม่มีรายการที่ต้องรับใน{warehouseName}</p>
        <p className="text-sm text-slate-500 font-semibold">
          เมื่อแอดมินสร้างแผนรับสินค้าของโกดังนี้ รายการจะขึ้นที่นี่โดยอัตโนมัติ —
          หรือกดแท็บ “รับเข้า” เพื่อรับสินค้าแบบไม่มีแผนได้ตามปกติ
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {plans.map((plan) => {
        const targetLines = plan.lines.filter((l) => typeof l.expected_qty === "number");
        const fulfilledLines = targetLines.filter((l) => l.fulfilled).length;
        return (
          <article key={plan.document_id} className={`${cardClass} p-4 sm:p-5 space-y-3`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold text-slate-900 text-sm sm:text-base font-mono">
                    {plan.document_no}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                      plan.status === "PROCESSING"
                        ? "bg-amber-50 border-amber-200 text-amber-800"
                        : "bg-[#EAF2EE] border-[#DFEDE6] text-[#052B1F]"
                    }`}
                  >
                    {PLAN_STATUS_LABEL[plan.status] || plan.status}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600 font-semibold flex items-center gap-2 flex-wrap">
                  {plan.reference_no && <span>อ้างอิง: {plan.reference_no}</span>}
                  {plan.expected_date && (
                    <span className="text-slate-400">•</span>
                  )}
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
                      <span className="text-slate-400">•</span>
                      <span>รับแล้ว {plan.receipts.length} รอบ</span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onSelectPlan(plan)}
                className="shrink-0 min-h-11 px-4 rounded-xl bg-[#0F5C3F] hover:bg-[#0B4A31] text-white font-bold text-sm transition-colors cursor-pointer flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                รับตามแผนนี้
              </button>
            </div>

            <ul className="grid gap-1.5">
              {plan.lines.map((line) => (
                <li
                  key={line.product_id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[#F7F9F8] border border-[#EEF1EF] min-w-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {line.fulfilled ? (
                      <span className="w-4.5 h-4.5 w-[18px] h-[18px] rounded-full bg-[#0F5C3F] text-white grid place-items-center shrink-0">
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    ) : (
                      <span className="w-[18px] h-[18px] rounded-full border-2 border-[#CBD5D0] shrink-0" />
                    )}
                    <span className="text-sm font-bold text-slate-800 truncate">{line.product_name}</span>
                    <span className="text-xs font-mono text-slate-500 truncate">{line.sku}</span>
                  </div>
                  <span className="text-xs font-extrabold text-slate-700 shrink-0">
                    {typeof line.expected_qty === "number"
                      ? `${line.received_qty}/${line.expected_qty} ${line.base_unit}`
                      : `รับแล้ว ${line.received_qty} ${line.base_unit}`}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between gap-3 text-xs text-slate-500 font-semibold">
              <span>
                {targetLines.length > 0
                  ? `ครบแล้ว ${fulfilledLines}/${targetLines.length} รายการที่ตั้งเป้าไว้`
                  : `แผนเช็คลิสต์ ${plan.lines.length} รายการ (ไม่ตั้งเป้าจำนวน)`}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
