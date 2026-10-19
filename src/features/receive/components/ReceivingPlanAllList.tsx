"use client";

import { useMemo, useState } from "react";
import type { ReceivingPlanView } from "@/features/receive/hooks/use-receiving-plans";
import { PLAN_STATUS_LABEL } from "@/features/receive/hooks/use-receiving-plans";
import { M3Banner, M3Empty, M3Loading } from "@/components/ui/m3";
import { SolarAltArrowRight } from "@/components/icons";

const cardClass =
  "m3-card";

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "ทั้งหมด" },
  { value: "OPEN", label: "รอรับ/กำลังรับ" },
  { value: "COMPLETED", label: "ปิดแผนแล้ว" },
  { value: "CANCELLED", label: "ยกเลิก" },
];

function statusChipClass(status: string): string {
  switch (status) {
    case "PENDING":
      return "m3-label-warning";
    case "PROCESSING":
      return "m3-label-info";
    case "COMPLETED":
      return "m3-label-success";
    case "CANCELLED":
      return "m3-label-error";
    default:
      return "m3-label-default";
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
      <div className={`${cardClass} p-6`}>
        <M3Empty title="ยังไม่มีแผนรับสินค้า" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            aria-pressed={statusFilter === f.value}
            className={`h-9 cursor-pointer rounded-full px-4 text-sm font-semibold transition-colors ${
              statusFilter === f.value
                ? "bg-m3-grey-800 text-white"
                : "bg-white text-m3-grey-600 shadow-[inset_0_0_0_1px_rgba(145,158,171,0.32)] hover:bg-[rgba(145,158,171,0.08)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && plans.length === 0 && (
        <M3Loading label="กำลังโหลด…" />
      )}

      {error && plans.length === 0 && (
        <M3Banner tone="error" role="alert">{error}</M3Banner>
      )}

      {filtered.map((plan) => {
        const targetLines = plan.lines.filter((l) => typeof l.expected_qty === "number");
        const fulfilledLines = targetLines.filter((l) => l.fulfilled).length;
        const isOpen = plan.status === "PENDING" || plan.status === "PROCESSING";
        const closeConfirming = confirming?.id === plan.document_id && confirming.action === "close";
        const cancelConfirming = confirming?.id === plan.document_id && confirming.action === "cancel";

        return (
          <article key={plan.document_id} className={`${cardClass} space-y-3 p-5`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-bold tabular-nums text-m3-grey-800">
                    {plan.document_no}
                  </span>
                  <span className={`m3-label ${statusChipClass(plan.status)}`}>
                    {PLAN_STATUS_LABEL[plan.status] || plan.status}
                  </span>
                  <span className="text-sm text-m3-grey-600">{plan.warehouse_name}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-m3-grey-600">
                  {plan.reference_no && <span>อ้างอิง: {plan.reference_no}</span>}
                  {plan.expected_date && (
                    <>
                      <span className="text-m3-grey-400">·</span>
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
                  <span className="text-m3-grey-400">·</span>
                  <span>สร้าง {new Date(plan.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</span>
                  {plan.receipts.length > 0 && (
                    <>
                      <span className="text-m3-grey-400">·</span>
                      <span>รับแล้ว {plan.receipts.length} รอบ</span>
                    </>
                  )}
                </div>
                {plan.note && <p className="mt-1 text-xs text-m3-grey-500">{plan.note}</p>}
              </div>

              {isOpen && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => handleConfirmable(plan, "close")}
                    className={`m3-btn disabled:opacity-48 ${closeConfirming ? "m3-btn-dark" : "m3-btn-outline"}`}
                  >
                    {closeConfirming ? "ยืนยันปิดแผน?" : "ปิดแผน"}
                  </button>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => handleConfirmable(plan, "cancel")}
                    className={`m3-btn disabled:opacity-48 ${
                      cancelConfirming
                        ? "bg-m3-error text-white hover:bg-m3-error-dark"
                        : "m3-btn-text text-m3-error-dark hover:bg-[rgba(255,86,48,0.08)]"
                    }`}
                  >
                    {cancelConfirming ? "ยืนยันยกเลิก?" : "ยกเลิก"}
                  </button>
                </div>
              )}
            </div>

            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 border-t border-dashed border-[rgba(145,158,171,0.32)] pt-3 text-sm font-semibold text-m3-grey-600 select-none hover:text-m3-grey-800 [&::-webkit-details-marker]:hidden">
                {targetLines.length > 0
                  ? `รายการ ${plan.lines.length} รายการ — ครบแล้ว ${fulfilledLines}/${targetLines.length} ที่ตั้งเป้า`
                  : `รายการ ${plan.lines.length} รายการ (เช็คลิสต์)`}
                <SolarAltArrowRight size={16} className="transition-transform group-open:rotate-90" />
              </summary>
              <ul className="mt-2 grid gap-1.5">
                {plan.lines.map((line) => (
                  <li
                    key={line.product_id}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-m3-grey-100 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-sm font-medium text-m3-grey-800">{line.product_name}</span>
                      <span className="truncate text-xs tabular-nums text-m3-grey-500">{line.sku}</span>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-m3-grey-600">
                      {typeof line.expected_qty === "number"
                        ? `${line.received_qty}/${line.expected_qty} ${line.base_unit}`
                        : `รับแล้ว ${line.received_qty} ${line.base_unit}`}
                    </span>
                  </li>
                ))}
                {plan.receipts.length > 0 && (
                  <li className="space-y-1 rounded-lg border border-dashed border-[rgba(145,158,171,0.32)] px-3 py-2 text-xs text-m3-grey-600">
                    {plan.receipts.map((r) => (
                      <div key={r.document_id} className="flex items-center gap-2 flex-wrap">
                        <span className="tabular-nums font-bold">{r.document_no}</span>
                        <span className="text-m3-grey-400">·</span>
                        <span>{r.received_by_name || "พนักงาน"}</span>
                        <span className="text-m3-grey-400">·</span>
                        <span>
                          {new Date(r.received_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                        <span className="text-m3-grey-400">·</span>
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
        <div className={`${cardClass} p-6`}>
          <M3Empty title="ไม่มีแผนที่ตรงกับตัวกรองนี้" />
        </div>
      )}
    </div>
  );
}
