"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTabAuth } from "@/context/TabAuthContext";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { isProductionReviewer } from "@/lib/production-reviewers";
import type { ProductionOrderRecord } from "@/types/production";

// Flow การผลิต: แอดมินสร้างใบผลิต → คนตรวจกรอกผลจริงที่นี่ → กดยืนยัน → ตัดสต็อกทันที

const WAREHOUSES = [
  { id: "wh-01", name: "โกดัง 1" },
  { id: "wh-02", name: "โกดัง 2 (สินค้าสำเร็จรูป)" },
  { id: "wh-03", name: "โกดัง 3" },
  { id: "wh-04", name: "โกดัง 4" },
  { id: "wh-05", name: "โกดัง 5" },
  { id: "wh-06", name: "สำนักงานใหญ่" },
];

const STATUS_LABELS: Record<string, string> = {
  PENDING: "รอตรวจ",
  IN_PROGRESS: "ตรวจแล้วบางส่วน",
  COMPLETED: "เสร็จสมบูรณ์",
  CANCELLED: "ยกเลิก",
};

interface FgForm {
  fg_sku: string;
  fg_name: string;
  fg_unit: string;
  ordered: number;
  remaining: number;
  good_qty: string;
  defect_qty: string;
  warehouse_id: string;
  location: string;
}

interface RmForm {
  rm_sku: string;
  rm_name: string;
  rm_unit: string;
  remaining: number;
  used_qty: string;
  wasted_qty: string;
}

interface ConfirmSuccess {
  order_no: string;
  round_no: number;
  status: string;
  total_good: number;
  total_defect: number;
  materials_used: { sku: string; name: string; used: number; wasted: number }[];
  leftover_moved: { sku: string; qty: number }[];
  leftover_warehouse: string;
  leftover_location: string;
  message: string;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof window !== "undefined") {
    const token =
      sessionStorage.getItem("stockify_tab_token") || localStorage.getItem("stockify_tab_token");
    if (token) {
      headers["x-tab-token"] = token;
      headers["Authorization"] = `Bearer ${token}`;
    }
  }
  return headers;
}

