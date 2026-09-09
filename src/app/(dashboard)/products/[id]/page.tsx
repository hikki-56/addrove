"use client";

import { useEffect, useState, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UpdateProductSchema, type UpdateProductInput } from "@/types/api";
import type { Product, MovementWithDetails } from "@/types/models";
import { STOCK_STATUS_META, getStockStatus, type StockStatus } from "@/lib/stock-status";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import { useEscapeKey } from "@/hooks/use-escape-key";

const movTypeLabel: Record<string, string> = {
  RECEIVE: "รับเข้า", ISSUE: "เบิกออก", MOVE_OUT: "ย้ายออก", MOVE_IN: "ย้ายเข้า",
  TRANSFER_OUT: "โอนออก", TRANSFER_IN: "โอนเข้า", ADJUST: "ปรับยอด",
  OPENING: "เปิดยอด", REVERSAL: "กลับยอด",
};

const normalizeKey = (v: string) => v.trim().toLowerCase().replace(/^prod-/, "");

// Next.js อาจส่ง path param มาในรูป encode (เช่น SKU ภาษาไทย) — decode ก่อนใช้เสมอ
const safeDecodeId = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

// สินค้าบางรายการมีเฉพาะในชีตโกดัง (ไม่มีแถวใน master sheet) findById จึงหาไม่เจอ —
// resolve ผ่าน list API ที่รวมทั้งสองแหล่งและคัดตามสิทธิ์เข้าถึงโกดังแล้ว
async function resolveProduct(id: string): Promise<Product | null> {
  const tryFetch = async (term: string): Promise<Product | null> => {
    const params = new URLSearchParams({ search: term, limit: "1000", _t: String(Date.now()) });
    const res = await fetch(`/api/products?${params}`).then((r) => r.json()).catch(() => null);
    if (!res?.success) return null;
    const items: Product[] = Array.isArray(res.data) ? res.data : res.data?.items || [];
    const cleanId = id.trim().toLowerCase();
    return (
      items.find(
        (p) =>
          normalizeKey(p.sku) === normalizeKey(id) ||
          normalizeKey(p.product_id) === normalizeKey(id) ||
          (p.barcode && p.barcode.trim().toLowerCase() === cleanId)
      ) ?? null
    );
  };

  const stripped = normalizeKey(id);
  return (await tryFetch(stripped)) ?? (await tryFetch(id));
}

