"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";

// ============================================================
// แผนรับสินค้า (Receiving Plan) — mirror ของ ReceivingPlanView
// ฝั่ง service (src/lib/services/stock/receiving-plan.ts)
// แยก type ไว้ที่นี่เพื่อไม่ดึงโมดูลฝั่ง server เข้า client bundle
// ============================================================

export interface ReceivingPlanLineView {
  product_id: string;
  sku: string;
  barcode: string;
  product_name: string;
  base_unit: string;
  expected_qty?: number;
  expected_boxes?: number;
  note?: string;
  received_qty: number;
  fulfilled: boolean;
}

export interface ReceivingPlanReceiptLogView {
  document_id: string;
  document_no: string;
  received_at: string;
  received_by_name: string;
  lines: Array<{ product_id: string; qty: number }>;
}

export interface ReceivingPlanView {
  document_id: string;
  document_no: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "CANCELLED" | string;
  warehouse_id: string;
  warehouse_name: string;
  reference_no: string;
  expected_date: string;
  note: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  lines: ReceivingPlanLineView[];
  receipts: ReceivingPlanReceiptLogView[];
  progress: {
    lines_total: number;
    lines_with_target: number;
    lines_fulfilled: number;
    has_target: boolean;
    fully_received: boolean;
  };
}

export interface ReceivingPlanCreatePayload {
  warehouse_id: string;
  reference_no: string;
  expected_date: string;
  note: string;
  lines: Array<{
    product_id: string;
    expected_qty?: number;
    expected_boxes?: number;
    note?: string;
  }>;
}

export function isPlanOpen(plan: ReceivingPlanView): boolean {
  return plan.status === "PENDING" || plan.status === "PROCESSING";
}

export const PLAN_STATUS_LABEL: Record<string, string> = {
  PENDING: "รอรับ",
  PROCESSING: "กำลังรับ",
  COMPLETED: "รับครบ/ปิดแผน",
  CANCELLED: "ยกเลิก",
};

function normalizeWhId(v: string): string {
  return (v || "").trim().toLowerCase().replace(/^wh-0*(\d+)$/, "wh-$1");
}

export interface UseReceivingPlansOptions {
  activeWhId: string;
  /** โหลดทุกสถานะ (หน้าแอดมิน "แผนทั้งหมด") — ค่าเริ่มต้นโหลดเฉพาะที่ยังเปิดอยู่ */
  includeAllStatuses?: boolean;
}

export function useReceivingPlans({ activeWhId, includeAllStatuses = false }: UseReceivingPlansOptions) {
  const [plans, setPlans] = useState<ReceivingPlanView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [isMutating, setIsMutating] = useState(false);

  const fetchPlans = useCallback(
    async (initial = false) => {
      if (!activeWhId) return;
      if (initial) setLoading(true);
      try {
        const statusParam = includeAllStatuses ? "" : "&status=OPEN";
        const res = await fetch(
          `/api/receiving-plans?warehouse_id=${encodeURIComponent(activeWhId)}${statusParam}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setPlans(json.data as ReceivingPlanView[]);
          setError("");
        } else {
          setError(json.message || "โหลดรายการแผนรับสินค้าไม่สำเร็จ");
        }
      } catch {
        setError("ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองอีกครั้ง");
      } finally {
        if (initial) setLoading(false);
      }
    },
    [activeWhId, includeAllStatuses]
  );

  // polling ตอนแท็บ visible — แผนใหม่ที่แอดมินสร้างจะขึ้นเองโดยไม่ต้องรีเฟรชหน้า
  // wrapper ต้อง memoize เพราะ hook ใช้ callback เป็น dependency ของ effect
  // (ถ้าส่ง arrow function ใหม่ทุก render จะกลายเป็น fetch loop ไม่รู้จบ)
  const pollingFetch = useCallback(
    (initial?: boolean) => {
      void fetchPlans(Boolean(initial));
    },
    [fetchPlans]
  );
  usePollingWhenVisible(pollingFetch, 30000);

  const refresh = useCallback(() => fetchPlans(false), [fetchPlans]);

  const createPlan = useCallback(
    async (payload: ReceivingPlanCreatePayload): Promise<boolean> => {
      setActionError("");
      setActionSuccess("");
      setIsMutating(true);
      try {
        const res = await fetch("/api/receiving-plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.success) {
          setActionSuccess(`สร้างแผนรับสินค้า ${(json.data as ReceivingPlanView)?.document_no || ""} เรียบร้อยแล้ว`);
          await fetchPlans(false);
          return true;
        }
        setActionError(json.message || "สร้างแผนรับสินค้าไม่สำเร็จ");
        return false;
      } catch {
        setActionError("ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองอีกครั้ง");
        return false;
      } finally {
        setIsMutating(false);
      }
    },
    [fetchPlans]
  );

  const runPlanAction = useCallback(
    async (planId: string, action: "cancel" | "close", reason = ""): Promise<boolean> => {
      setActionError("");
      setActionSuccess("");
      setIsMutating(true);
      try {
        const res = await fetch(`/api/receiving-plans/${encodeURIComponent(planId)}/${action}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        const json = await res.json();
        if (json.success) {
          setActionSuccess(json.message || "ดำเนินการเรียบร้อยแล้ว");
          await fetchPlans(false);
          return true;
        }
        setActionError(json.message || "ดำเนินการไม่สำเร็จ");
        return false;
      } catch {
        setActionError("ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองอีกครั้ง");
        return false;
      } finally {
        setIsMutating(false);
      }
    },
    [fetchPlans]
  );

  const cancelPlan = useCallback((planId: string, reason = "") => runPlanAction(planId, "cancel", reason), [runPlanAction]);
  const closePlan = useCallback((planId: string, reason = "") => runPlanAction(planId, "close", reason), [runPlanAction]);

  const openPlans = useMemo(() => plans.filter(isPlanOpen), [plans]);

  // ล้าง action message อัตโนมัติ
  useEffect(() => {
    if (!actionSuccess) return;
    const t = setTimeout(() => setActionSuccess(""), 6000);
    return () => clearTimeout(t);
  }, [actionSuccess]);

  return {
    plans,
    openPlans,
    loading,
    error,
    actionError,
    actionSuccess,
    isMutating,
    refresh,
    createPlan,
    cancelPlan,
    closePlan,
    setActionError,
    setActionSuccess,
  };
}