export default function ProductionReviewPage() {
  const { user } = useTabAuth();
  const canReview = user?.role === "ADMIN" || isProductionReviewer({ email: user?.email, name: user?.name });

  const [orders, setOrders] = useState<ProductionOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [selectedOrder, setSelectedOrder] = useState<ProductionOrderRecord | null>(null);
  const [fgForm, setFgForm] = useState<FgForm[]>([]);
  const [rmForm, setRmForm] = useState<RmForm[]>([]);
  const [closeOrder, setCloseOrder] = useState(false);
  const [leftoverWarehouseId, setLeftoverWarehouseId] = useState("wh-02");
  const [leftoverLocation, setLeftoverLocation] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<ConfirmSuccess | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const res = await fetch("/api/production/orders", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setOrders(json.data as ProductionOrderRecord[]);
      } else {
        setErrorBanner(json.message || "ดึงรายการไม่สำเร็จ");
      }
    } catch {
      setErrorBanner("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canReview) {
      loadOrders();
      const handler = () => loadOrders();
      window.addEventListener("stockify-production-created", handler);
      window.addEventListener("storage", handler);
      return () => {
        window.removeEventListener("stockify-production-created", handler);
        window.removeEventListener("storage", handler);
      };
    }
  }, [canReview, loadOrders]);

  // คิวงานของคนตรวจ = ใบผลิตที่ยังไม่เสร็จและไม่ถูกยกเลิก
  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === "PENDING" || o.status === "IN_PROGRESS"),
    [orders]
  );

  const parsedQty = (v: string): number => {
    const n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  };

  const openConfirm = (order: ProductionOrderRecord) => {
    setSelectedOrder(order);
    setSuccessResult(null);
    setErrorBanner(null);
    setNote("");
    setCloseOrder(false);
    setLeftoverWarehouseId("wh-02");
    setLeftoverLocation("");

    setFgForm(
      order.items.map((item) => ({
        fg_sku: item.fg_sku,
        fg_name: item.fg_name,
        fg_unit: item.fg_unit || "ชิ้น",
        ordered: item.quantity,
        remaining: Math.max(
          0,
          item.quantity - (Number(item.produced_qty) || 0) - (Number(item.defect_qty) || 0)
        ),
        good_qty: "",
        defect_qty: "",
        warehouse_id: item.target_warehouse_id || "wh-02",
        location: "",
      }))
    );

    setRmForm(
      (order.materials_summary || []).map((m) => ({
        rm_sku: m.rm_sku,
        rm_name: m.rm_name,
        rm_unit: m.rm_unit || "ชิ้น",
        remaining: Math.max(
          0,
          m.planned_qty - (Number(m.used_qty) || 0) - (Number(m.wasted_qty) || 0)
        ),
        used_qty: "",
        wasted_qty: "",
      }))
    );
  };

  const closeConfirm = () => {
    setSelectedOrder(null);
    setSuccessResult(null);
  };

  const totalGood = fgForm.reduce((s, i) => s + parsedQty(i.good_qty), 0);
  const totalDefect = fgForm.reduce((s, i) => s + parsedQty(i.defect_qty), 0);
  const totalUsed = rmForm.reduce((s, i) => s + parsedQty(i.used_qty), 0);
  const totalWasted = rmForm.reduce((s, i) => s + parsedQty(i.wasted_qty), 0);

  const formError = useMemo(() => {
    for (const item of fgForm) {
      const sum = parsedQty(item.good_qty) + parsedQty(item.defect_qty);
      if (sum > item.remaining) {
        return `"${item.fg_name}" เกินจำนวนที่เหลือ (เหลือ ${item.remaining} ${item.fg_unit})`;
      }
    }
    for (const m of rmForm) {
      const sum = parsedQty(m.used_qty) + parsedQty(m.wasted_qty);
      if (sum > m.remaining) {
        return `วัตถุดิบ "${m.rm_name}" เกินยอดคงเหลือตามแผน (เหลือ ${m.remaining} ${m.rm_unit})`;
      }
    }
    if (totalGood + totalDefect === 0) return "กรอกผลิตได้จริงหรือของเสียอย่างน้อย 1 ชิ้น";
    return null;
  }, [fgForm, rmForm, totalGood, totalDefect]);

  const submitConfirm = async () => {
    if (!selectedOrder || formError) return;
    setSubmitting(true);
    setErrorBanner(null);
    try {
      const materials = rmForm
        .map((m) => ({
          rm_sku: m.rm_sku,
          used_qty: parsedQty(m.used_qty),
          wasted_qty: parsedQty(m.wasted_qty),
        }))
        .filter((m) => m.used_qty + m.wasted_qty > 0);

      const res = await fetch(
        `/api/production/orders/${encodeURIComponent(selectedOrder.order_no)}/review`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            items: fgForm.map((i) => ({
              fg_sku: i.fg_sku,
              good_qty: parsedQty(i.good_qty),
              defect_qty: parsedQty(i.defect_qty),
              warehouse_id: i.warehouse_id,
              location: i.location,
            })),
            materials: materials.length > 0 ? materials : undefined,
            close_order: closeOrder,
            leftover: closeOrder ? { warehouse_id: leftoverWarehouseId, location: leftoverLocation } : undefined,
            note,
            confirmed_by_name: user?.name || "คนตรวจ",
          }),
        }
      );
      const json = await res.json();
      if (json.success) {
        setSuccessResult(json.data);
        loadOrders();
        window.dispatchEvent(new Event("storage"));
      } else {
        setErrorBanner(json.message || "ยืนยันผลผลิตไม่สำเร็จ");
      }
    } catch {
      setErrorBanner("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- ไม่มีสิทธิ์ ----
  if (!canReview) {
    return (
      <div className="w-full max-w-full pb-8">
        <h1 className="text-2xl font-extrabold text-slate-900">ยืนยันผลผลิต</h1>
        <div className="mt-6 rounded-2xl border border-[#E8ECEA] bg-white px-6 py-16 text-center shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-xl">
            🔒
          </div>
          <h2 className="mt-3.5 text-base font-extrabold text-slate-900">ไม่มีสิทธิ์เข้าใช้หน้านี้</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            เฉพาะคนตรวจที่ระบบกำหนด (เพิ่มชื่อได้ที่ production-reviewers.ts) เท่านั้น
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full pb-8">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">ยืนยันผลผลิต</h1>
        <p className="mt-1.5 text-sm font-medium text-slate-500">
          ใบผลิตที่แอดมินสร้างจะมาปรากฏที่นี่ — กรอกยอดผลิตได้จริง/ของเสีย และวัตถุดิบใช้จริง/เสียจริง แล้วกดยืนยัน
          ระบบจะตัดวัตถุดิบและเพิ่มสต็อกทันที
        </p>
      </div>

      {errorBanner && !selectedOrder && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-bold text-rose-800">{errorBanner}</p>
          <button
            onClick={() => setErrorBanner(null)}
            className="rounded-lg px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
          >
            ปิด
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-[#E8ECEA] bg-white p-16 text-center shadow-xs">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0F5C3F] border-t-transparent" />
          <p className="mt-3 text-sm font-semibold text-slate-500">กำลังดึงใบผลิตที่รอยืนยัน...</p>
        </div>
      ) : pendingOrders.length === 0 ? (
        <div className="rounded-2xl border border-[#E8ECEA] bg-white px-6 py-20 text-center shadow-xs">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#C9DFD4] bg-[#EAF2EE] text-2xl">
            ✅
          </div>
          <h2 className="mt-4 text-lg font-extrabold text-slate-900">ไม่มีใบผลิตที่รอยืนยัน</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm font-medium text-slate-500">
            เมื่อแอดมินสร้างใบผลิตใหม่ รายการจะมาปรากฏที่นี่เพื่อกรอกผลผลิตจริงและยืนยัน
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingOrders.map((order) => {
            const totalOrdered = order.items.reduce((s, i) => s + i.quantity, 0);
            const approvedProduced = order.items.reduce((s, i) => s + (Number(i.produced_qty) || 0), 0);
            const approvedDefect = order.items.reduce((s, i) => s + (Number(i.defect_qty) || 0), 0);
            const totalRemaining = Math.max(0, totalOrdered - approvedProduced - approvedDefect);

            return (
              <div key={order.order_no} className="rounded-2xl border border-[#E8ECEA] bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-black text-slate-900">{order.order_no}</span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                          order.status === "PENDING" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"
                        }`}
                      >
                        {STATUS_LABELS[order.status] || order.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-400">
                      {order.document_date || String(order.created_at || "").slice(0, 10)} · สั่งโดย{" "}
                      {order.created_by_name}
                      {order.inspections?.length ? ` · ยืนยันแล้ว ${order.inspections.length} รอบ` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openConfirm(order)}
                    disabled={totalRemaining <= 0}
                    title={totalRemaining <= 0 ? "ใบนี้ผลิตครบตามจำนวนที่สั่งแล้ว" : "กรอกผลผลิตจริงและยืนยัน"}
                    className="rounded-xl bg-[#06402B] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#06402B]/20 transition-all hover:bg-[#053425] active:scale-95 disabled:opacity-40"
                  >
                    กรอกผลและยืนยัน
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">สั่งผลิต</div>
                    <div className="mt-0.5 font-mono text-lg font-black text-slate-900">{totalOrdered.toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl bg-[#EAF2EE] px-3 py-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-[#4A7A66]">ผลิตได้จริง</div>
                    <div className="mt-0.5 font-mono text-lg font-black text-[#06402B]">{approvedProduced.toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl bg-rose-50 px-3 py-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-rose-400">ของเสีย</div>
                    <div className="mt-0.5 font-mono text-lg font-black text-rose-700">{approvedDefect.toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl bg-amber-50 px-3 py-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-amber-500">คงเหลือให้ยืนยัน</div>
                    <div className="mt-0.5 font-mono text-lg font-black text-amber-800">{totalRemaining.toLocaleString()}</div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {order.items.map((item) => {
                    const produced = Number(item.produced_qty) || 0;
                    const defect = Number(item.defect_qty) || 0;
                    const remaining = Math.max(0, item.quantity - produced - defect);
                    return (
                      <div
                        key={item.fg_sku}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EEF1EF] bg-[#F7FAF8] px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-900">{item.fg_name}</div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-slate-400">{item.fg_sku}</span>
                            {item.table_no && (
                              <span
                                className="rounded bg-[#06402B] px-1.5 py-0.5 text-[10px] font-bold text-white whitespace-nowrap"
                                title={`ผลิตที่โต๊ะ ${item.table_no}`}
                              >
                                โต๊ะ {item.table_no}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 font-mono text-sm font-bold">
                          <span className="text-slate-500">
                            สั่ง <span className="text-slate-900">{item.quantity.toLocaleString()}</span>
                          </span>
                          <span className="text-[#06402B]">
                            ได้ <span className="text-[#06402B]">{produced.toLocaleString()}</span>
                          </span>
                          <span className="text-rose-600">
                            เสีย <span className="text-rose-700">{defect.toLocaleString()}</span>
                          </span>
                          <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-amber-800">
                            เหลือ {remaining.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- Confirm Modal ---- */}
      {selectedOrder && (
        <ConfirmModal
          order={selectedOrder}
          fgForm={fgForm}
          setFgForm={setFgForm}
          rmForm={rmForm}
          setRmForm={setRmForm}
          closeOrder={closeOrder}
          setCloseOrder={setCloseOrder}
          leftoverWarehouseId={leftoverWarehouseId}
          setLeftoverWarehouseId={setLeftoverWarehouseId}
          leftoverLocation={leftoverLocation}
          setLeftoverLocation={setLeftoverLocation}
          note={note}
          setNote={setNote}
          formError={formError}
          totalGood={totalGood}
          totalDefect={totalDefect}
          totalUsed={totalUsed}
          totalWasted={totalWasted}
          submitting={submitting}
          errorBanner={errorBanner}
          successResult={successResult}
          onSubmit={submitConfirm}
          onClose={closeConfirm}
        />
      )}
    </div>
  );
}

// ---- Confirm Modal ----

interface ConfirmModalProps {
  order: ProductionOrderRecord;
  fgForm: FgForm[];
  setFgForm: (items: FgForm[]) => void;
  rmForm: RmForm[];
  setRmForm: (items: RmForm[]) => void;
  closeOrder: boolean;
  setCloseOrder: (v: boolean) => void;
  leftoverWarehouseId: string;
  setLeftoverWarehouseId: (v: string) => void;
  leftoverLocation: string;
  setLeftoverLocation: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  formError: string | null;
  totalGood: number;
  totalDefect: number;
  totalUsed: number;
  totalWasted: number;
  submitting: boolean;
  errorBanner: string | null;
  successResult: ConfirmSuccess | null;
  onSubmit: () => void;
  onClose: () => void;
}

function ConfirmModal(props: ConfirmModalProps) {
  const {
    order,
    fgForm,
    setFgForm,
    rmForm,
    setRmForm,
    closeOrder,
    setCloseOrder,
    leftoverWarehouseId,
    setLeftoverWarehouseId,
    leftoverLocation,
    setLeftoverLocation,
    note,
    setNote,
    formError,
    totalGood,
    totalDefect,
    totalUsed,
    totalWasted,
    submitting,
    errorBanner,
    successResult,
    onSubmit,
    onClose,
  } = props;

  useEscapeKey(!submitting && !successResult, onClose);

  const updateFg = (sku: string, patch: Partial<FgForm>) => {
    setFgForm(fgForm.map((i) => (i.fg_sku === sku ? { ...i, ...patch } : i)));
  };
  const updateRm = (sku: string, patch: Partial<RmForm>) => {
    setRmForm(rmForm.map((i) => (i.rm_sku === sku ? { ...i, ...patch } : i)));
  };

  if (successResult) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
        <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#E8ECEA] bg-white p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#DFEDE6] text-3xl text-[#053425]">
            ✅
          </div>
          <h3 className="mt-4 text-xl font-bold text-slate-900">ยืนยันและตัดสต็อกเรียบร้อย!</h3>
          <p className="mt-1 font-mono text-sm font-semibold text-slate-500">
            {successResult.order_no} · รอบที่ {successResult.round_no}
          </p>
          <div className="mt-4 space-y-1.5 rounded-xl border border-[#C9DFD4] bg-[#EAF2EE] p-4 text-left text-sm font-semibold text-[#031B14]">
            <div>• ของดี {successResult.total_good.toLocaleString()} ชิ้น — เพิ่มสต็อกตามตำแหน่งแล้ว</div>
            <div>• ของเสีย {successResult.total_defect.toLocaleString()} ชิ้น — บันทึกเข้าเมนูของเสียแล้ว</div>
            {successResult.materials_used?.length > 0 ? (
              <div>
                • ตัดวัตถุดิบ {successResult.materials_used.length} รายการ (ใช้จริง{" "}
                {successResult.materials_used.reduce((s, m) => s + m.used, 0).toLocaleString()}
                {successResult.materials_used.some((m) => m.wasted > 0)
                  ? ` · เสียจริง ${successResult.materials_used.reduce((s, m) => s + m.wasted, 0).toLocaleString()}`
                  : ""}
                ) จากโกดัง 2 แล้ว
              </div>
            ) : (
              <div>• ตัดวัตถุดิบจากโกดัง 2 ตามสูตร BOM แล้ว</div>
            )}
            {successResult.leftover_moved?.length > 0 && (
              <div>
                • ย้ายเศษวัตถุดิบ {successResult.leftover_moved.length} รายการไป {successResult.leftover_warehouse}
                {successResult.leftover_location ? ` (${successResult.leftover_location})` : ""}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-xl bg-[#06402B] py-3.5 text-sm font-bold text-white shadow-lg shadow-[#06402B]/20 transition-all hover:bg-[#053425] active:scale-95"
          >
            เสร็จสิ้น
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#E8ECEA] bg-white p-5 shadow-2xl sm:p-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">กรอกผลผลิตจริงและยืนยัน</h2>
          <p className="mt-1 font-mono text-sm font-semibold text-slate-500">{order.order_no}</p>
          <p className="mt-1 text-xs font-semibold text-slate-400">
            กดยืนยันแล้วระบบจะตัดวัตถุดิบจากโกดัง 2 และเพิ่มสต็อกของดีทันที
          </p>
        </div>

        {errorBanner && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5">
            <p className="text-sm font-bold text-rose-800">{errorBanner}</p>
          </div>
        )}

        {/* สินค้าสำเร็จรูป: ผลิตได้จริง / ของเสีย / ปลายทาง */}
        <div className="mt-5 space-y-3">
          <h3 className="text-sm font-extrabold text-slate-900">📦 สินค้าสำเร็จรูป</h3>
          {fgForm.map((item) => (
            <div key={item.fg_sku} className="rounded-2xl border border-[#EEF1EF] bg-[#F7FAF8] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-900">{item.fg_name}</div>
                  <div className="font-mono text-xs font-semibold text-slate-400">{item.fg_sku}</div>
                </div>
                <div className="font-mono text-xs font-bold text-slate-500">
                  สั่ง {item.ordered.toLocaleString()} ·{" "}
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                    เหลือให้ยืนยัน {item.remaining.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="block">
                  <span className="text-xs font-bold text-[#06402B]">ผลิตได้จริง (ของดี)</span>
                  <input
                    type="number"
                    min={0}
                    max={item.remaining}
                    inputMode="numeric"
                    value={item.good_qty}
                    onChange={(e) => updateFg(item.fg_sku, { good_qty: e.target.value })}
                    placeholder="0"
                    disabled={item.remaining <= 0}
                    className="mt-1 w-full rounded-xl border border-[#E1E8EE] bg-white px-3 py-2.5 font-mono text-base font-bold text-[#06402B] focus:border-[#0F5C3F] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:bg-slate-50 disabled:text-slate-300"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-rose-600">ของเสีย</span>
                  <input
                    type="number"
                    min={0}
                    max={item.remaining}
                    inputMode="numeric"
                    value={item.defect_qty}
                    onChange={(e) => updateFg(item.fg_sku, { defect_qty: e.target.value })}
                    placeholder="0"
                    disabled={item.remaining <= 0}
                    className="mt-1 w-full rounded-xl border border-[#E1E8EE] bg-white px-3 py-2.5 font-mono text-base font-bold text-rose-700 focus:border-rose-400 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:bg-slate-50 disabled:text-slate-300"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-slate-500">โกดังปลายทาง</span>
                  <select
                    value={item.warehouse_id}
                    onChange={(e) => updateFg(item.fg_sku, { warehouse_id: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-[#E1E8EE] bg-white px-2.5 py-2.5 text-sm font-bold text-slate-800 focus:border-[#0F5C3F] focus:outline-none"
                  >
                    {WAREHOUSES.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-slate-500">ตำแหน่ง</span>
                  <input
                    type="text"
                    value={item.location}
                    onChange={(e) => updateFg(item.fg_sku, { location: e.target.value })}
                    placeholder="เช่น 2A-05"
                    className="mt-1 w-full rounded-xl border border-[#E1E8EE] bg-white px-3 py-2.5 font-mono text-sm font-bold text-slate-800 focus:border-[#0F5C3F] focus:outline-none"
                  />
                </label>
              </div>
              <p className="mt-1.5 text-[11px] font-semibold text-slate-400">
                ของดี + ของเสีย ต้องไม่เกินจำนวนคงเหลือ {item.remaining.toLocaleString()} {item.fg_unit}
              </p>
            </div>
          ))}
        </div>

        {/* วัตถุดิบ: ใช้จริง / เสียจริง */}
        {rmForm.length > 0 && (
          <div className="mt-5 space-y-3">
            <h3 className="text-sm font-extrabold text-slate-900">🧪 วัตถุดิบที่ใช้จริง / เสียจริง</h3>
            <p className="text-xs font-semibold text-slate-500">
              ไม่กรอก = ระบบคำนวณยอดตัดจากสูตร BOM × ของดีที่ยืนยันให้อัตโนมัติ
            </p>
            <div className="overflow-hidden rounded-2xl border border-[#E8ECEA] bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[560px]">
                  <thead>
                    <tr className="bg-slate-100 font-bold text-slate-600">
                      <th className="px-3 py-2">วัตถุดิบ</th>
                      <th className="px-3 py-2 text-right">เหลือตามแผน</th>
                      <th className="px-3 py-2 text-right">ใช้จริง</th>
                      <th className="px-3 py-2 text-right">เสียจริง</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1EF]">
                    {rmForm.map((m) => (
                      <tr key={m.rm_sku}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-800">{m.rm_name}</div>
                          <div className="font-mono text-xs text-slate-400">{m.rm_sku}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-600 whitespace-nowrap">
                          {m.remaining.toLocaleString()} {m.rm_unit}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            max={m.remaining}
                            inputMode="numeric"
                            value={m.used_qty}
                            onChange={(e) => updateRm(m.rm_sku, { used_qty: e.target.value })}
                            placeholder="0"
                            className="w-24 rounded-lg border border-[#E1E8EE] bg-white px-2.5 py-1.5 text-right font-mono text-sm font-bold text-[#06402B] focus:border-[#0F5C3F] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            max={m.remaining}
                            inputMode="numeric"
                            value={m.wasted_qty}
                            onChange={(e) => updateRm(m.rm_sku, { wasted_qty: e.target.value })}
                            placeholder="0"
                            className="w-24 rounded-lg border border-[#E1E8EE] bg-white px-2.5 py-1.5 text-right font-mono text-sm font-bold text-rose-700 focus:border-rose-400 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ปิดใบ + เศษวัตถุดิบ */}
        <div className="mt-5 rounded-2xl border border-[#E8ECEA] bg-white p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={closeOrder}
              onChange={(e) => setCloseOrder(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#06402B]"
            />
            <span>
              <span className="text-sm font-bold text-slate-900">ปิดใบผลิตหลังยืนยันรอบนี้</span>
              <span className="mt-0.5 block text-xs font-semibold text-slate-500">
                ใช้เมื่อผลิตครบแล้ว หรือจะไม่ผลิตส่วนที่เหลือ — ระบบจะย้ายเศษวัตถุดิบคงเหลือตามที่ระบุด้านล่าง
              </span>
            </span>
          </label>

          {closeOrder && (
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[#EEF1EF] pt-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-bold text-slate-500">เก็บเศษวัตถุดิบไว้ที่โกดัง</span>
                <select
                  value={leftoverWarehouseId}
                  onChange={(e) => setLeftoverWarehouseId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#E1E8EE] bg-white px-3 py-2.5 text-sm font-bold text-slate-800 focus:border-[#0F5C3F] focus:outline-none"
                >
                  {WAREHOUSES.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-500">ตำแหน่ง (ชั้นวาง)</span>
                <input
                  type="text"
                  value={leftoverLocation}
                  onChange={(e) => setLeftoverLocation(e.target.value)}
                  placeholder="เช่น 1B-10"
                  className="mt-1 w-full rounded-xl border border-[#E1E8EE] bg-white px-3 py-2.5 font-mono text-sm font-bold text-slate-800 focus:border-[#0F5C3F] focus:outline-none"
                />
              </label>
            </div>
          )}
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-bold text-slate-500">หมายเหตุ (ถ้ามี)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น วัตถุดิบ RM-001 แตกหักระหว่างผลิต 2 ชิ้น"
            className="mt-1 w-full rounded-xl border border-[#E1E8EE] bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 focus:border-[#0F5C3F] focus:outline-none"
          />
        </label>

        {formError && (
          <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3.5">
            <p className="text-sm font-bold text-rose-800">⚠️ {formError}</p>
          </div>
        )}

        <div className="mt-5 rounded-xl bg-[#EAF2EE] border border-[#C9DFD4] p-3.5 text-sm font-bold text-[#052B1F]">
          กดยืนยันแล้วระบบจะตัดวัตถุดิบจากโกดัง 2 และเพิ่มสต็อกของดี {totalGood.toLocaleString()} ชิ้นทันที
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            disabled={!!formError || submitting}
            onClick={onSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#06402B] py-4 text-base font-bold text-white shadow-lg shadow-[#06402B]/20 transition-all hover:bg-[#053425] active:scale-[0.98] disabled:opacity-50"
          >
            {submitting ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <span>
                ยืนยันและตัดสต็อกทันที (ของดี {totalGood.toLocaleString()} · เสีย {totalDefect.toLocaleString()}
                {rmForm.length > 0 ? ` · วัตถุดิบ ${totalUsed.toLocaleString()}` : ""})
              </span>
            )}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="w-full rounded-xl border border-[#E8ECEA] bg-slate-100 py-3.5 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}
