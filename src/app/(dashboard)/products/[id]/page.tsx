"use client";
import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UpdateProductSchema, type UpdateProductInput } from "@/types/api";
import type { Product } from "@/types/models";

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm({
      resolver: zodResolver(UpdateProductSchema),
    });

  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setProduct(d.data);
          reset(d.data);
        } else {
          setError(d.message);
        }
      })
      .finally(() => setLoading(false));
  }, [id, reset]);

  const onSubmit = async (data: UpdateProductInput) => {
    setError("");
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
      router.push("/products");
    } else {
      setError(json.message);
    }
  };

  if (loading) return <div className="text-center py-12 text-slate-500 font-medium">กำลังโหลด...</div>;
  if (!product) return <div className="text-center py-12 text-slate-500 font-medium">ไม่พบสินค้า</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-xs sm:text-sm mb-4 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          กลับ
        </button>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">แก้ไขข้อมูลสินค้า ({product.sku})</h1>
        <p className="text-slate-500 text-xs sm:text-sm mt-1">สามารถแก้ไขข้อมูลได้ทุกช่อง</p>
      </div>

      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs">
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm font-medium">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">รหัสสินค้า (SKU) *</label>
              <input
                {...register("sku")}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono font-bold transition-all"
              />
              {errors.sku && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.sku.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Barcode</label>
              <input
                {...register("barcode")}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono transition-all"
              />
              {errors.barcode && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.barcode.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">ชื่อสินค้า *</label>
            <input
              {...register("product_name")}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-medium transition-all"
            />
            {errors.product_name && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.product_name.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">หมวดหมู่ *</label>
              <input
                {...register("category")}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm transition-all"
              />
              {errors.category && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.category.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">หน่วยนับ *</label>
              <input
                {...register("base_unit")}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm transition-all"
              />
              {errors.base_unit && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.base_unit.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">จำนวนขั้นต่ำ *</label>
            <input
              type="number"
              {...register("minimum_stock", { valueAsNumber: true })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono font-bold transition-all"
            />
            {errors.minimum_stock && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.minimum_stock.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">รายละเอียดเพิ่มเติม / ตำแหน่ง</label>
            <textarea
              {...register("description")}
              rows={3}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm resize-none transition-all"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 py-2.5 sm:py-3 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold transition-all text-xs sm:text-sm hover:bg-slate-50 cursor-pointer active:scale-95"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 sm:py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold transition-all text-xs sm:text-sm shadow-md shadow-indigo-600/20 cursor-pointer active:scale-95"
            >
              {isSubmitting ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
