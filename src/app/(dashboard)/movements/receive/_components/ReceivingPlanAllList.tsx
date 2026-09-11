"use client";

import { useMemo, useState } from "react";
import type { ReceivingPlanView } from "../_hooks/use-receiving-plans";
import { PLAN_STATUS_LABEL } from "../_hooks/use-receiving-plans";

const cardClass =
  "bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "ทั้งหมด" },
  { value: "OPEN", label: "รอรับ/กำลังรับ" },
  { value: "COMPLETED", label: "ปิดแผนแล้ว" },
  { value: "CANCELLED", label: "ยกเลิก" },
];

function statusChipClass(status: string): string {
  switch (status) {
    case "PENDING":
      return "bg-[#EAF2EE] border-[#DFEDE6] text-[#052B1F]";
    case "PROCESSING":
      return "bg-amber-50 border-amber-200 text-amber-800";
    case "COMPLETED":
      return "bg-slate-100 border-[#E8ECEA] text-slate-600";
    case "CANCELLED":
      return "bg-rose-50 border-rose-200 text-rose-700";
    default:
      return "bg-slate-100 border-[#E8ECEA] text-slate-600";
  }
}

interface ReceivingPlanAllListProps {
  plans: ReceivingPlanView[];
  loading: boolean;
  error: string;
  isMutating: boolean;
  onClosePlan: (plan: ReceivingPlanView) => void;
  onCancelPlan: (plan: ReceivingPlanView) => void;
}

