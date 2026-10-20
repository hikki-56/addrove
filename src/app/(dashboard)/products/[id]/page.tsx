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
        <div className="bg-white rounded-2xl p-12 text-center border border-[rgba(145,158,171,0.2)] shadow-sm space-y-3">
          <div className="w-8 h-8 border-3 border-m3-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-m3-grey-600 font-semibold">กำลังโหลดข้อมูลสินค้า...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-2xl p-12 text-center border border-[rgba(145,158,171,0.2)] shadow-sm space-y-3">
          <p className="text-sm text-m3-grey-600 font-semibold">{error || "ไม่พบสินค้า"}</p>
          <button
            type="button"
            onClick={() => router.push("/products")}
            className="px-4 py-2.5 rounded-xl bg-m3-primary hover:bg-m3-primary-darker text-white text-xs sm:text-sm font-extrabold shadow-md shadow-m3-primary/20 transition-all cursor-pointer"
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
          className="flex items-center gap-1.5 text-m3-grey-600 hover:text-m3-grey-800 text-xs sm:text-sm font-semibold mb-3 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          กลับไปสินค้าทั้งหมด
        </button>

        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-[rgba(0,167,111,0.08)] text-m3-primary-dark border border-[rgba(0,167,111,0.16)] flex items-center justify-center shrink-0">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-extrabold text-m3-grey-800 tracking-tight">{product.product_name}</h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${statusMeta.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
            </div>
            <p className="text-m3-grey-600 text-xs sm:text-sm mt-1 font-medium">
              SKU: <span className="tabular-nums font-bold text-m3-primary-darker">{product.sku}</span>
              <span className="mx-1.5 text-m3-grey-400">·</span>
              หมวด: {product.category || "-"}
              <span className="mx-1.5 text-m3-grey-400">·</span>
              หน่วย: {product.base_unit || "ชิ้น"}
            </p>
          </div>
          <div className="flex gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => router.push("/movements/transfer")}
              className="px-4 py-2.5 rounded-xl bg-white hover:bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-m3-grey-700 text-xs sm:text-sm font-bold flex items-center gap-2 shadow-2xs transition-all cursor-pointer active:scale-98"
            >
              <svg className="w-4 h-4 text-m3-grey-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
              เบิกสินค้า
            </button>
            <button
              type="button"
              onClick={openEdit}
              className="px-4 py-2.5 rounded-xl bg-m3-primary hover:bg-m3-primary-darker text-white text-xs sm:text-sm font-extrabold flex items-center gap-2 shadow-md shadow-m3-primary/20 transition-all cursor-pointer active:scale-98"
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
        <div className="bg-white rounded-xl p-4 border border-[rgba(145,158,171,0.2)] shadow-2xs">
          <div className="text-xs text-m3-grey-600 font-semibold mb-2">บาร์โค้ด</div>
          {barcodeValue ? (
            <BarcodeSvg value={barcodeValue} height={36} width={1.2} className="max-w-full" />
          ) : (
            <div className="text-sm text-m3-grey-500 font-medium py-3">ไม่มีบาร์โค้ด</div>
          )}
        </div>
        <div className="bg-white rounded-xl p-4 border border-[rgba(145,158,171,0.2)] shadow-2xs flex flex-col justify-between">
          <div className="text-xs text-m3-grey-600 font-semibold">คงเหลือรวมทุกโกดัง</div>
          <div className={`text-2xl sm:text-3xl font-extrabold leading-tight mt-1 ${totalQty < 0 ? "text-m3-error-dark" : totalQty === 0 ? "text-m3-grey-500" : "text-m3-primary-dark"}`}>
            {totalQty.toLocaleString()}
            <span className="text-xs font-bold text-m3-grey-500 ml-1.5">{product.base_unit || "ชิ้น"}</span>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-[rgba(145,158,171,0.2)] shadow-2xs flex flex-col justify-between">
          <div className="text-xs text-m3-grey-600 font-semibold">จำนวนขั้นต่ำ (แจ้งเตือน)</div>
          <div className="text-2xl sm:text-3xl font-extrabold text-m3-grey-800 leading-tight mt-1">
            {minimumStock.toLocaleString()}
            <span className="text-xs font-bold text-m3-grey-500 ml-1.5">{product.base_unit || "ชิ้น"}</span>
          </div>
        </div>
      </div>

      {/* โกดังที่มีสินค้า (กดเพื่อขยายดูเฉพาะชื่อโกดัง) */}
      <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] shadow-sm">
        <button
          type="button"
          onClick={() => setWhOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-left cursor-pointer hover:bg-m3-grey-100/60 transition-colors rounded-xl"
        >
          <span className="text-sm font-extrabold text-m3-grey-800 flex items-center gap-2">
            <svg className="w-4 h-4 text-m3-primary-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            โกดังที่มีสินค้า
          </span>
          <span className="flex items-center gap-2 text-xs text-m3-grey-500 font-semibold">
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
              <div className="p-3.5 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-xs text-m3-grey-600 font-medium">
                ยังไม่มีสินค้าจัดเก็บในโกดังใด ๆ
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {byWarehouse.map((wh) => (
                  <span
                    key={wh.warehouse_id}
                    className="px-3 py-1.5 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-xs font-bold text-m3-grey-700"
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
      <div id="history" className="bg-white rounded-2xl border border-[rgba(145,158,171,0.2)] shadow-sm overflow-hidden scroll-mt-24">
        <div className="p-5 sm:p-6 pb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm sm:text-base font-extrabold text-m3-grey-800 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-m3-warning" />
            ประวัติสินค้า (ล่าสุด 20 รายการ)
          </h2>
        </div>

        {movementsNote ? (
          <div className="mx-5 sm:mx-6 mb-5 p-4 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-xs text-m3-grey-600 font-medium">
            {movementsNote}
          </div>
        ) : movements.length === 0 ? (
          <div className="mx-5 sm:mx-6 mb-5 p-4 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-xs text-m3-grey-600 font-medium">
            ยังไม่มีประวัติการเคลื่อนไหวของสินค้านี้
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="bg-m3-grey-100/70 border-y border-[rgba(145,158,171,0.2)] text-m3-grey-600 font-semibold">
                  <th className="py-3 px-4 sm:px-5 font-semibold whitespace-nowrap">วันที่</th>
                  <th className="py-3 px-4 sm:px-5 font-semibold">เอกสาร</th>
                  <th className="py-3 px-4 sm:px-5 font-semibold">ประเภท</th>
                  <th className="py-3 px-4 sm:px-5 font-semibold text-right">± จำนวน</th>
                  <th className="py-3 px-4 sm:px-5 font-semibold">โดย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(145,158,171,0.2)]">
                {movements.map((m) => (
                  <tr key={m.movement_id} className="hover:bg-m3-grey-100/80 transition-colors">
                    <td className="py-3 px-4 sm:px-5 text-m3-grey-600 whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="py-3 px-4 sm:px-5 tabular-nums text-xs font-bold text-m3-primary-dark whitespace-nowrap">
                      {m.document_no}
                    </td>
                    <td className="py-3 px-4 sm:px-5">
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-bold border bg-m3-grey-200 text-m3-grey-700 border-[rgba(145,158,171,0.2)] whitespace-nowrap">
                        {movTypeLabel[m.movement_type] ?? m.movement_type}
                      </span>
                    </td>
                    <td className={`py-3 px-4 sm:px-5 tabular-nums font-bold text-right whitespace-nowrap ${
                      (m.qty_change ?? 0) > 0 ? "text-m3-primary-dark" : (m.qty_change ?? 0) < 0 ? "text-m3-error-dark" : "text-m3-grey-500"
                    }`}>
                      {(m.qty_change ?? 0) > 0 ? "+" : ""}{(m.qty_change ?? 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 sm:px-5 text-m3-grey-600 font-medium">{m.created_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-m3-grey-800/48 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl p-6 sm:p-8 w-full max-w-xl border border-[rgba(145,158,171,0.2)] space-y-5 shadow-m3-dropdown">
            <div className="flex items-center justify-between border-b border-[rgba(145,158,171,0.2)] pb-3.5">
              <h2 className="text-base sm:text-lg font-extrabold text-m3-grey-800 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-m3-primary" />
                แก้ไขข้อมูลสินค้า ({product.sku})
              </h2>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-m3-grey-500 hover:text-m3-grey-700 p-1.5 rounded-xl hover:bg-m3-grey-200 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {formError && (
              <div className="p-3.5 rounded-xl bg-[rgba(255,86,48,0.08)] border border-[rgba(255,86,48,0.24)] text-m3-error-dark text-xs font-medium">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="detail-prod-sku" className="block font-bold text-m3-grey-700 mb-1.5">รหัสสินค้า (SKU) *</label>
                  <input
                    id="detail-prod-sku"
                    type="text"
                    {...register("sku")}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-m3-grey-800 focus:outline-none focus:border-m3-grey-800 focus:ring-2 focus:ring-m3-primary/20 text-xs sm:text-sm tabular-nums font-bold"
                  />
                  {errors.sku && <p className="mt-1 text-xs text-m3-error-dark font-medium">{errors.sku.message}</p>}
                </div>
                <div>
                  <label htmlFor="detail-prod-barcode" className="block font-bold text-m3-grey-700 mb-1.5">Barcode</label>
                  <input
                    id="detail-prod-barcode"
                    type="text"
                    {...register("barcode")}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-m3-grey-800 focus:outline-none focus:border-m3-grey-800 focus:ring-2 focus:ring-m3-primary/20 text-xs sm:text-sm tabular-nums"
                  />
                  {errors.barcode && <p className="mt-1 text-xs text-m3-error-dark font-medium">{errors.barcode.message}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="detail-prod-name" className="block font-bold text-m3-grey-700 mb-1.5">ชื่อสินค้า *</label>
                <input
                  id="detail-prod-name"
                  type="text"
                  {...register("product_name")}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-m3-grey-800 focus:outline-none focus:border-m3-grey-800 focus:ring-2 focus:ring-m3-primary/20 text-xs sm:text-sm font-medium"
                />
                {errors.product_name && <p className="mt-1 text-xs text-m3-error-dark font-medium">{errors.product_name.message}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label htmlFor="detail-prod-cat" className="block font-bold text-m3-grey-700 mb-1.5">หมวดหมู่ *</label>
                  <input
                    id="detail-prod-cat"
                    type="text"
                    {...register("category")}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-m3-grey-800 focus:outline-none focus:border-m3-grey-800 focus:ring-2 focus:ring-m3-primary/20 text-xs sm:text-sm"
                  />
                  {errors.category && <p className="mt-1 text-xs text-m3-error-dark font-medium">{errors.category.message}</p>}
                </div>
                <div>
                  <label htmlFor="detail-prod-unit" className="block font-bold text-m3-grey-700 mb-1.5">หน่วยนับ *</label>
                  <input
                    id="detail-prod-unit"
                    type="text"
                    {...register("base_unit")}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-m3-grey-800 focus:outline-none focus:border-m3-grey-800 focus:ring-2 focus:ring-m3-primary/20 text-xs sm:text-sm"
                  />
                  {errors.base_unit && <p className="mt-1 text-xs text-m3-error-dark font-medium">{errors.base_unit.message}</p>}
                </div>
                <div>
                  <label htmlFor="detail-prod-min-stock" className="block font-bold text-m3-grey-700 mb-1.5">จำนวนขั้นต่ำ *</label>
                  <input
                    id="detail-prod-min-stock"
                    type="number"
                    min="0"
                    {...register("minimum_stock", { valueAsNumber: true })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-m3-grey-800 focus:outline-none focus:border-m3-grey-800 focus:ring-2 focus:ring-m3-primary/20 text-xs sm:text-sm tabular-nums font-bold"
                  />
                  {errors.minimum_stock && <p className="mt-1 text-xs text-m3-error-dark font-medium">{errors.minimum_stock.message}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="detail-prod-desc" className="block font-bold text-m3-grey-700 mb-1.5">รายละเอียดเพิ่มเติม / ตำแหน่ง</label>
                <textarea
                  id="detail-prod-desc"
                  rows={3}
                  {...register("description")}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] text-m3-grey-800 focus:outline-none focus:border-m3-grey-800 focus:ring-2 focus:ring-m3-primary/20 text-xs sm:text-sm resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex-1 py-3 rounded-xl bg-m3-grey-200 hover:bg-m3-grey-300 text-m3-grey-700 font-bold text-xs sm:text-sm transition-all cursor-pointer border border-[rgba(145,158,171,0.2)]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3 rounded-xl bg-m3-primary hover:bg-m3-primary-darker disabled:opacity-50 text-white font-extrabold text-xs sm:text-sm shadow-md shadow-m3-primary/20 transition-all cursor-pointer"
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