// locations_breakdown (แบนรายตำแหน่ง) → จัดกลุ่มเป็นการ์ดรายโกดังสำหรับหน้ารายละเอียด
function groupBreakdownByWarehouse(p: Product) {
  const map = new Map<
    string,
    { warehouse_id: string; warehouse_name: string; quantity: number; by_location: { location_code: string; quantity: number }[] }
  >();
  (p.locations_breakdown ?? []).forEach((entry) => {
    const key = entry.warehouse_id || entry.warehouse_name;
    const group =
      map.get(key) ??
      { warehouse_id: entry.warehouse_id, warehouse_name: entry.warehouse_name, quantity: 0, by_location: [] };
    group.quantity += Number(entry.quantity) || 0;
    if (entry.location && entry.location !== "-") {
      group.by_location.push({ location_code: entry.location, quantity: Number(entry.quantity) || 0 });
    }
    map.set(key, group);
  });
  return Array.from(map.values());
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [product, setProduct] = useState<Product | null>(null);
  const [movements, setMovements] = useState<MovementWithDetails[]>([]);
  const [movementsNote, setMovementsNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [whOpen, setWhOpen] = useState(false);

  // Edit modal state
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProductInput>({
    resolver: zodResolver(UpdateProductSchema),
  });

  useEscapeKey(editing, () => setEditing(false));

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const decodedId = safeDecodeId(id);
    resolveProduct(decodedId).then((found) => {
      if (!alive) return;
      if (found) {
        setProduct(found);
        reset({
          sku: found.sku,
          barcode: found.barcode ?? "",
          product_name: found.product_name,
          category: found.category,
          base_unit: found.base_unit,
          minimum_stock: Number(found.minimum_stock) || 0,
          description: found.description ?? "",
        });
      } else {
        setError("ไม่พบสินค้า");
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id, reset]);

  // ประวัติการเคลื่อนไหวของสินค้า (ค้นจาก product_id ในแถว movement โดยตรง)
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const params = new URLSearchParams({ product_id: safeDecodeId(id), limit: "20" });
    fetch(`/api/movements?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.success) {
          setMovements(d.data?.data ?? d.data ?? []);
        } else {
          setMovementsNote(d.message || "ไม่สามารถโหลดประวัติได้");
        }
      })
      .catch(() => alive && setMovementsNote("ไม่สามารถโหลดประวัติได้"));
    return () => {
      alive = false;
    };
  }, [id]);

  // สกรอลล์ไปหัวข้อประวัติเมื่อเปิดจากลิงก์ #history
  useEffect(() => {
    if (loading || movements.length === 0) return;
    if (typeof window !== "undefined" && window.location.hash === "#history") {
      document.getElementById("history")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loading, movements.length]);

  const totalQty = Number(product?.total_quantity ?? product?.quantity ?? 0);
  const minimumStock = Number(product?.minimum_stock ?? 0);
  const status: StockStatus = product?.stock_status ?? getStockStatus(totalQty, minimumStock);
  const statusMeta = STOCK_STATUS_META[status];
  const byWarehouse = useMemo(() => (product ? groupBreakdownByWarehouse(product) : []), [product]);

  const openEdit = () => {
    setFormError("");
    setEditing(true);
  };

  const onSubmit = async (data: UpdateProductInput) => {
    setFormError("");
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        minimum_stock: data.minimum_stock !== undefined ? Number(data.minimum_stock) : undefined,
      }),
    });
    const json = await res.json();
    if (json.success) {
      setEditing(false);
      setProduct((prev) => (prev ? { ...prev, ...data } : prev));
      window.dispatchEvent(new Event("stockify-product-updated"));
    } else {
      setFormError(json.message || "บันทึกไม่สำเร็จ");
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-3xl p-12 text-center border border-[#E8ECEA] shadow-sm space-y-3">
          <div className="w-8 h-8 border-3 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-semibold">กำลังโหลดข้อมูลสินค้า...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-3xl p-12 text-center border border-[#E8ECEA] shadow-sm space-y-3">
          <p className="text-sm text-slate-500 font-semibold">{error || "ไม่พบสินค้า"}</p>
          <button
            type="button"
            onClick={() => router.push("/products")}
            className="px-4 py-2.5 rounded-2xl bg-[#06402B] hover:bg-[#053425] text-white text-xs sm:text-sm font-extrabold shadow-md shadow-[#06402B]/20 transition-all cursor-pointer"
          >
            กลับไปสินค้าทั้งหมด
          </button>
        </div>
      </div>
    );
  }

  const barcodeValue = product.barcode && product.barcode.trim() !== "-" ? product.barcode : "";

  return (
    <div className="max-w-5xl mx-auto space-y-6 w-full">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => router.push("/products")}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-xs sm:text-sm font-semibold mb-3 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          กลับไปสินค้าทั้งหมด
        </button>

        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#EAF2EE] text-[#06402B] border border-[#DFEDE6] flex items-center justify-center shrink-0">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">{product.product_name}</h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${statusMeta.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
            </div>
            <p className="text-slate-500 text-xs sm:text-sm mt-1 font-medium">
              SKU: <span className="font-mono font-bold text-[#053425]">{product.sku}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              หมวด: {product.category || "-"}
              <span className="mx-1.5 text-slate-300">·</span>
              หน่วย: {product.base_unit || "ชิ้น"}
            </p>
          </div>
          <div className="flex gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => router.push("/movements/transfer")}
              className="px-4 py-2.5 rounded-2xl bg-white hover:bg-slate-50 border border-[#E8ECEA]/90 text-slate-700 text-xs sm:text-sm font-bold flex items-center gap-2 shadow-2xs transition-all cursor-pointer active:scale-98"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              เบิกสินค้า
            </button>
            <button
              type="button"
              onClick={openEdit}
              className="px-4 py-2.5 rounded-2xl bg-[#06402B] hover:bg-[#053425] text-white text-xs sm:text-sm font-extrabold flex items-center gap-2 shadow-md shadow-[#06402B]/20 transition-all cursor-pointer active:scale-98"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              แก้ไขข้อมูล
            </button>
          </div>
        </div>
      </div>

      {/* Stat tiles: บาร์โค้ด / คงเหลือรวม / ขั้นต่ำ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 border border-[#E8ECEA]/80 shadow-2xs">
          <div className="text-xs text-slate-500 font-semibold mb-2">บาร์โค้ด</div>
          {barcodeValue ? (
            <BarcodeSvg value={barcodeValue} height={36} width={1.2} className="max-w-full" />
          ) : (
            <div className="text-sm text-slate-400 font-medium py-3">ไม่มีบาร์โค้ด</div>
          )}
        </div>
        <div className="bg-white rounded-2xl p-4 border border-[#E8ECEA]/80 shadow-2xs flex flex-col justify-between">
          <div className="text-xs text-slate-500 font-semibold">คงเหลือรวมทุกโกดัง</div>
          <div className={`text-2xl sm:text-3xl font-black leading-tight mt-1 ${totalQty < 0 ? "text-rose-600" : totalQty === 0 ? "text-slate-400" : "text-[#06402B]"}`}>
            {totalQty.toLocaleString()}
            <span className="text-xs font-bold text-slate-400 ml-1.5">{product.base_unit || "ชิ้น"}</span>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-[#E8ECEA]/80 shadow-2xs flex flex-col justify-between">
          <div className="text-xs text-slate-500 font-semibold">จำนวนขั้นต่ำ (แจ้งเตือน)</div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 leading-tight mt-1">
            {minimumStock.toLocaleString()}
            <span className="text-xs font-bold text-slate-400 ml-1.5">{product.base_unit || "ชิ้น"}</span>
          </div>
        </div>
      </div>

      {/* โกดังที่มีสินค้า (กดเพื่อขยายดูเฉพาะชื่อโกดัง) */}
      <div className="bg-white rounded-2xl border border-[#E8ECEA]/90 shadow-sm">
        <button
          type="button"
          onClick={() => setWhOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-left cursor-pointer hover:bg-slate-50/60 transition-colors rounded-2xl"
        >
          <span className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
            <svg className="w-4 h-4 text-[#0F5C3F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            โกดังที่มีสินค้า
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-400 font-semibold">
            {byWarehouse.length} โกดัง
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${whOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </button>

        {whOpen && (
          <div className="px-4 sm:px-5 pb-4">
            {byWarehouse.length === 0 ? (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-xs text-slate-500 font-medium">
                ยังไม่มีสินค้าจัดเก็บในโกดังใด ๆ
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {byWarehouse.map((wh) => (
                  <span
                    key={wh.warehouse_id}
                    className="px-3 py-1.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-xs font-bold text-slate-700"
                  >
                    {wh.warehouse_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ประวัติสินค้า */}
      <div id="history" className="bg-white rounded-3xl border border-[#E8ECEA]/90 shadow-sm overflow-hidden scroll-mt-24">
        <div className="p-5 sm:p-6 pb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            ประวัติสินค้า (ล่าสุด 20 รายการ)
          </h2>
        </div>

        {movementsNote ? (
          <div className="mx-5 sm:mx-6 mb-5 p-4 rounded-2xl bg-slate-50 border border-[#E8ECEA] text-xs text-slate-500 font-medium">
            {movementsNote}
          </div>
        ) : movements.length === 0 ? (
          <div className="mx-5 sm:mx-6 mb-5 p-4 rounded-2xl bg-slate-50 border border-[#E8ECEA] text-xs text-slate-500 font-medium">
            ยังไม่มีประวัติการเคลื่อนไหวของสินค้านี้
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="bg-slate-50/70 border-y border-[#EEF1EF] text-slate-500 font-semibold">
                  <th className="py-3 px-4 sm:px-5 font-semibold whitespace-nowrap">วันที่</th>
                  <th className="py-3 px-4 sm:px-5 font-semibold">เอกสาร</th>
                  <th className="py-3 px-4 sm:px-5 font-semibold">ประเภท</th>
                  <th className="py-3 px-4 sm:px-5 font-semibold text-right">± จำนวน</th>
                  <th className="py-3 px-4 sm:px-5 font-semibold">โดย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EF]">
                {movements.map((m) => (
                  <tr key={m.movement_id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 sm:px-5 text-slate-500 whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="py-3 px-4 sm:px-5 font-mono text-xs font-bold text-[#06402B] whitespace-nowrap">
                      {m.document_no}
                    </td>
                    <td className="py-3 px-4 sm:px-5">
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-bold border bg-slate-100 text-slate-700 border-[#E8ECEA] whitespace-nowrap">
                        {movTypeLabel[m.movement_type] ?? m.movement_type}
                      </span>
                    </td>
                    <td className={`py-3 px-4 sm:px-5 font-mono font-bold text-right whitespace-nowrap ${
                      (m.qty_change ?? 0) > 0 ? "text-[#06402B]" : (m.qty_change ?? 0) < 0 ? "text-rose-600" : "text-slate-400"
                    }`}>
                      {(m.qty_change ?? 0) > 0 ? "+" : ""}{(m.qty_change ?? 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 sm:px-5 text-slate-600 font-medium">{m.created_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 sm:p-8 w-full max-w-xl border border-[#E8ECEA] space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#EEF1EF] pb-3.5">
              <h2 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
                แก้ไขข้อมูลสินค้า ({product.sku})
              </h2>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {formError && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="detail-prod-sku" className="block font-bold text-slate-700 mb-1.5">รหัสสินค้า (SKU) *</label>
                  <input
                    id="detail-prod-sku"
                    type="text"
                    {...register("sku")}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-slate-900 focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 text-xs sm:text-sm font-mono font-bold"
                  />
                  {errors.sku && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.sku.message}</p>}
                </div>
                <div>
                  <label htmlFor="detail-prod-barcode" className="block font-bold text-slate-700 mb-1.5">Barcode</label>
                  <input
                    id="detail-prod-barcode"
                    type="text"
                    {...register("barcode")}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-slate-900 focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 text-xs sm:text-sm font-mono"
                  />
                  {errors.barcode && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.barcode.message}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="detail-prod-name" className="block font-bold text-slate-700 mb-1.5">ชื่อสินค้า *</label>
                <input
                  id="detail-prod-name"
                  type="text"
                  {...register("product_name")}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-slate-900 focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 text-xs sm:text-sm font-medium"
                />
                {errors.product_name && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.product_name.message}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label htmlFor="detail-prod-cat" className="block font-bold text-slate-700 mb-1.5">หมวดหมู่ *</label>
                  <input
                    id="detail-prod-cat"
                    type="text"
                    {...register("category")}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-slate-900 focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 text-xs sm:text-sm"
                  />
                  {errors.category && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.category.message}</p>}
                </div>
                <div>
                  <label htmlFor="detail-prod-unit" className="block font-bold text-slate-700 mb-1.5">หน่วยนับ *</label>
                  <input
                    id="detail-prod-unit"
                    type="text"
                    {...register("base_unit")}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-slate-900 focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 text-xs sm:text-sm"
                  />
                  {errors.base_unit && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.base_unit.message}</p>}
                </div>
                <div>
                  <label htmlFor="detail-prod-min-stock" className="block font-bold text-slate-700 mb-1.5">จำนวนขั้นต่ำ *</label>
                  <input
                    id="detail-prod-min-stock"
                    type="number"
                    min="0"
                    {...register("minimum_stock", { valueAsNumber: true })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-slate-900 focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 text-xs sm:text-sm font-mono font-bold"
                  />
                  {errors.minimum_stock && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.minimum_stock.message}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="detail-prod-desc" className="block font-bold text-slate-700 mb-1.5">รายละเอียดเพิ่มเติม / ตำแหน่ง</label>
                <textarea
                  id="detail-prod-desc"
                  rows={3}
                  {...register("description")}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-slate-900 focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 text-xs sm:text-sm resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex-1 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs sm:text-sm transition-all cursor-pointer border border-[#E8ECEA]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3 rounded-2xl bg-[#06402B] hover:bg-[#053425] disabled:opacity-50 text-white font-extrabold text-xs sm:text-sm shadow-md shadow-[#06402B]/20 transition-all cursor-pointer"
                >
                  {isSubmitting ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