export default function ReceivingPlanAllList({
  plans,
  loading,
  error,
  isMutating,
  onClosePlan,
  onCancelPlan,
}: ReceivingPlanAllListProps) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  // ปุ่มยืนยันแบบสองจังหวะ (กดครั้งแรก = ขอยืนยัน, กดซ้ำใน 5 วิ = ทำจริง)
  const [confirming, setConfirming] = useState<{ id: string; action: "close" | "cancel" } | null>(null);

  const filtered = useMemo(() => {
    if (statusFilter === "ALL") return plans;
    if (statusFilter === "OPEN") return plans.filter((p) => p.status === "PENDING" || p.status === "PROCESSING");
    return plans.filter((p) => p.status === statusFilter);
  }, [plans, statusFilter]);

  const handleConfirmable = (plan: ReceivingPlanView, action: "close" | "cancel") => {
    if (confirming?.id === plan.document_id && confirming.action === action) {
      setConfirming(null);
      if (action === "close") onClosePlan(plan);
      else onCancelPlan(plan);
      return;
    }
    setConfirming({ id: plan.document_id, action });
    setTimeout(() => {
      setConfirming((prev) => (prev && prev.id === plan.document_id && prev.action === action ? null : prev));
    }, 5000);
  };

  if (!loading && !error && plans.length === 0) {
    return (
      <div className={`${cardClass} p-8 text-center text-slate-500 font-semibold`}>
        ยังไม่มีแผนรับสินค้า — สร้างแผนแรกได้ในแท็บ “สร้างแผนรับ”
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`px-3.5 py-2 rounded-xl text-sm font-bold border transition-colors cursor-pointer ${
              statusFilter === f.value
                ? "bg-[#0F5C3F] text-white border-[#0F5C3F]"
                : "bg-white text-slate-600 border-[#E8ECEA] hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && plans.length === 0 && (
        <div className={`${cardClass} p-8 text-center text-slate-500 font-semibold`}>กำลังโหลด…</div>
      )}

      {error && plans.length === 0 && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
          {error}
        </div>
      )}

      {filtered.map((plan) => {
        const targetLines = plan.lines.filter((l) => typeof l.expected_qty === "number");
        const fulfilledLines = targetLines.filter((l) => l.fulfilled).length;
        const isOpen = plan.status === "PENDING" || plan.status === "PROCESSING";
        const closeConfirming = confirming?.id === plan.document_id && confirming.action === "close";
        const cancelConfirming = confirming?.id === plan.document_id && confirming.action === "cancel";

        return (
          <article key={plan.document_id} className={`${cardClass} p-4 sm:p-5 space-y-3`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold text-slate-900 text-sm sm:text-base font-mono">
                    {plan.document_no}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusChipClass(plan.status)}`}>
                    {PLAN_STATUS_LABEL[plan.status] || plan.status}
                  </span>
                  <span className="text-xs text-slate-500 font-semibold">{plan.warehouse_name}</span>
                </div>
                <div className="mt-1 text-sm text-slate-600 font-semibold flex items-center gap-2 flex-wrap">
                  {plan.reference_no && <span>อ้างอิง: {plan.reference_no}</span>}
                  {plan.expected_date && (
                    <>
                      <span className="text-slate-400">•</span>
                      <span>
                        คาดมาถึง{" "}
                        {new Date(plan.expected_date + "T00:00:00").toLocaleDateString("th-TH", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </>
                  )}
                  <span className="text-slate-400">•</span>
                  <span>สร้าง {new Date(plan.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</span>
                  {plan.receipts.length > 0 && (
                    <>
                      <span className="text-slate-400">•</span>
                      <span>รับแล้ว {plan.receipts.length} รอบ</span>
                    </>
                  )}
                </div>
                {plan.note && <p className="mt-1 text-xs text-slate-500 font-semibold">{plan.note}</p>}
              </div>

              {isOpen && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => handleConfirmable(plan, "close")}
                    className={`min-h-10 px-3.5 rounded-xl font-bold text-sm transition-colors cursor-pointer border ${
                      closeConfirming
                        ? "bg-[#0F5C3F] text-white border-[#0F5C3F]"
                        : "bg-white text-slate-700 border-[#E8ECEA] hover:bg-slate-50"
                    } disabled:opacity-60`}
                  >
                    {closeConfirming ? "ยืนยันปิดแผน?" : "ปิดแผน"}
                  </button>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => handleConfirmable(plan, "cancel")}
                    className={`min-h-10 px-3.5 rounded-xl font-bold text-sm transition-colors cursor-pointer border ${
                      cancelConfirming
                        ? "bg-rose-600 text-white border-rose-600"
                        : "bg-white text-rose-600 border-rose-200 hover:bg-rose-50"
                    } disabled:opacity-60`}
                  >
                    {cancelConfirming ? "ยืนยันยกเลิก?" : "ยกเลิก"}
                  </button>
                </div>
              )}
            </div>

            <details className="group">
              <summary className="cursor-pointer text-sm font-bold text-slate-600 hover:text-slate-900 select-none">
                {targetLines.length > 0
                  ? `รายการ ${plan.lines.length} รายการ — ครบแล้ว ${fulfilledLines}/${targetLines.length} ที่ตั้งเป้า`
                  : `รายการ ${plan.lines.length} รายการ (เช็คลิสต์)`}
                <span className="ml-1.5 inline-block transition-transform group-open:rotate-90">▸</span>
              </summary>
              <ul className="mt-2 grid gap-1.5">
                {plan.lines.map((line) => (
                  <li
                    key={line.product_id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[#F7F9F8] border border-[#EEF1EF] min-w-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
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
                {plan.receipts.length > 0 && (
                  <li className="px-3 py-2 rounded-xl bg-slate-50 border border-[#E8ECEA] text-xs text-slate-600 font-semibold space-y-1">
                    {plan.receipts.map((r) => (
                      <div key={r.document_id} className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold">{r.document_no}</span>
                        <span className="text-slate-400">•</span>
                        <span>{r.received_by_name || "พนักงาน"}</span>
                        <span className="text-slate-400">•</span>
                        <span>
                          {new Date(r.received_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                        <span className="text-slate-400">•</span>
                        <span>
                          {r.lines.map((l) => `${l.qty}`).join(" + ")} ชิ้น
                        </span>
                      </div>
                    ))}
                  </li>
                )}
              </ul>
            </details>
          </article>
        );
      })}

      {!loading && filtered.length === 0 && plans.length > 0 && (
        <div className={`${cardClass} p-6 text-center text-slate-500 font-semibold`}>
          ไม่มีแผนที่ตรงกับตัวกรองนี้
        </div>
      )}
    </div>
  );
}
