"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import ConfirmProductionModal from "../_components/ConfirmProductionModal";
import SuccessModal from "../_components/SuccessModal";
import type { CartItem, ConsumedMaterial, EnrichedBomItem } from "../_components/types";
import { useProductionCart, updateCartQty, removeFromCart, clearCart } from "../_lib/cart-store";

function QuantityIcon({ type }: { type: "minus" | "plus" }) {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      {type === "plus" && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 5v14M5 12h14" />}
      {type === "minus" && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14" />}
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
        expanded ? "rotate-180 text-[#06402B]" : ""
      }`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 8l-9-5-9 5m18 0l-9 5m9-5v8l-9 5m0-8L3 8m9 5v8M3 8v8l9 5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}

function EmptyCartIcon() {
  return (
    <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.5 3m0 0L7 15h10l2-9H5.5zM8 21a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

/** ตัวเลขจำนวน − ช่องพิมพ์์ + MAX (ใช้ร่วมทั้ง layout ตารางและการ์ดมือถือ) */
function QtyStepper({ item }: { item: CartItem }) {
  const sku = item.bom.fg_sku;
  const maxProducible = item.bom.maxProducible || 1;
  // ช่องที่ผู้ใช้กำลังพิมพ์ (อาจว่างชั่วคราว) — กันการลบรายการเพียงเพราะล้างช่อง input
  const [editingValue, setEditingValue] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1.5">
      <div className="inline-flex h-9 items-stretch overflow-hidden rounded-xl border border-[#E1E8EE] bg-white shadow-[0_1px_2px_rgba(228,233,240,0.6)]">
        <button
          type="button"
          onClick={() => updateCartQty(sku, item.quantity - 1)}
          className="flex w-9 items-center justify-center border-r border-[#E1E8EE] text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-900 active:scale-95"
          aria-label="ลดจำนวน"
          title={item.quantity <= 1 ? "ลบรายการนี้" : "ลดจำนวน"}
        >
          <QuantityIcon type="minus" />
        </button>
        <input
          type="number"
          min={1}
          max={maxProducible}
          value={editingValue !== null ? editingValue : item.quantity}
          onContextMenu={(e) => e.preventDefault()}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              // ค้างค่าว่างไว้ก่อน ยังไม่ลบรายการ — onBlur จะกลับเป็น 1 เอง
              setEditingValue("");
              return;
            }
            setEditingValue(null);
            const val = parseInt(raw);
            if (!isNaN(val)) updateCartQty(sku, val);
          }}
          onBlur={() => {
            if (editingValue === null) return;
            const parsed = parseInt(editingValue);
            if (editingValue === "" || isNaN(parsed) || parsed < 1) {
              updateCartQty(sku, 1);
            }
            setEditingValue(null);
          }}
          className="w-16 border-0 bg-transparent px-1 text-center font-mono text-sm font-bold text-slate-900 [appearance:textfield] focus:outline-hidden [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          aria-label="จำนวนที่ต้องการผลิต"
        />
        <button
          type="button"
          onClick={() => updateCartQty(sku, item.quantity + 1)}
          className="flex w-9 items-center justify-center border-l border-[#E1E8EE] text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-900 active:scale-95"
          aria-label="เพิ่มจำนวน"
        >
          <QuantityIcon type="plus" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => updateCartQty(sku, maxProducible)}
        disabled={item.quantity >= maxProducible}
        className="flex h-9 items-center justify-center rounded-lg border border-[#8FB3A3] bg-[#EAF2EE] px-2 text-[11px] font-bold text-[#052B1F] transition-all hover:bg-[#DFEDE6] active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        aria-label="ใส่จำนวนสูงสุด"
        title="ใส่จำนวนสูงสุดที่ผลิตได้"
      >
        MAX
      </button>
      <span className="text-sm font-bold text-slate-500">{item.bom.fg_unit}</span>
    </div>
  );
}

/** แผ่นวัตถุดิบที่ใช้ผลิตของรายการหนึ่ง ๆ (ใช้ร่วมทั้งแถวตารางและการ์ดมือถือ) */
function ExpandedMaterials({
  item,
  itemsCache,
  loadingSku,
}: {
  item: CartItem;
  itemsCache: Record<string, EnrichedBomItem[]>;
  loadingSku: string | null;
}) {
  const sku = item.bom.fg_sku;
  const rowItems = itemsCache[sku] ?? item.bom.items ?? [];

  if (loadingSku === sku && rowItems.length === 0) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[#0F5C3F] border-t-transparent" />
        <p className="mt-2 text-xs font-semibold text-slate-500">กำลังดึงวัตถุดิบ...</p>
      </div>
    );
  }

  if (rowItems.length === 0) {
    return (
      <div className="py-6 text-center text-sm font-semibold text-slate-500">
        ไม่พบข้อมูลวัตถุดิบ — กดพับแล้วกางใหม่เพื่อลองอีกครั้ง
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-extrabold text-slate-900">
          วัตถุดิบที่ใช้ผลิต ({rowItems.length} รายการ)
        </h4>
        <span className="text-xs font-semibold text-slate-500">
          คิดตามจำนวน {item.quantity.toLocaleString()} {item.bom.fg_unit} ที่ตั้งไว้
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#E8ECEA] bg-white">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-[#E8ECEA] bg-slate-100 font-bold text-slate-600">
              <th className="px-3 py-2.5 text-center">ประเภท</th>
              <th className="px-3 py-2.5">รหัสวัตถุดิบ</th>
              <th className="px-3 py-2.5">ชื่อวัตถุดิบ</th>
              <th className="px-3 py-2.5 text-right">ใช้ต่อ 1 ชุด</th>
              <th className="px-3 py-2.5 text-right">ต้องใช้ทั้งหมด</th>
              <th className="px-3 py-2.5 text-right">มีในโกดัง 2</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1EF]">
            {rowItems.map((rm, idx) => {
              const isPrimary = Number(rm.is_primary) === 1;
              const available = rm.available_wh2_qty || 0;
              const perUnit = rm.rm_qty_required || 1;
              const wasteFactor = 1 + (rm.waste_percentage || 0) / 100;
              const totalNeeded = Math.ceil(item.quantity * perUnit * wasteFactor);
              const hasEnough = available >= totalNeeded;

              return (
                <tr key={rm.rm_sku || idx} className="hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-3 py-2.5 text-center">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                        isPrimary
                          ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                          : "border-slate-200 bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isPrimary ? "หลัก" : "รอง"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono font-bold text-slate-800">
                    {rm.rm_sku || "-"}
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-slate-800">
                    <span className="block truncate" title={rm.rm_name}>
                      {rm.rm_name}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold text-slate-700">
                    {perUnit.toLocaleString()} {rm.rm_unit}
                    {(rm.waste_percentage || 0) > 0 && (
                      <span
                        className="ml-1 text-[10px] font-bold text-amber-700"
                        title={`บวกเศษที่เสียไป ${rm.waste_percentage}%`}
                      >
                        +เศษ {rm.waste_percentage}%
                      </span>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold ${
                      hasEnough ? "text-slate-900" : isPrimary ? "text-rose-600" : "text-amber-600"
                    }`}
                  >
                    {totalNeeded.toLocaleString()} {rm.rm_unit}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold ${
                      hasEnough ? "text-slate-700" : isPrimary ? "text-rose-600" : "text-amber-600"
                    }`}
                    title={hasEnough ? "ของเพียงพอ" : `ของไม่พอ (ขาด ${(totalNeeded - available).toLocaleString()} ${rm.rm_unit})`}
                  >
                    {available.toLocaleString()} {rm.rm_unit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ProductionCartPage() {
  const router = useRouter();
  const { user } = useTabAuth();
  const cart = useProductionCart();

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [successOrderNo, setSuccessOrderNo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  // แถวที่กางดูวัตถุดิบอยู่ (กางได้หลายแถวพร้อมกัน)
  const [expandedSkus, setExpandedSkus] = useState<Set<string>>(new Set());
  // วัตถุดิบแต่ละสูตร — ปกติมาพร้อมตะกร้าแล้ว ใช้ cache เฉพาะกรณีข้อมูลเก่าไม่มี items
  const [itemsCache, setItemsCache] = useState<Record<string, EnrichedBomItem[]>>({});
  const [loadingItemsSku, setLoadingItemsSku] = useState<string | null>(null);

  const totalCartUnits = cart.reduce((sum, item) => sum + item.quantity, 0);

  // สรุปวัตถุดิบที่จะถูกตัด (รวม % เศษเสียเหมือนตอนสั่งผลิตจริง) — ใช้ใน modal ยืนยันและแถบล่าง
  const consumedMaterials: ConsumedMaterial[] = useMemo(() => {
    const map = new Map<string, ConsumedMaterial>();
    for (const item of cart) {
      if (!item.bom.items) continue;
      for (const rm of item.bom.items) {
        const key = rm.rm_sku || rm.rm_name;
        const wasteFactor = 1 + (rm.waste_percentage || 0) / 100;
        const needed = item.quantity * rm.rm_qty_required * wasteFactor;
        const isPrimary = Number(rm.is_primary) === 1 ? 1 : 0;
        const existing = map.get(key);
        if (existing) {
          existing.total_required += needed;
          if (isPrimary === 1) existing.is_primary = 1;
        } else {
          map.set(key, {
            rm_sku: rm.rm_sku,
            rm_name: rm.rm_name,
            rm_unit: rm.rm_unit || "ชิ้น",
            total_required: needed,
            available_qty: rm.available_wh2_qty,
            is_primary: isPrimary,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => (b.is_primary ?? 0) - (a.is_primary ?? 0));
  }, [cart]);

  const shortageCount = consumedMaterials.filter((c) => (c.available_qty ?? 0) < Math.ceil(c.total_required)).length;

  const toggleExpand = async (item: CartItem) => {
    const sku = item.bom.fg_sku;
    const willOpen = !expandedSkus.has(sku);
    setExpandedSkus((prev) => {
      const next = new Set(prev);
      if (willOpen) next.add(sku);
      else next.delete(sku);
      return next;
    });

    // กางครั้งแรกและตะกร้าไม่มีรายการวัตถุดิบ (ข้อมูลเก่า) — ดึงสูตรจาก API แบบ lazy
    if (willOpen && !itemsCache[sku] && !(item.bom.items?.length ?? 0)) {
      setLoadingItemsSku(sku);
      try {
        const res = await fetch(`/api/production/bom?sku=${encodeURIComponent(sku)}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data?.items)) {
          setItemsCache((prev) => ({ ...prev, [sku]: json.data.items }));
        }
      } catch {
        // แสดงเป็นรายการว่าง — ผู้ใช้พับแล้วกางใหม่ได้
      } finally {
        setLoadingItemsSku(null);
      }
    }
  };

  const handleConfirmProduction = async () => {
    if (cart.length === 0) return;
    setIsSubmitting(true);
    setErrorBanner(null);

    try {
      const storedToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("stockify_tab_token") || localStorage.getItem("stockify_tab_token")
          : null;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      const res = await fetch("/api/production/orders", {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: cart,
          created_by_name: user?.name || "ผู้ดูแลระบบ (Admin)",
        }),
      });

      const json = await res.json();
      if (json.success && json.data) {
        clearCart();
        setShowConfirmModal(false);
        setSuccessOrderNo(json.data.order_no);

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("stockify-production-created", { detail: json.data }));
        }
      } else {
        setErrorBanner(json.message || "เกิดข้อผิดพลาดในการบันทึกคำสั่งผลิต");
      }
    } catch {
      setErrorBanner("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-full pb-8">
      {/* Header แบบมินิมอล — ปุ่มย้อนกลับซ้าย สถิติย่อขวาบน */}
      <div className="mb-6 flex flex-wrap items-center gap-y-4">
        <button
          type="button"
          onClick={() => router.push("/production")}
          className="group inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-[#06402B]"
        >
          <span className="transition-transform group-hover:-translate-x-0.5">
            <BackIcon />
          </span>
          กลับไปเลือกสินค้า
        </button>

        <dl className="ml-auto flex items-center gap-4 sm:gap-8">
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">รายการ</dt>
            <dd className="mt-1 font-mono text-xl font-black leading-none text-slate-900">
              {cart.length.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">ยอดผลิต</dt>
            <dd className="mt-1 font-mono text-xl font-black leading-none text-[#06402B]">
              +{totalCartUnits.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">ปลายทาง</dt>
            <dd className="mt-1.5 inline-flex rounded-full bg-[#EAF2EE] px-2.5 py-1 text-xs font-extrabold text-[#06402B]">
              โกดัง 2
            </dd>
          </div>
        </dl>
      </div>

      {errorBanner && (
        <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 text-rose-800">
              <AlertIcon />
              <p className="text-sm font-bold">{errorBanner}</p>
            </div>
            <button
              onClick={() => setErrorBanner(null)}
              className="rounded-lg px-2.5 py-1 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100 hover:text-rose-900"
            >
              ปิด
            </button>
          </div>
        </div>
      )}

      {cart.length === 0 ? (
        <div className="rounded-2xl border border-[#E8ECEA] bg-white px-6 py-20 text-center shadow-xs">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-[#C9DFD4] bg-[#EAF2EE] text-[#06402B]">
            <EmptyCartIcon />
          </div>
          <h2 className="mt-5 text-lg font-extrabold text-slate-900">ยังไม่มีสินค้าในตะกร้า</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-sm font-medium text-slate-500">
            ไปหน้าผลิตสินค้าเพื่อเลือกสินค้าที่ต้องการผลิต แล้วกด &quot;เพิ่มในตะกร้า&quot;
          </p>
          <Link
            href="/production"
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-[#06402B] px-8 py-4 text-sm font-bold text-white shadow-lg shadow-[#06402B]/20 transition-all hover:bg-[#053425] active:scale-95"
          >
            <BoxIcon />
            ไปเลือกสินค้าผลิต
          </Link>
        </div>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-[#E8ECEA] bg-white shadow-xs">
            <div className="flex flex-col gap-3 border-b border-[#EEF1EF] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#0F5C3F]" />
                <h2 className="text-base font-extrabold text-slate-900">สินค้าในตะกร้าสั่งผลิต</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                  {cart.length.toLocaleString()} รายการ
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-400">กดที่รายการเพื่อดูวัตถุดิบที่ใช้ผลิต</p>
            </div>

            {/* จอใหญ่: ตารางตามรูปอ้างอิง */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#EEF1EF] bg-slate-50/70 font-bold text-slate-500">
                    <th className="w-10 px-3 py-3 text-center" aria-label="ขยายดูวัตถุดิบ"></th>
                    <th className="px-4 py-3">รหัส</th>
                    <th className="px-4 py-3">รูป</th>
                    <th className="px-4 py-3">ชื่อ</th>
                    <th className="px-4 py-3 text-center">จำนวน</th>
                    <th className="px-4 py-3 text-center">ลบ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1EF]">
                  {cart.map((item) => {
                    const sku = item.bom.fg_sku;
                    const isExpanded = expandedSkus.has(sku);

                    return (
                      <Fragment key={sku}>
                        <tr
                          onClick={() => toggleExpand(item)}
                          title={isExpanded ? "ซ่อนวัตถุดิบ" : "ดูวัตถุดิบที่ใช้ผลิต"}
                          className={`group cursor-pointer transition-colors ${
                            isExpanded ? "bg-[#EAF2EE]/50" : "hover:bg-slate-50/70"
                          }`}
                        >
                          {/* Expand Chevron */}
                          <td className="px-3 py-3.5 text-center">
                            <span className="group-hover:text-slate-600">
                              <ChevronIcon expanded={isExpanded} />
                            </span>
                          </td>

                          {/* รหัส */}
                          <td className="whitespace-nowrap px-4 py-3.5">
                            <span className="font-mono font-bold text-slate-900">{sku}</span>
                            <div className="mt-1 text-xs font-semibold text-slate-400">ปลายทาง: โกดัง 2</div>
                          </td>

                          {/* รูป */}
                          <td className="px-4 py-3.5">
                            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-[#EEF1EF] bg-[#EFF3F1] p-1">
                              <img
                                src={item.bom.image || "/products/A002.jpg"}
                                alt={item.bom.fg_name}
                                className="max-h-full max-w-full object-contain"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.visibility = "hidden";
                                }}
                              />
                            </div>
                          </td>

                          {/* ชื่อ + ผลิตได้สูงสุด */}
                          <td className="max-w-[320px] px-4 py-3.5">
                            <div className="truncate font-bold text-slate-900" title={item.bom.fg_name}>
                              {item.bom.fg_name}
                            </div>
                            <div className="mt-0.5 text-xs font-bold text-[#06402B]">
                              ผลิตได้สูงสุด{" "}
                              <span className="font-mono font-extrabold">
                                {(item.bom.maxProducible || 0).toLocaleString()}
                              </span>{" "}
                              {item.bom.fg_unit}
                            </div>
                          </td>

                          {/* จำนวน (กดปุ่มต้องไม่กางแถว) */}
                          <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-center">
                              <QtyStepper item={item} />
                            </div>
                          </td>

                          {/* ลบ */}
                          <td className="px-4 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => removeFromCart(sku)}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                              title="ลบรายการนี้"
                            >
                              <TrashIcon />
                              ลบ
                            </button>
                          </td>
                        </tr>

                        {/* แถวขยาย — วัตถุดิบที่ใช้ผลิตของสินค้านี้ */}
                        {isExpanded && (
                          <tr className="bg-[#F7FAF8]">
                            <td colSpan={6} className="border-l-4 border-[#0F5C3F]/60 px-4 py-4 sm:px-6">
                              <ExpandedMaterials item={item} itemsCache={itemsCache} loadingSku={loadingItemsSku} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* มือถือ: การ์ดรายการซ้อนกัน (ตารางแคบเกินไปสำหรับจอเล็ก) */}
            <div className="divide-y divide-[#EEF1EF] md:hidden">
              {cart.map((item) => {
                const sku = item.bom.fg_sku;
                const isExpanded = expandedSkus.has(sku);

                return (
                  <div key={sku} className={isExpanded ? "bg-[#EAF2EE]/50" : ""}>
                    {/* ส่วนหัวการ์ด — กดเพื่อกาง/พับวัตถุดิบ */}
                    <button
                      type="button"
                      onClick={() => toggleExpand(item)}
                      className="flex w-full items-start gap-3 p-4 text-left"
                      aria-expanded={isExpanded}
                    >
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#EEF1EF] bg-[#EFF3F1] p-1">
                        <img
                          src={item.bom.image || "/products/A002.jpg"}
                          alt={item.bom.fg_name}
                          className="max-h-full max-w-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLElement).style.visibility = "hidden";
                          }}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <span className="rounded bg-[#DFEDE6] px-2 py-0.5 font-mono text-xs font-bold text-[#04231A]">
                          {sku}
                        </span>
                        <div className="mt-1.5 text-sm font-extrabold leading-5 text-slate-900">{item.bom.fg_name}</div>
                        <div className="mt-1 text-xs font-bold text-[#06402B]">
                          ผลิตได้สูงสุด{" "}
                          <span className="font-mono font-extrabold">
                            {(item.bom.maxProducible || 0).toLocaleString()}
                          </span>{" "}
                          {item.bom.fg_unit}
                        </div>
                      </div>

                      <span className="mt-1 shrink-0 p-1">
                        <ChevronIcon expanded={isExpanded} />
                      </span>
                    </button>

                    {/* จำนวน + ลบ */}
                    <div className="flex items-center justify-between gap-3 border-t border-[#EEF1EF] px-4 py-3">
                      <QtyStepper item={item} />
                      <button
                        type="button"
                        onClick={() => removeFromCart(sku)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                        title="ลบรายการนี้"
                      >
                        <TrashIcon />
                        ลบ
                      </button>
                    </div>

                    {/* วัตถุดิบที่ใช้ผลิต */}
                    {isExpanded && (
                      <div className="border-t border-[#EEF1EF] bg-[#F7FAF8] px-4 py-3">
                        <ExpandedMaterials item={item} itemsCache={itemsCache} loadingSku={loadingItemsSku} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="sticky bottom-4 z-30 mt-5">
            <div className="rounded-2xl border border-[#DDE8E2] bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur sm:px-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:gap-8">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-400">ยอดผลิตรวม</div>
                    <div className="mt-1 font-mono text-2xl font-black leading-none text-[#052B1F]">+{totalCartUnits.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-400">วัตถุดิบตัดออก</div>
                    <div className="mt-1 font-mono text-2xl font-black leading-none text-amber-800">{consumedMaterials.length.toLocaleString()}</div>
                  </div>
                  {shortageCount > 0 && (
                    <div className="col-span-2 inline-flex items-center gap-1.5 self-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-800 sm:col-span-1">
                      <AlertIcon />
                      วัตถุดิบไม่พอ {shortageCount} รายการ
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#06402B] px-8 py-4 text-base font-bold text-white shadow-lg shadow-[#06402B]/20 transition-all hover:bg-[#053425] active:scale-[0.98] md:w-auto"
                >
                  ตรวจสอบและยืนยันการสั่งผลิต
                  <ArrowRightIcon />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {showConfirmModal && cart.length > 0 && (
        <ConfirmProductionModal
          cart={cart}
          consumedMaterials={consumedMaterials}
          totalCartUnits={totalCartUnits}
          isSubmitting={isSubmitting}
          onConfirm={handleConfirmProduction}
          onCancel={() => setShowConfirmModal(false)}
        />
      )}

      {successOrderNo && (
        <SuccessModal orderNo={successOrderNo} onClose={() => setSuccessOrderNo(null)} />
      )}
    </div>
  );
}
